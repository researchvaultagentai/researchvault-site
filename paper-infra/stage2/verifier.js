import { MAX_PDF_BYTES, VERIFIER_VERSION, normalizeDoi, sha256 } from './common.js';
import { assessIdentity } from './identity-evidence.js';

// PDF-to-text conversion parses document content without an LLM. The production
// Worker does not run PDF.js under the Free CPU ceiling. Local PDF.js is a test oracle.
export async function inspectProductionPdf(bytes, target, { converter, deadline = Date.now() + 4000 } = {}) {
  const base = { verifier: VERIFIER_VERSION, doi: normalizeDoi(target?.doi) };
  if (!(bytes instanceof Uint8Array) || bytes.length < 64 || bytes.length > MAX_PDF_BYTES
    || !new TextDecoder().decode(bytes.subarray(0, 8)).startsWith('%PDF-')) return { ...base, verdict: 'rejected', reason: 'not_pdf_or_size_limit' };
  if (!new TextDecoder().decode(bytes.subarray(Math.max(0, bytes.length - 8192))).includes('%%EOF')) {
    return { ...base, verdict: 'uncertain', reason: 'possibly_truncated_pdf' };
  }
  if (typeof converter !== 'function') return { ...base, verdict: 'uncertain', reason: 'pdf_text_service_unavailable' };
  let timer;
  try {
    // A constant filename and disabled metadata prevent target/title echo from
    // becoming apparent evidence. Never send images or request OCR/model inference.
    const task = converter({ name: 'article.pdf', blob: new Blob([bytes], { type: 'application/pdf' }) }, {
      conversionOptions: { pdf: { metadata: false }, output: { format: 'text' } },
    });
    const converted = await Promise.race([task, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('conversion_timeout')), Math.max(1, Math.min(4000, deadline - Date.now())));
    })]);
    const result = Array.isArray(converted) ? converted[0] : converted;
    const mime = result?.mimeType || result?.mimetype;
    if (!result || result.format === 'error' || (mime && mime !== 'application/pdf')
      || typeof result.data !== 'string' || result.data.length > 2000000) {
      return { ...base, verdict: 'uncertain', reason: 'pdf_text_not_available' };
    }
    const text = result.data.replace(/(^|\n)\s*#{1,6}\s+/g, '$1');
    const assessment = assessIdentity(target, { firstPageText: text.slice(0, 24000), pdfTitle: '' });
    return { ...base, ...assessment, sha256: await sha256(bytes), byte_length: bytes.length };
  } catch {
    return { ...base, verdict: 'uncertain', reason: 'pdf_text_service_failed' };
  } finally { clearTimeout(timer); }
}
