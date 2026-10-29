import { normalizeDoi, plainText, publicUrl, ResolutionError, titleSimilarity } from './common.js';

export function publisherFamily(metadata) {
  let host = '';
  try { host = new URL(metadata.landing_url).hostname; } catch {}
  const text = `${metadata.publisher || ''} ${host}`.toLowerCase();
  if (/ieee|acm\b|acs\b|american chemical|royal society of chemistry|rsc\b|aip\b|aps\b|iop\b|physical society|osa\b|optica/.test(text)) return 'society-tech';
  if (/elsevier|springer|nature|wiley|blackwell|cell\.com|sciencedirect|mdpi|frontiers|plos|public library of science|elife/.test(text)) return 'publishers-a';
  if (/taylor|francis|sage|oxford|cambridge|emerald|de gruyter|brill|informa|wolters|lippincott|bmj|american medical|massachusetts medical/.test(text)) return 'publishers-b';
  return 'longtail';
}

function safeUrl(input) { try { return publicUrl(input); } catch { return null; } }
function yearOf(value) { const y = Number(value); return y >= 1500 && y <= 2200 ? y : null; }

export function crossrefMetadata(item, expectedDoi) {
  const doi = normalizeDoi(item?.DOI);
  if (!doi || (expectedDoi && doi !== normalizeDoi(expectedDoi))) throw new ResolutionError('metadata_doi_mismatch', 502);
  const title = plainText(item.title?.[0]).slice(0, 1200);
  if (title.length < 8) throw new ResolutionError('metadata_title_missing', 502);
  const metadata = { doi, title, authors: (item.author || []).map(a => ({ family: plainText(a.family).slice(0, 80), given: plainText(a.given).slice(0, 80) })).slice(0, 30),
    journal: plainText(item['container-title']?.[0]).slice(0, 180), publisher: plainText(item.publisher).slice(0, 180),
    year: yearOf(item.published?.['date-parts']?.[0]?.[0] || item.issued?.['date-parts']?.[0]?.[0]),
    landing_url: safeUrl(item.URL) || `https://doi.org/${doi}`,
    links: (item.link || []).map(link => ({ url: safeUrl(link.URL), type: String(link['content-type'] || '') })).filter(l => l.url).slice(0, 12),
    publication_type: String(item.type || ''), metadata_source: 'crossref' };
  metadata.family = publisherFamily(metadata);
  return metadata;
}

export function dataciteMetadata(data, expectedDoi) {
  const item = data?.data?.attributes;
  const doi = normalizeDoi(item?.doi);
  if (!doi || doi !== normalizeDoi(expectedDoi)) throw new ResolutionError('metadata_doi_mismatch', 502);
  const title = plainText(item.titles?.[0]?.title).slice(0, 1200);
  if (title.length < 8) throw new ResolutionError('metadata_title_missing', 502);
  const metadata = { doi, title, authors: (item.creators || []).map(a => ({ family: plainText(a.familyName || a.name).slice(0, 80), given: plainText(a.givenName).slice(0, 80) })).slice(0, 30),
    journal: '', publisher: plainText(item.publisher), year: yearOf(item.publicationYear),
    landing_url: safeUrl(item.url) || `https://doi.org/${doi}`, links: [], publication_type: 'repository', metadata_source: 'datacite' };
  metadata.family = publisherFamily(metadata);
  return metadata;
}

export async function resolveMetadata(input, budget) {
  const doi = normalizeDoi(input.doi);
  if (doi) {
    try { return crossrefMetadata((await budget.json(`https://api.crossref.org/works/${encodeURIComponent(doi)}`)).message, doi); }
    catch (error) {
      if (![404, 400].includes(error.status)) throw error;
      return dataciteMetadata(await budget.json(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`), doi);
    }
  }
  const title = plainText(input.title);
  if (title.length < 12 || title.length > 500) throw new ResolutionError('invalid_doi_or_title', 400);
  const url = new URL('https://api.crossref.org/works');
  url.search = new URLSearchParams({ 'query.title': title, rows: '5' });
  const items = (await budget.json(url.toString()))?.message?.items || [];
  const ranked = items.map(item => ({ item, score: titleSimilarity(title, item.title?.[0]) })).sort((a, b) => b.score - a.score);
  if (!ranked[0] || ranked[0].score < 0.94 || (ranked[1] && ranked[0].score - ranked[1].score < 0.05
      && normalizeDoi(ranked[0].item.DOI) !== normalizeDoi(ranked[1].item.DOI))) throw new ResolutionError('ambiguous_title', 422);
  return crossrefMetadata(ranked[0].item);
}
