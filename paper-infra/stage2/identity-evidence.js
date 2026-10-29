import { normalizeDoi, normalizedWords, plainText, titleSimilarity } from './common.js';

function titleWindowScore(title, text) {
  const target = normalizedWords(title), words = normalizedWords(text).slice(0, 450);
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
  return String(text || '').split(/\n\s*(?:abstract|introduction|references|bibliography|literature cited)\s*(?:\n|:)/i)[0].slice(0, 4500);
}

export function assessIdentity(target, observed) {
  const doi = normalizeDoi(target?.doi), title = plainText(target?.title);
  if (!doi || normalizedWords(title).length < 3) return { verdict: 'uncertain', reason: 'target_metadata_incomplete' };
  const header = headerText(observed.firstPageText);
  if (header.trim().length < 50) return { verdict: 'uncertain', reason: 'no_readable_first_page' };
  const roleText = header.slice(0, 1400);
  if (/^(?:.*\n){0,6}\s*(?:supplementary (?:information|material|data)|supporting information|author correction|publisher correction|erratum|corrigendum|retraction)\b/im.test(roleText)) {
    return { verdict: 'rejected', reason: 'not_main_article' };
  }
  const observedDois = [...header.matchAll(/10\.\d{4,9}\/[^\s<>"\u0000-\u001f]+/gi)]
    .map(match => normalizeDoi(match[0].replace(/[.,;]+$/, ''))).filter(Boolean);
  const exactDoi = observedDois.includes(doi);
  const score = titleWindowScore(title, header);
  const headerWords = ' ' + normalizedWords(header).join(' ') + ' ';
  const authorMatch = (target.authors || []).some(author => {
    const family = normalizedWords(author.family).join(' ');
    return family.length >= 3 && headerWords.includes(' ' + family + ' ');
  });
  const yearMatch = Number.isInteger(target.year) && [target.year - 1, target.year, target.year + 1]
    .some(year => new RegExp(`\\b${year}\\b`).test(header));
  const shortTitle = normalizedWords(title).length < 6;
  const evidence = { title_score: Math.round(score * 1000) / 1000, doi_match: exactDoi, author_match: authorMatch, year_match: yearMatch };
  if (exactDoi && score >= 0.92 && (!shortTitle || (authorMatch && yearMatch))) {
    return { verdict: 'verified', reason: 'first_page_doi_and_title', evidence };
  }
  if (!observedDois.length && score >= 0.96 && authorMatch && yearMatch && !shortTitle) {
    return { verdict: 'verified', reason: 'first_page_title_author_year', evidence };
  }
  if (observedDois.length && !exactDoi) return { verdict: 'rejected', reason: 'first_page_doi_mismatch', evidence };
  if (score < 0.5 && plainText(observed.pdfTitle).length > 12
      && titleSimilarity(title, observed.pdfTitle) < 0.5) return { verdict: 'rejected', reason: 'different_article_title', evidence };
  return { verdict: 'uncertain', reason: 'insufficient_independent_evidence', evidence };
}


