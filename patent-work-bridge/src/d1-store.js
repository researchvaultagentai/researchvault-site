import { ControlError, identifier, requireValue, sha256 } from './contracts.js';
import { initialState, transition, canDeliverWorkEvent } from './workflow.js';

// D1 batch() executes sequentially in a transaction. No network call belongs here.
export class D1WorkStore {
  constructor(db) { this.db = db; }

  async initialize({ caseId, ownerId, reportLanguage }) {
    const state = initialState(caseId, ownerId, reportLanguage);
    await this.db.prepare(`INSERT OR IGNORE INTO patent_work_bridge_state
      (case_id, version, state_json) VALUES (?, 0, ?)`).bind(caseId, JSON.stringify(state)).run();
    const existing = await this.read(caseId);
    requireValue(existing.ownerId === ownerId, 'case_owner_conflict');
    return existing;
  }

  async read(caseId) {
    identifier(caseId);
    const row = await this.db.prepare('SELECT state_json FROM patent_work_bridge_state WHERE case_id = ?')
      .bind(caseId).first();
    requireValue(row, 'case_not_initialized');
    return JSON.parse(row.state_json);
  }

  async command(commandId, requestHash) {
    const row = await this.db.prepare(`SELECT request_hash, result_json FROM patent_work_bridge_commands
      WHERE command_id = ?`).bind(commandId).first();
    if (!row) return null;
    requireValue(row.request_hash === requestHash, 'command_id_conflict');
    return { state: JSON.parse(row.result_json), replayed: true };
  }

  async execute({ caseId, commandId, expectedVersion, event, actor, now = new Date().toISOString() }) {
    identifier(caseId); identifier(commandId);
    requireValue(Number.isSafeInteger(expectedVersion) && expectedVersion >= 0, 'invalid_expected_version');
    requireValue(typeof now === 'string' && Number.isFinite(Date.parse(now)), 'invalid_timestamp');
    const requestHash = await sha256({ caseId, expectedVersion, event, actor });
    const previous = await this.command(commandId, requestHash);
    if (previous) return previous;
    const state = await this.read(caseId);
    requireValue(state.version === expectedVersion, 'state_version_conflict');
    const result = transition(state, event, actor);
    const resultJson = JSON.stringify(result.state);
    const commandKey = await sha256(commandId);
    const statements = [
      this.db.prepare(`INSERT OR IGNORE INTO patent_work_bridge_commands
        (command_id, case_id, request_hash, result_json, created_at)
        SELECT ?, ?, ?, ?, ? FROM patent_work_bridge_state WHERE case_id = ? AND version = ?`)
        .bind(commandId, caseId, requestHash, resultJson, now, caseId, expectedVersion),
      this.db.prepare(`UPDATE patent_work_bridge_state SET version = ?, state_json = ?, last_command_id = ?
        WHERE case_id = ? AND version = ? AND EXISTS (
          SELECT 1 FROM patent_work_bridge_commands WHERE command_id = ? AND request_hash = ? AND case_id = ?)`)
        .bind(result.state.version, resultJson, commandId, caseId, expectedVersion, commandId, requestHash, caseId),
      ...result.effects.map((effect, index) => this.db.prepare(`INSERT OR IGNORE INTO patent_work_bridge_outbox
        (event_id, case_id, destination, event_name, payload_json, created_at)
        SELECT ?, ?, ?, ?, ?, ? FROM patent_work_bridge_state
          WHERE case_id = ? AND version = ? AND last_command_id = ?`)
        .bind(`${commandKey}_${index}`, caseId, effect.destination, effect.name, JSON.stringify(effect), now,
          caseId, result.state.version, commandId)),
    ];
    await this.db.batch(statements);
    const committed = await this.command(commandId, requestHash);
    if (!committed) throw new ControlError('state_version_conflict');
    return { ...committed, replayed: false };
  }

  async pending(limit = 50) {
    requireValue(Number.isSafeInteger(limit) && limit > 0 && limit <= 100, 'invalid_batch_size');
    const result = await this.db.prepare(`SELECT event_id, payload_json FROM patent_work_bridge_outbox
      WHERE status = 'queued' ORDER BY created_at, event_id LIMIT ?`).bind(limit).all();
    return result.results.map(row => ({ id: row.event_id, ...JSON.parse(row.payload_json) }));
  }

  // Check immediately before dispatch. The recipient must still claim the exact
  // stage atomically: a delayed webhook is only a wake-up hint, never permission.
  async eligible(event) {
    if (event.destination !== 'work') return event.destination === 'telegram_admin';
    return canDeliverWorkEvent(event, await this.read(event.case_id));
  }

  async acknowledge(eventId, status) {
    identifier(eventId);
    requireValue(status === 'sent' || status === 'dropped', 'invalid_outbox_status');
    await this.db.prepare(`UPDATE patent_work_bridge_outbox SET status = ?
      WHERE event_id = ? AND status = 'queued'`).bind(status, eventId).run();
  }
}
