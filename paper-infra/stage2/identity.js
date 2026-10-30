import { getDocumentProxy } from 'unpdf';
import { MAX_PDF_BYTES, VERIFIER_VERSION, normalizeDoi, sha256 } from './common.js';
import { assessIdentity } from './identity-evidence.js';
export { assessIdentity } from './identity-evidence.js';

export async function inspectDocument(bytes, target, { parser = getDocumentProxy, deadline = Date.now() + 4000 } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 64 || bytes.length > MAX_PDF_BYTES
      || !new TextDecoder().decode(bytes.subarray(0, 8)).startsWith('%PDF-')) {
    return { verdict: 'rejected', reason: 'not_pdf_or_size_limit', verifier: VERIFIER_VERSION };
  }
  if (!new TextDecoder().decode(bytes.subarray(Math.max(0, bytes.length - 8192))).includes('%%EOF')) {
    return { verdict: 'uncertain', reason: 'possibly_truncated_pdf', verifier: VERIFIER_VERSION };
  }
  let document, timer;
  try {
    const task = (async () => {
      // Parse only page one; never render images, execute PDF JavaScript or fetch resources.
      document = await parser(bytes.slice(), { isEvalSupported: false, enableXfa: false, useWorkerFetch: false,
        useSystemFonts: true, disableFontFace: true, disableAutoFetch: true, maxImageSize: 0,
        isOffscreenCanvasSupported: false, stopAtErrors: true, cMapUrl: undefined, standardFontDataUrl: undefined });
      if (!Number.isInteger(document.numPages) || document.numPages < 1 || document.numPages > 5000) {
        return { verdict: 'uncertain', reason: 'page_limit' };
      }
      const page = await document.getPage(1);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items.slice(0, 5000)) {
        if (typeof item.str === 'string') text += item.str + (item.hasEOL ? '\n' : ' ');
        if (text.length >= 24000) break;
      }
      const metadata = await document.getMetadata();
      return assessIdentity(target, { firstPageText: text, pdfTitle: metadata.info?.Title || '' });
    })();
    const result = await Promise.race([task, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('pdf_parse_timeout')), Math.max(1, Math.min(4000, deadline - Date.now())));
    })]);
    // Binding the result to the exact bytes prevents a later URL change swapping the article.
    return { ...result, verifier: VERIFIER_VERSION, doi: normalizeDoi(target.doi), sha256: await sha256(bytes), byte_length: bytes.length };
  } catch {
    return { verdict: 'uncertain', reason: 'pdf_not_readable', verifier: VERIFIER_VERSION };
  } finally {
    clearTimeout(timer);
    if (document?.loadingTask?.destroy) await document.loadingTask.destroy().catch(() => {});
    else if (document?.destroy) await document.destroy().catch(() => {});
  }
}
