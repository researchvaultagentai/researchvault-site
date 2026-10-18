import { POLICY, sha256, technicalManifest } from '../src/contracts.js';
import { initialState, transition } from '../src/workflow.js';

export const admin = { role: 'admin', id: 'admin_1' };
export const client = { role: 'client', id: 'client_1' };
export const agent = { role: 'agent', caseId: 'case_1', runId: 'run_1', executionId: 'chat_1' };
export const HASH = 'a'.repeat(64);

export async function intake(overrides = {}) {
  const caseRecord = { id: 'case_1', user_id: 'client_1', public_ref: 'RV-DEMO-001',
    title: 'Test mechanism', nda_signed: true, email: 'private@example.invalid' };
  const documents = [{ id: 'doc_1', case_id: 'case_1', owner_user_id: 'client_1', category: 'disclosure',
    filename: 'technical.pdf', object_key: 'PRIVATE-BUCKET-KEY', content_type: 'application/pdf',
    size_bytes: 1234, version: 1, sha256: HASH, security_status: 'approved' }];
  const prompt = { version: POLICY.promptVersion, text: 'TEST TEMPLATE ONLY. No patent research.' };
  prompt.sha256 = await sha256(prompt.text);
  const input = { caseRecord, documents, notes: [], prompt, ...overrides };
  input.submission = { completed: true, confirmed_by: caseRecord.user_id, report_language: 'en',
    manifest_sha256: await sha256(technicalManifest(input.caseRecord, input.documents)), ...overrides.submission };
  return input;
}

export function submitted() {
  let state = initialState('case_1', 'client_1', 'en');
  state = transition(state, { type: 'inputs_changed', packageHash: HASH, reportLanguage: 'en' }, client).state;
  return transition(state, { type: 'client_submitted', inputRevision: 1 }, client).state;
}

export function authorized() {
  return transition(submitted(), { type: 'authorize_run', runId: 'run_1', inputRevision: 1, packageHash: HASH }, admin).state;
}
