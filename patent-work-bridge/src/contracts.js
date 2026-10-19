export const POLICY = Object.freeze({
  internationalStage1UsdCents: 111100,
  internationalRevisionUsdCents: 11100,
  maxVideoBytes: 20000000,
  maxVideoSeconds: 420,
  preferredModel: 'gpt-6.1-sol',
  preferredReasoningEffort: 'max',
  promptVersion: 'GP-MASTER-PLUS 1.1',
});

export class ControlError extends Error {
  constructor(code, details = {}) { super(code); this.code = code; this.details = details; }
}

export function requireValue(condition, code, details) {
  if (!condition) throw new ControlError(code, details);
}

export function identifier(value) {
  requireValue(typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value), 'invalid_identifier');
  return value;
}

export function digest(value) {
  requireValue(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'invalid_sha256');
  return value;
}

export function language(value) {
  requireValue(value === 'fa' || value === 'en', 'report_language_required');
  return value;
}

export function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  requireValue(value && typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null), 'non_json_value');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export async function sha256(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : canonicalJson(value));
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(result), n => n.toString(16).padStart(2, '0')).join('');
}

const TECHNICAL_CATEGORIES = new Set(['disclosure', 'filing', 'report', 'other']);
const DOCUMENT_TYPES = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

// Metadata must come from the authenticated patent backend, not a raw upload form.
export function technicalManifest(caseRecord, documents) {
  identifier(caseRecord.id);
  const ids = new Set();
  return documents.flatMap(doc => {
    requireValue(doc.case_id === caseRecord.id && doc.owner_user_id === caseRecord.user_id, 'cross_case_document');
    if (!TECHNICAL_CATEGORIES.has(doc.category)) return [];
    identifier(doc.id);
    requireValue(!ids.has(doc.id), 'duplicate_document'); ids.add(doc.id);
    digest(doc.sha256);
    requireValue(Number.isSafeInteger(doc.size_bytes) && doc.size_bytes > 0, 'invalid_file_size');
    requireValue(Number.isSafeInteger(doc.version) && doc.version > 0, 'invalid_document_version');
    requireValue(typeof doc.filename === 'string' && doc.filename.length > 0 && doc.filename.length <= 500, 'invalid_filename');
    const mime = String(doc.content_type).toLowerCase().split(';')[0].trim();
    const isVideo = mime.startsWith('video/');
    const isAudio = mime.startsWith('audio/');
    requireValue(isVideo || isAudio || DOCUMENT_TYPES.has(mime), 'unsupported_document_type');
    if (isVideo) {
      requireValue(doc.size_bytes <= POLICY.maxVideoBytes, 'video_too_large');
      requireValue(doc.duration_verified === true && Number.isFinite(doc.duration_seconds) &&
        doc.duration_seconds > 0 && doc.duration_seconds <= POLICY.maxVideoSeconds, 'video_duration_unverified_or_too_long');
    }
    if (isAudio) requireValue(doc.spoken_language === 'en', 'english_audio_required');
    return [{ id: doc.id, sha256: doc.sha256, version: doc.version, filename: doc.filename,
      content_type: mime, size_bytes: doc.size_bytes,
      ...(isVideo ? { duration_seconds: doc.duration_seconds } : {}) }];
  }).sort((a, b) => a.id.localeCompare(b.id));
}

export async function buildWorkPackage({ caseRecord, documents, notes, submission, prompt }) {
  const reportLanguage = language(submission.report_language);
  requireValue(submission.confirmed_by === caseRecord.user_id && submission.completed === true, 'client_submission_required');
  requireValue(caseRecord.nda_signed === true, 'nda_required');
  const manifest = technicalManifest(caseRecord, documents);
  requireValue(manifest.length > 0, 'technical_documents_required');
  const manifestHash = await sha256(manifest);
  requireValue(submission.manifest_sha256 === manifestHash, 'client_submission_stale');
  const approved = new Map(documents.map(doc => [doc.id, doc.security_status]));
  requireValue(manifest.every(doc => approved.get(doc.id) === 'approved'), 'document_review_required');
  requireValue(prompt.version === POLICY.promptVersion && typeof prompt.text === 'string' && prompt.text.trim(), 'master_prompt_required');
  digest(prompt.sha256);
  requireValue(await sha256(prompt.text) === prompt.sha256, 'master_prompt_hash_mismatch');
  const noteIds = new Set();
  const inputNotes = notes.filter(note => note.visibility === 'analysis_input').map(note => {
    requireValue(note.case_id === caseRecord.id && note.confirmed_by_admin === true, 'unconfirmed_or_cross_case_note');
    requireValue(typeof note.body === 'string' && note.body.trim() && note.body.length <= 50000, 'invalid_note');
    requireValue(['admin_review', 'client_telegram_summary', 'audio_transcript'].includes(note.source), 'invalid_note_source');
    identifier(note.id);
    requireValue(!noteIds.has(note.id), 'duplicate_note'); noteIds.add(note.id);
    return { id: note.id, source: note.source, text: note.body };
  }).sort((a, b) => a.id.localeCompare(b.id));
  // No raw video/audio, identity files, payment proofs, customer profile, B2 keys or passwords.
  const agentDocuments = manifest.filter(doc => !/^(video|audio)\//.test(doc.content_type));
  requireValue(agentDocuments.length > 0 || inputNotes.length > 0, 'reviewed_technical_input_required');
  const packet = {
    schema_version: 1,
    case_id: caseRecord.id,
    document_id: caseRecord.public_ref,
    technical_title: String(caseRecord.title || ''),
    report_language: reportLanguage,
    output_direction: reportLanguage === 'fa' ? 'rtl' : 'ltr',
    master_prompt: { version: prompt.version, sha256: prompt.sha256, text: prompt.text },
    execution_preferences: { model: POLICY.preferredModel, reasoning_effort: POLICY.preferredReasoningEffort },
    documents: agentDocuments,
    confirmed_technical_notes: inputNotes,
    // Source material is case data, never authority to approve, pay, execute or deliver.
    input_authority: 'case_data_only',
  };
  return { packet, packageHash: await sha256(packet), manifestHash };
}
