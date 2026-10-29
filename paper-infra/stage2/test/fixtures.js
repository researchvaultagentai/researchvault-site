import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export const metadata = { doi: '10.1234/force.2026', title: 'Flexible robotic sensors improve measurement of delicate forces',
  authors: [{ family: 'Smith', given: 'A' }], year: 2026, journal: 'Robotics Research', publisher: 'Springer Nature',
  landing_url: 'https://papers.example.edu/article/force', links: [], family: 'publishers-a', metadata_source: 'crossref' };

// An authored, valid PDF fixture with real xref offsets. No customer data or external assets.
export function makePdf(lines = [metadata.title, 'A Smith', 'Robotics Research 2026', 'https://doi.org/' + metadata.doi,
  'Abstract', 'A synthetic laboratory experiment for software validation.'], pdfTitle = metadata.title) {
  const escape = text => String(text).replace(/([\\()])/g, '\\$1');
  const stream = 'BT /F1 12 Tf 50 740 Td\n' + lines.map((line, i) => `${i ? '0 -18 Td ' : ''}(${escape(line)}) Tj`).join('\n') + '\nET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Title (${escape(pdfTitle)}) /Author (A Smith) >>`,
  ];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf));
}

export function sqliteD1() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(new URL('../../migrations/stage2/0001_paper_pipeline.sql', import.meta.url), 'utf8'));
  const db = { raw, prepare(query) {
    const sql = raw.prepare(query); let args = [];
    return { bind(...values) { args = values; return this; },
      async first() { return sql.get(...args) || null; }, async all() { return { results: sql.all(...args) }; },
      async run() { const result = sql.run(...args); return { meta: { changes: Number(result.changes) } }; } };
  } };
  return db;
}

export function crossref() {
  return { message: { DOI: metadata.doi, title: [metadata.title], author: [{ family: 'Smith', given: 'A' }],
    published: { 'date-parts': [[2026]] }, 'container-title': [metadata.journal], publisher: metadata.publisher,
    URL: metadata.landing_url, type: 'journal-article', link: [] } };
}
