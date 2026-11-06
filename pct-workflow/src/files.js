import { PDFDocument, PDFDict, PDFHexString, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { downloadB2, uploadB2 } from '../../patent-api/src/b2.js';
import { sanitizeFilename, sha256Hex, uid } from '../../patent-api/src/security.js';
import { ensure, packageReleased, reportReleased } from './state.js';

const txt = new TextEncoder();
const decoder = new TextDecoder();
const MAX_DOC = 15 * 1024 * 1024;
const MAX_VIDEO = 20 * 1024 * 1024;
const extensions = new Set('pdf doc docx txt rtf png jpg jpeg webp zip step stp iges igs dxf dwg sch kicad_sch brd json csv mp4'.split(' '));
const categories = {
  disclosure: extensions, identity: new Set(['pdf', 'png', 'jpg', 'jpeg']),
  pct_draft: new Set(['docx']), pct_feedback: new Set(['docx']),
  filing_receipt: new Set(['pdf']), filed_document: new Set(['pdf','docx','zip']),
  isa_report: new Set(['pdf']), isa_written_opinion: new Set(['pdf']),
  signed_agreement: new Set(['pdf','docx']), report_pdf: new Set(['pdf']), report_docx: new Set(['docx']), package_review: new Set(['pdf']),
  package_final: new Set(['docx','pdf','zip']), publication_notice: new Set(['pdf']),
};
const ADMIN_UPLOADS = {
  report_work: ['report_pdf', 'report_docx'],
  pct_drafting: ['pct_draft'], pct_draft_revision: ['pct_draft'],
  pct_finalizing: ['package_review', 'package_final'],
  pct_submitting: ['filing_receipt','filed_document'],
  isa_wait: ['isa_report','isa_written_opinion'],
  publication_wait: ['publication_notice'],
};

async function fileKey(env) {
  const hex = String(env.PCT_FILE_KEY || '');
  ensure(/^[a-f0-9]{64}$/i.test(hex), 'Private document storage is not configured.', 503, 'storage_unavailable');
  const bytes = Uint8Array.from(hex.match(/../g), x => Number.parseInt(x, 16));
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encrypt(env, key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: txt.encode(key) }, await fileKey(env), bytes));
  const packed = new Uint8Array(13 + cipher.length);
  packed[0] = 1; packed.set(iv, 1); packed.set(cipher, 13);
  return packed;
}

export async function putObject(env, key, bytes, { signal } = {}) {
  const packed = await encrypt(env, key, bytes);
  signal?.throwIfAborted();
  if (env.PCT_STORE) await env.PCT_STORE.put(key, packed);
  else await uploadB2(env, key, packed, {signal});
}

export async function getObject(env, key) {
  const value = env.PCT_STORE ? await (await env.PCT_STORE.get(key))?.arrayBuffer() : await downloadB2(env, key);
  ensure(value, 'Private document not found.', 404, 'document_not_found');
  const packed = new Uint8Array(value);
  ensure(packed.length >= 29 && packed[0] === 1, 'Invalid private document.', 500, 'invalid_object');
  return new Uint8Array(await crypto.subtle.decrypt({
    name: 'AES-GCM', iv: packed.subarray(1, 13), additionalData: txt.encode(key),
  }, await fileKey(env), packed.subarray(13)));
}

export function legalVersion(env, kind) {
  const p = kind === 'undertaking' ? 'PCT_UNDERTAKING' : 'PCT_AGREEMENT';
  const key = env[p + '_KEY'], version = env[p + '_VERSION'], sha256 = env[p + '_SHA256'];
  const extension = kind === 'undertaking' ? '.pdf' : '.docx';
  ensure(/^pct-workflow\/legal\/[a-zA-Z0-9._-]+$/.test(key || '') && key.endsWith(extension) &&
    /^[a-zA-Z0-9._-]{1,100}$/.test(version || '') && /^[a-f0-9]{64}$/.test(sha256 || ''),
  'The versioned private agreement is not configured.', 503, 'agreement_unavailable');
  return { key, version, sha256 };
}

export const legalView = ({ version, sha256 }) => ({ version, sha256 });

export async function checkedLegalBytes(env, doc) {
  const bytes = await getObject(env, doc.key);
  ensure(await sha256Hex(bytes) === doc.sha256, 'The agreement does not match its recorded version.', 503, 'agreement_unavailable');
  return bytes;
}

export function attachment(bytes, name, inline = false) {
  return new Response(bytes, { headers: {
    'content-type': inline ? 'application/pdf' : 'application/octet-stream',
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name).replaceAll("'", '%27')}`,
    'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  } });
}

const prefix = (b, s) => s.every((v, i) => b[i] === v);
const ascii = (b, start, end) => decoder.decode(b.subarray(start, end));

function validDocx(bytes) {
  // Look only at the ZIP central directory. Do not inflate untrusted entries.
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (v.getUint32(i, true) !== 0x06054b50 || i + 22 + v.getUint16(i + 20, true) !== bytes.length) continue;
    const count = v.getUint16(i + 10, true);
    let off = v.getUint32(i + 16, true);
    if (count > 3000 || off >= i) return false;
    const names = new Set();
    for (let j = 0; j < count; j++) {
      if (off + 46 > i || v.getUint32(off, true) !== 0x02014b50) return false;
      const len = v.getUint16(off + 28, true);
      if (off + 46 + len > i) return false;
      names.add(ascii(bytes, off + 46, off + 46 + len));
      off += 46 + len + v.getUint16(off + 30, true) + v.getUint16(off + 32, true);
    }
    return names.has('[Content_Types].xml') && names.has('word/document.xml') &&
      ![...names].some(name => /(?:^|\/)vbaProject\.bin$/i.test(name));
  }
  return false;
}

function mp4Duration(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  function boxes(start, end, name) {
    for (let p = start, count = 0; p + 8 <= end && count < 5000; count++) {
      let size = v.getUint32(p), head = 8;
      if (size === 1) {
        if (p + 16 > end) return null;
        size = Number(v.getBigUint64(p + 8)); head = 16;
      } else if (size === 0) size = end - p;
      if (size < head || p + size > end) return null;
      if (ascii(bytes, p + 4, p + 8) === name) return [p + head, p + size];
      p += size;
    }
    return null;
  }
  if (!boxes(0, bytes.length, 'ftyp')) return NaN;
  const moov = boxes(0, bytes.length, 'moov');
  if (!moov) return NaN;
  const mvhd = boxes(...moov, 'mvhd');
  if (!mvhd) return NaN;
  const [p, end] = mvhd;
  const ver = bytes[p], pos = p + (ver === 1 ? 20 : 12);
  if ((ver !== 0 && ver !== 1) || pos + (ver === 1 ? 12 : 8) > end) return NaN;
  const timescale = v.getUint32(pos);
  const duration = ver === 1 ? Number(v.getBigUint64(pos + 4)) : v.getUint32(pos + 4);
  return timescale ? duration / timescale : NaN;
}

function validBytes(bytes, ext) {
  if (ext === 'pdf') return ascii(bytes, 0, 5) === '%PDF-' && ascii(bytes, Math.max(0, bytes.length - 1024), bytes.length).includes('%%EOF');
  if (ext === 'docx') return validDocx(bytes);
  if (ext === 'zip') return prefix(bytes, [0x50,0x4b,0x03,0x04]);
  if (ext === 'png') return prefix(bytes, [137,80,78,71,13,10,26,10]);
  if (ext === 'jpg' || ext === 'jpeg') return prefix(bytes, [0xff,0xd8,0xff]);
  if (ext === 'webp') return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP';
  return true;
}

const concat = (...parts) => {
  const bytes = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
};
const same = (a, b) => a.length === b.length && a.reduce((diff, v, i) => diff | (v ^ b[i]), 0) === 0;
const digest = async (name, bytes) => new Uint8Array(await crypto.subtle.digest(name, bytes));

// PDF Standard Security Handler, ISO 32000-2 algorithm 2.B, user credential.
// WebCrypto adds one CBC padding block to our block-aligned input; discard it.
async function r6Hash(password, salt) {
  let k = await digest('SHA-256', concat(password, salt));
  let e, round = 0;
  do {
    const row = concat(password, k), repeated = new Uint8Array(row.length * 64);
    for (let i = 0; i < 64; i++) repeated.set(row, i * row.length);
    const key = await crypto.subtle.importKey('raw', k.subarray(0, 16), 'AES-CBC', false, ['encrypt']);
    e = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: k.subarray(16, 32) }, key, repeated)).subarray(0, repeated.length);
    const hash = ['SHA-256','SHA-384','SHA-512'][e.subarray(0, 16).reduce((a, b) => a + b, 0) % 3];
    k = await digest(hash, e); round++;
  } while (round < 64 || e[e.length - 1] > round - 32);
  return k.subarray(0, 32);
}

export async function verifyReportPdf(bytes, password) {
  ensure(typeof password === 'string' && /^[!-~]{12,80}$/.test(password),
    'Use a report open password of 12–80 printable ASCII characters without spaces.', 422, 'invalid_password');
  let dict, standard, user, crypt;
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: true });
    dict = doc.context.lookup(doc.context.trailerInfo.Encrypt, PDFDict);
    standard = dict.lookup(PDFName.of('Filter'), PDFName).toString() === '/Standard' &&
      dict.lookup(PDFName.of('V'), PDFNumber).asNumber() === 5 && dict.lookup(PDFName.of('R'), PDFNumber).asNumber() === 6;
    const encrypted = n => dict.lookup(PDFName.of(n), PDFName).toString();
    const cf = dict.lookup(PDFName.of('CF'), PDFDict);
    crypt = ['StmF', 'StrF'].every(n => cf.lookup(PDFName.of(encrypted(n).slice(1)), PDFDict)
      .lookup(PDFName.of('CFM'), PDFName).toString() === '/AESV3');
    user = dict.lookup(PDFName.of('U'), PDFHexString, PDFString).asBytes();
  } catch { /* unencrypted or malformed */ }
  ensure(standard && crypt && user?.length === 48,
    'Upload a PDF encrypted with AES-256 (revision 6) and a password required to open it.', 422, 'pdf_not_locked');
  const salt = user.subarray(32, 40), expected = user.subarray(0, 32);
  ensure(!same(await r6Hash(new Uint8Array(), salt), expected), 'This PDF opens without a password.', 422, 'pdf_not_locked');
  ensure(same(await r6Hash(txt.encode(password), salt), expected),
    'The supplied password does not open this PDF.', 422, 'incorrect_pdf_password');
}

export async function prepareUpload(req, row, admin) {
  const rawLength = Number(req.headers.get('content-length') || 0);
  ensure(rawLength <= MAX_VIDEO + 128 * 1024, 'Upload one file at a time, up to 20 MiB.', 413, 'file_too_large');
  let form;
  try { form = await req.formData(); } catch { ensure(false, 'A multipart document is required.', 422, 'invalid_upload'); }
  const file = form.get('file'), category = form.get('category');
  const s = row.state;
  const allowed = admin ? ADMIN_UPLOADS[s.stage]?.includes(category) :
    (category === 'disclosure' && !['declined','completed','closed_by_agreement','completion_due'].includes(s.stage)) ||
    (category === 'pct_feedback' && s.stage === 'pct_draft_review') || (category === 'identity' && s.stage === 'pct_intake') || (category === 'signed_agreement' && s.stage === 'quote_ready');
  ensure(s.undertaking?.sha256 && allowed, 'This kind of document cannot be uploaded at the current stage.');
  ensure(file instanceof File && file.size > 0 && s.documents.length < 80, 'Choose a file. A case can store up to 80 files.', 422, 'invalid_upload');
  const name = sanitizeFilename(file.name), ext = name.split('.').at(-1)?.toLowerCase();
  ensure(categories[category]?.has(ext), 'This file type is not allowed for the selected purpose.', 415, 'unsupported_file');
  ensure(file.size <= (ext === 'mp4' ? MAX_VIDEO : MAX_DOC), 'The selected file exceeds the upload limit.', 413, 'file_too_large');
  const bytes = new Uint8Array(await file.arrayBuffer());
  ensure(validBytes(bytes, ext), 'The file contents do not match its extension.', 422, 'invalid_document');
  if (ext === 'mp4') {
    const duration = mp4Duration(bytes);
    ensure(duration > 0 && duration <= 420, 'Upload an MP4 video of up to 7 minutes.', 422, 'invalid_video');
  }
  const id = uid('doc'), key = `pct-workflow/cases/${row.id}/${id}`;
  let passwordKey = null, password = null;
  if (category === 'report_pdf') {
    password = form.get('password');
    await verifyReportPdf(bytes, password);
    passwordKey = key + '.secret';
  }
  const doc = { id, key, password_key: passwordKey, category, name, size: bytes.length, sha256: await sha256Hex(bytes),
    ...(category === 'pct_feedback' ? { draft_id: s.drafts.at(-1).document_id } : {}),
    ...(category === 'signed_agreement' ? { quote_id: s.quote.id } : {}) };
  return {doc,bytes,password};
}

export async function storeUpload(env,{doc,bytes,password},options) {
  if (doc.password_key) await putObject(env,doc.password_key,txt.encode(password),options);
  await putObject(env,doc.key,bytes,options);
  return doc;
}

export function mayDownload(s, doc, admin) {
  if (admin) return true;
  if (doc.category === 'report_pdf') return s.report?.pdf_id === doc.id;
  if (doc.category === 'report_docx') return s.report?.word_id === doc.id && reportReleased(s);
  if (doc.category === 'pct_draft') return s.drafts?.some(d=>d.document_id===doc.id) || false;
  if (doc.category === 'package_review') return s.package?.review_id === doc.id && s.invoices.pct_ready?.status==='paid';
  if (doc.category === 'package_final') return s.package?.final_id === doc.id && packageReleased(s);
  if (doc.category === 'filing_receipt') return s.filing?.receipt_ids?.includes(doc.id) || false;
  if (doc.category === 'filed_document') return s.filing?.document_ids?.includes(doc.id) || false;
  if (doc.category === 'isa_report') return s.isa?.report_id === doc.id;
  if (doc.category === 'isa_written_opinion') return s.isa?.written_opinion_id === doc.id;
  if (doc.category === 'publication_notice') return s.completion?.document_id === doc.id;
  return ['disclosure', 'identity', 'signed_agreement', 'pct_feedback'].includes(doc.category);
}

export const documentView = ({ id, category, name, size, sha256, quote_id }) => ({ id, category, name, size, sha256, quote_id });
export const readPassword = async (env, doc) => decoder.decode(await getObject(env, doc.password_key));
