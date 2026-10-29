import { normalizeDoi, plainText, publicUrl, ResolutionError, titleSimilarity } from './common.js';

function candidate(input, source, { version = 'unknown', license = null, title = '', doi = null, priority = 50 } = {}) {
  try { return { url: publicUrl(input), source, version, license, observed_title: plainText(title), observed_doi: normalizeDoi(doi), priority }; }
  catch { return null; }
}
function valid(list) { return list.filter(Boolean).slice(0, 15); }

export function unpaywallCandidates(data, metadata) {
  if (normalizeDoi(data?.doi) !== metadata.doi) throw new ResolutionError('source_doi_mismatch', 502);
  const locations = [data.best_oa_location, ...(data.oa_locations || [])].filter(Boolean);
  const seen = new Set();
  return valid(locations.filter(l => l.url_for_pdf && !seen.has(l.url_for_pdf) && seen.add(l.url_for_pdf))
    .map(l => candidate(l.url_for_pdf, 'unpaywall', { version: l.version || 'unknown', license: l.license,
      title: data.title, doi: data.doi, priority: l.version === 'publishedVersion' ? 95 : l.version === 'acceptedVersion' ? 85 : 60 })));
}

export function openalexCandidates(data, metadata) {
  if (normalizeDoi(data?.doi) !== metadata.doi) throw new ResolutionError('source_doi_mismatch', 502);
  return valid([data.best_oa_location, ...(data.locations || [])].filter(l => l?.is_oa && l.pdf_url)
    .map(l => candidate(l.pdf_url, 'openalex', { version: l.version || 'unknown', license: l.license,
      title: data.title || data.display_name, doi: data.doi, priority: l.version === 'publishedVersion' ? 90 : 80 })));
}

function attributes(tag) {
  const attrs = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[match[1].toLowerCase()] = plainText(match[2] ?? match[3] ?? match[4]);
  return attrs;
}

export function landingCandidates(html, url, metadata) {
  const meta = {};
  for (const tag of html.matchAll(/<meta\b[^>]{0,8192}>/gi)) {
    const a = attributes(tag[0]), key = (a.name || a.property || '').toLowerCase();
    if (key && a.content) (meta[key] ||= []).push(a.content);
  }
  const observedDoi = normalizeDoi(meta.citation_doi?.[0] || meta['dc.identifier']?.find(x => normalizeDoi(x)));
  const observedTitle = meta.citation_title?.[0] || meta['dc.title']?.[0] || '';
  if (observedDoi && observedDoi !== metadata.doi) return [];
  if (observedTitle && titleSimilarity(observedTitle, metadata.title) < 0.65) return [];
  const urls = [...(meta.citation_pdf_url || [])];
  for (const tag of html.matchAll(/<link\b[^>]{0,8192}>/gi)) {
    const a = attributes(tag[0]);
    if (a.type?.toLowerCase() === 'application/pdf' && a.href) urls.push(a.href);
  }
  // A discoverable link is a candidate, never a final identity approval.
  return valid(urls.map(input => {
    try { return candidate(publicUrl(input, url), 'publisher', { title: observedTitle, doi: observedDoi, priority: 88 }); }
    catch { return null; }
  }));
}

async function publisher(metadata, budget) {
  const direct = valid((metadata.links || []).filter(link => /pdf/i.test(link.type))
    .map(link => candidate(link.url, 'crossref-publisher-link', { priority: 82 })));
  // Do not discard alternate publisher locations merely because metadata has one link.
  try {
    const response = await budget.text(metadata.landing_url, { accept: 'text/html,application/pdf;q=0.9', maxBytes: 900000, headerOnlyForPdf: true });
    if (response.contentType.includes('application/pdf')) {
      direct.push(candidate(response.url, 'publisher-direct', { priority: 90 }));
    } else direct.push(...landingCandidates(response.text, response.url, metadata));
  } catch (error) {
    if (!direct.length) throw error;
  }
  return valid(direct);
}

async function oa(metadata, budget, env) {
  const found = []; let lastError;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.UNPAYWALL_EMAIL || '')) {
    const url = new URL('https://api.unpaywall.org/v2/' + metadata.doi);
    url.searchParams.set('email', env.UNPAYWALL_EMAIL);
    try { found.push(...unpaywallCandidates(await budget.json(url.toString()), metadata)); }
    catch (error) { lastError = error; }
  }
  // No paid fallback or implicit API key. Missing optional credentials simply skip a provider.
  if (!found.length && env.OPENALEX_API_KEY) {
    const url = new URL('https://api.openalex.org/works/https://doi.org/' + metadata.doi);
    url.searchParams.set('api_key', env.OPENALEX_API_KEY);
    try { found.push(...openalexCandidates(await budget.json(url.toString()), metadata)); }
    catch (error) { lastError = error; }
  }
  if (!found.length && lastError) throw lastError;
  return found;
}

async function biomedical(metadata, budget) {
  const url = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
  url.search = new URLSearchParams({ query: `DOI:"${metadata.doi}"`, format: 'json', resultType: 'core', pageSize: '3' });
  const records = (await budget.json(url.toString()))?.resultList?.result || [];
  const result = [];
  for (const item of records) {
    if (normalizeDoi(item.doi) !== metadata.doi) continue;
    for (const link of item.fullTextUrlList?.fullTextUrl || []) {
      if (/pdf/i.test(link.documentStyle || '') && /^(?:OA|F)$/i.test(link.availabilityCode || '')) {
        result.push(candidate(link.url, 'europepmc', { title: item.title, doi: item.doi, priority: 90, version: 'publishedVersion' }));
      }
    }
    if (!result.length && item.isOpenAccess === 'Y' && /^PMC\d+$/.test(item.pmcid || '')) {
      const landing = `https://pmc.ncbi.nlm.nih.gov/articles/${item.pmcid}/`;
      const page = await budget.text(landing, { accept: 'text/html', maxBytes: 900000 });
      result.push(...landingCandidates(page.text, page.url, metadata).map(c => ({ ...c, source: 'pmc', priority: 90 })));
    }
  }
  return valid(result);
}

async function preprints(metadata) {
  const arxiv = /^10\.48550\/arxiv\.(\d{4}\.\d{4,5}(?:v\d+)?)$/i.exec(metadata.doi);
  if (arxiv) return valid([candidate('https://arxiv.org/pdf/' + arxiv[1], 'arxiv', { version: 'submittedVersion', priority: 90 })]);
  if (metadata.doi.startsWith('10.1101/')) {
    const host = new URL(metadata.landing_url).hostname;
    if (/(?:^|\.)(?:biorxiv|medrxiv)\.org$/.test(host)) return valid([candidate(metadata.landing_url.replace(/\/$/, '') + '.full.pdf', 'preprint-publisher', { version: 'submittedVersion', priority: 80 })]);
  }
  return [];
}

async function longtail(metadata, budget) {
  const result = []; let lastError;
  if (metadata.family === 'longtail') {
    try { result.push(...await publisher(metadata, budget)); } catch {}
    if (result.length) return valid(result);
  }
  const hal = new URL('https://api.archives-ouvertes.fr/search/');
  hal.search = new URLSearchParams({ q: `doiId_s:"${metadata.doi}"`, fl: 'doiId_s,title_s,fileMain_s,uri_s', wt: 'json', rows: '5' });
  try {
    for (const doc of (await budget.json(hal.toString()))?.response?.docs || []) {
      if (normalizeDoi(doc.doiId_s) === metadata.doi && doc.fileMain_s) result.push(candidate(doc.fileMain_s, 'hal', {
        title: doc.title_s?.[0], doi: metadata.doi, version: 'acceptedVersion', priority: 75 }));
    }
  } catch (error) { lastError = error; }
  if (!result.length && budget.remaining() > 500) {
    const zenodo = new URL('https://zenodo.org/api/records');
    zenodo.search = new URLSearchParams({ q: `doi:"${metadata.doi}"`, size: '3' });
    let records = [];
    try { records = (await budget.json(zenodo.toString()))?.hits?.hits || []; } catch (error) { lastError = error; }
    for (const record of records) {
      if (normalizeDoi(record.doi || record.metadata?.doi) !== metadata.doi) continue;
      for (const file of record.files || []) if (/\.pdf$/i.test(file.key || '')) result.push(candidate(file.links?.self, 'zenodo', {
        title: record.metadata?.title, doi: metadata.doi, license: record.metadata?.license?.id, priority: 72 }));
    }
  }
  if (!result.length && lastError) throw lastError;
  return valid(result);
}

export async function probeSource(group, metadata, budget, env = {}) {
  if (group === 'OA_DISCOVERY') return oa(metadata, budget, env);
  if (group === 'BIOMEDICAL') return biomedical(metadata, budget);
  if (group === 'PREPRINT_REPOSITORY') return preprints(metadata);
  if (['MAJOR_PUBLISHERS_A', 'MAJOR_PUBLISHERS_B', 'SOCIETY_ENGINEERING'].includes(group)) return publisher(metadata, budget);
  if (group === 'LONGTAIL_FALLBACK') return longtail(metadata, budget);
  throw new ResolutionError('unknown_source_group', 400);
}
