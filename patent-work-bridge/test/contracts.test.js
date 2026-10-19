import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkPackage, POLICY, sha256, technicalManifest } from '../src/contracts.js';
import { intake } from './fixtures.js';

test('package uses explicit report language and excludes private records and raw media', async () => {
  const input = await intake();
  input.documents.push({ ...input.documents[0], id: 'video_1', filename: 'clip.mp4', content_type: 'video/mp4',
    duration_verified: true, duration_seconds: 420, size_bytes: 20000000 });
  input.documents.push({ ...input.documents[0], id: 'identity_1', category: 'identity', filename: 'identity.pdf' });
  input.notes.push({ id: 'note_1', case_id: 'case_1', visibility: 'analysis_input', confirmed_by_admin: true,
    source: 'admin_review', body: 'Human review of video in Persian must not change report language.' });
  input.notes.push({ visibility: 'private', body: 'INTERNAL-SECRET' });
  input.submission.manifest_sha256 = await sha256(technicalManifest(input.caseRecord, input.documents));
  const result = await buildWorkPackage(input);
  assert.equal(result.packet.report_language, 'en');
  assert.equal(result.packet.output_direction, 'ltr');
  assert.equal(result.packet.execution_preferences.reasoning_effort, 'max');
  assert.deepEqual(result.packet.documents.map(d => d.id), ['doc_1']);
  assert.equal(result.packet.confirmed_technical_notes.length, 1);
  assert.doesNotMatch(JSON.stringify(result.packet), /PRIVATE-BUCKET-KEY|private@example|identity.pdf|clip.mp4|INTERNAL-SECRET/);
  input.submission.report_language = 'fa';
  const persian = await buildWorkPackage(input);
  assert.equal(persian.packet.output_direction, 'rtl');
  assert.notEqual(persian.packageHash, result.packageHash);
});

test('source data cannot bypass NDA, customer completion, file review or template integrity', async () => {
  const mutations = [
    [i => { i.caseRecord.nda_signed = false; }, 'nda_required'],
    [i => { i.submission.completed = false; }, 'client_submission_required'],
    [i => { i.submission.confirmed_by = 'different_client'; }, 'client_submission_required'],
    [i => { i.submission.report_language = ''; }, 'report_language_required'],
    [i => { i.documents[0].security_status = 'quarantine'; }, 'document_review_required'],
    [i => { i.documents[0].sha256 = 'b'.repeat(64); }, 'client_submission_stale'],
    [i => { i.documents[0].case_id = 'case_2'; }, 'cross_case_document'],
    [i => { i.prompt.text += ' tampered'; }, 'master_prompt_hash_mismatch'],
  ];
  for (const [mutate, code] of mutations) {
    const input = await intake(); mutate(input);
    await assert.rejects(buildWorkPackage(input), { code });
  }
});

test('video limits require server-verified duration and accept exactly 20 MB / 7 minutes', async () => {
  const input = await intake();
  const video = { ...input.documents[0], content_type: 'video/mp4', size_bytes: POLICY.maxVideoBytes,
    duration_verified: true, duration_seconds: POLICY.maxVideoSeconds };
  assert.equal(technicalManifest(input.caseRecord, [video]).length, 1);
  assert.throws(() => technicalManifest(input.caseRecord, [{ ...video, size_bytes: POLICY.maxVideoBytes + 1 }]), { code: 'video_too_large' });
  for (const bad of [{ duration_seconds: 421 }, { duration_verified: false }, { duration_seconds: 0 }]) {
    assert.throws(() => technicalManifest(input.caseRecord, [{ ...video, ...bad }]), { code: 'video_duration_unverified_or_too_long' });
  }
  assert.throws(() => technicalManifest(input.caseRecord, [{ ...video, content_type: 'audio/mpeg', spoken_language: 'fa' }]), { code: 'english_audio_required' });
});

test('only explicitly confirmed case notes can supply human video/transcript input', async () => {
  const input = await intake();
  const note = { id: 'note_1', case_id: 'case_1', visibility: 'analysis_input', confirmed_by_admin: true,
    source: 'client_telegram_summary', body: 'Confirmed technical addition.' };
  input.notes = [{ ...note, case_id: 'case_2' }];
  await assert.rejects(buildWorkPackage(input), { code: 'unconfirmed_or_cross_case_note' });
  input.notes = [{ ...note, confirmed_by_admin: false }];
  await assert.rejects(buildWorkPackage(input), { code: 'unconfirmed_or_cross_case_note' });
  input.notes = [note, note];
  await assert.rejects(buildWorkPackage(input), { code: 'duplicate_note' });
});
