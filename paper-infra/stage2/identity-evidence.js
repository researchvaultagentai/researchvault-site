import { normalizeDoi, normalizedWords, plainText, titleSimilarity } from './common.js';

function titleWindowScore(title, text, limit = 450) {
  const target = normalizedWords(title), words = normalizedWords(text).slice(0, limit);
  if (target.length < 3 || !words.length) return 0;
  const targetSet = new Set(target); let best = 0;
  for (let size = Math.max(3, target.length - 2); size <= target.length + 3; size++) {
    const counts = new Map(); let overlap = 0;
    const add = word => { const old = counts.get(word) || 0; counts.set(word, old + 1); if (!old && targetSet.has(word)) overlap++; };
    const remove = word => { const old = counts.get(word); if (old === 1) { counts.delete(word); if (targetSet.has(word)) overlap--; } else counts.set(word, old - 1); };
    for (let i = 0; i < words.length; i++) {
      add(words[i]); if (i >= size) remove(words[i - size]);
      if (i < size - 1) continue;
      best = Math.max(best, 2 * overlap / (targetSet.size + counts.size));
      if (best === 1) return 1;
    }
  }
  return best;
}

function headerText(text) {
  // Reference-list DOIs and citations in the introduction are not article identity.
  return String(text || '').replace(/(INTRODUCTION|REFERENCES|BIBLIOGRAPHY)(?=[A-Z])/g, '\n$1\n')
    .split(/\n\s*(?:\d+[.)]?\s+)?(?:abstract|introduction|references|bibliography|literature cited)\s*(?:\n|:)/i)[0].slice(0, 8000);
}

function serializedFrontmatter(text) {
  const joinedDois = new Set();
  // Some untagged PDFs serialize adjacent text objects without a separator.
  // Restore only a fixed-width PLOS article DOI followed by an observed section
  // label. Never trim a generic DOI, a figure suffix, or an arbitrary extra word.
  const restored = String(text || '').replace(
    /(10\.1371\/journal\.(?:pmed|pone|pbio|pgen|pcbi|ppat|pntd)\.\d{7})(Summary|INTRODUCTION)(?=[A-Z])/g,
    (_, doi, heading) => { joinedDois.add(doi.toLowerCase()); return doi + '\n' + heading + '\n'; },
  );
  return { text: restored, joinedDois };
}

function bibliographyMatches(target, text) {
  const withoutDois = text.replace(/10\.\d{4,9}\/[^\s<>\"\u0000-\u001f]+/gi, ' ');
  const words = ' ' + normalizedWords(withoutDois).join(' ') + ' ';
  return {
    author: (target.authors || []).some(author => {
      const family = normalizedWords(author.family).join(' ');
      return family.length >= 3 && words.includes(' ' + family + ' ');
    }),
    year: Number.isInteger(target.year) && [target.year - 1, target.year, target.year + 1]
      .some(year => new RegExp(`\\b${year}\\b`).test(withoutDois)),
  };
}

export function assessIdentity(target, observed) {
  const doi = normalizeDoi(target?.doi), title = plainText(target?.title);
  if (!doi || normalizedWords(title).length < 3) return { verdict: 'uncertain', reason: 'target_metadata_incomplete' };
  const serialized = serializedFrontmatter(observed.firstPageText);
  const header = headerText(serialized.text);
  if (header.trim().length < 50) return { verdict: 'uncertain', reason: 'no_readable_first_page' };
  const roleText = header.slice(0, 1400);
  if (/^(?:.*\n){0,6}\s*(?:supplementary (?:information|material|data)|supporting information|author correction|publisher correction|erratum|corrigendum|retraction)\b/im.test(roleText)
      || /^(?:supplementary(?:information|material|data)|supportinginformation|authorcorrection|publishercorrection|erratum|corrigendum|retraction)/i.test(roleText.replace(/\s+/g, ''))) {
    return { verdict: 'rejected', reason: 'not_main_article' };
  }
  const observedDois = [...header.matchAll(/10\.\d{4,9}\/[^\s<>"\u0000-\u001f]+/gi)]
    .map(match => normalizeDoi(match[0].replace(/[.,;]+$/, ''))).filter(Boolean);
  const exactDoi = observedDois.includes(doi);
  const earlyHeader = header.slice(0, 4500);
  const score = titleWindowScore(title, earlyHeader);
  const earlyDoi = earlyHeader.toLowerCase().includes(doi);
  const { author: authorMatch, year: yearMatch } = bibliographyMatches(target, header);
  const shortTitle = normalizedWords(title).length < 6;
  const evidence = { title_score: Math.round(score * 1000) / 1000, doi_match: exactDoi, author_match: authorMatch, year_match: yearMatch,
    observed_doi_count: observedDois.length,
    doi_target_prefix_only: !exactDoi && observedDois.some(item => item.startsWith(doi)) };
  const joinedDoi = serialized.joinedDois.has(doi);
  if (joinedDoi) {
    const beforeDoi = header.slice(0, header.toLowerCase().indexOf(doi));
    const before = bibliographyMatches(target, beforeDoi);
    // Exact full-title characters may span PDF text-object boundaries. Restrict
    // this alternative to the repaired publisher form, before its DOI, and require
    // independent author/year there as well. Nothing after that DOI supplies proof.
    const compactTitle = normalizedWords(title).join('');
    const compactMatch = normalizedWords(beforeDoi).slice(0, 1000).join('').includes(compactTitle);
    Object.assign(evidence, { serialized_doi_boundary: true, compact_title_match: compactMatch,
      author_before_doi: before.author, year_before_doi: before.year });
    if (exactDoi && compactMatch && before.author && before.year && !shortTitle
        && observedDois.every(item => item === doi)) {
      return { verdict: 'verified', reason: 'serialized_frontmatter_doi_title_author_year', evidence };
    }
  }
  if (!joinedDoi && exactDoi && earlyDoi && score >= 0.92 && (!shortTitle || (authorMatch && yearMatch))) {
    return { verdict: 'verified', reason: 'first_page_doi_and_title', evidence };
  }
  // Older multi-column PDFs can serialize the title/citation after body text on page one.
  // This bounded extension needs ALL independent identity fields and no competing DOI.
  const extendedScore = titleWindowScore(title, header, 1000);
  if (!joinedDoi && exactDoi && extendedScore >= 0.98 && authorMatch && yearMatch && !shortTitle
      && observedDois.every(item => item === doi)) {
    return { verdict: 'verified', reason: 'leading_page_doi_title_author_year',
      evidence: { ...evidence, title_score: Math.round(extendedScore * 1000) / 1000 } };
  }
  if (!observedDois.length && score >= 0.96 && authorMatch && yearMatch && !shortTitle) {
    return { verdict: 'verified', reason: 'first_page_title_author_year', evidence };
  }
  if (observedDois.length && !exactDoi) return { verdict: 'rejected', reason: 'first_page_doi_mismatch', evidence };
  if (score < 0.5 && plainText(observed.pdfTitle).length > 12
      && titleSimilarity(title, observed.pdfTitle) < 0.5) return { verdict: 'rejected', reason: 'different_article_title', evidence };
  return { verdict: 'uncertain', reason: 'insufficient_independent_evidence', evidence };
}


