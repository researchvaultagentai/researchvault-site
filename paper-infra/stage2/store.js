import { VERIFIER_VERSION } from './common.js';

export class PaperStore {
  constructor(db, clock = Date.now) { this.db = db; this.clock = clock; }
  async cached(doi) {
    const row = await this.db.prepare('SELECT * FROM rv_paper_cache WHERE doi=? AND expires_at>? AND verifier=?')
      .bind(doi, this.clock(), VERIFIER_VERSION).first();
    if (!row) return null;
    try { return { metadata: JSON.parse(row.metadata_json), candidate: JSON.parse(row.candidate_json), proof: JSON.parse(row.proof_json) }; }
    catch { return null; }
  }
  async cache(doi, metadata, candidate, proof) {
    if (proof.verdict !== 'verified' || proof.verifier !== VERIFIER_VERSION || proof.doi !== doi) throw new Error('unverified_cache_rejected');
    await this.db.prepare(`INSERT INTO rv_paper_cache(doi,metadata_json,candidate_json,proof_json,verifier,expires_at,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(doi) DO UPDATE SET metadata_json=excluded.metadata_json,
      candidate_json=excluded.candidate_json,proof_json=excluded.proof_json,verifier=excluded.verifier,
      expires_at=excluded.expires_at,updated_at=excluded.updated_at`)
      .bind(doi, JSON.stringify(metadata), JSON.stringify(candidate), JSON.stringify(proof), VERIFIER_VERSION, this.clock() + 900000, this.clock()).run();
  }
  async invalidate(doi) { await this.db.prepare('DELETE FROM rv_paper_cache WHERE doi=?').bind(doi).run(); }
  async claim(doi, lease) {
    const now = this.clock();
    const result = await this.db.prepare(`INSERT INTO rv_paper_jobs(doi,lease_id,lease_until,last_status,updated_at)
      VALUES(?,?,?,'running',?) ON CONFLICT(doi) DO UPDATE SET lease_id=excluded.lease_id,
      lease_until=excluded.lease_until,last_status='running',updated_at=excluded.updated_at,attempts=rv_paper_jobs.attempts+1
      WHERE rv_paper_jobs.lease_until<=? AND rv_paper_jobs.next_retry_at<=?`)
      .bind(doi, lease, now + 25000, now, now, now).run();
    return Number(result.meta?.changes || 0) === 1;
  }
  async metadata(doi) {
    const row = await this.db.prepare('SELECT metadata_json FROM rv_paper_metadata WHERE doi=? AND expires_at>?')
      .bind(doi, this.clock()).first();
    try { return row ? JSON.parse(row.metadata_json) : null; } catch { return null; }
  }
  async saveMetadata(metadata) {
    await this.db.prepare(`INSERT INTO rv_paper_metadata(doi,metadata_json,expires_at) VALUES(?,?,?)
      ON CONFLICT(doi) DO UPDATE SET metadata_json=excluded.metadata_json,expires_at=excluded.expires_at`)
      .bind(metadata.doi, JSON.stringify(metadata), this.clock() + 3600000).run();
  }
  async finish(doi, lease, status, retryAfterMs = 0) {
    return this.db.prepare(`UPDATE rv_paper_jobs SET lease_until=0,last_status=?,next_retry_at=?,updated_at=?
      WHERE doi=? AND lease_id=?`).bind(status, this.clock() + retryAfterMs, this.clock(), doi, lease).run();
  }
  async health(family) {
    const { results } = await this.db.prepare('SELECT * FROM rv_paper_source_stats WHERE family=?').bind(family).all();
    return new Map(results.map(row => [row.source, row]));
  }
  async record(source, family, { success = false, latencyMs = 0, retryAfterMs = 0, httpStatus = 0 } = {}) {
    const now = this.clock();
    await this.db.prepare(`INSERT INTO rv_paper_source_stats(source,family,attempts,successes,latency_ms,retry_at,last_http,updated_at)
      VALUES(?,?,1,?,?,?,?,?) ON CONFLICT(source,family) DO UPDATE SET attempts=rv_paper_source_stats.attempts+1,
      successes=rv_paper_source_stats.successes+excluded.successes,
      latency_ms=0.8*rv_paper_source_stats.latency_ms+0.2*excluded.latency_ms,
      retry_at=excluded.retry_at,last_http=excluded.last_http,updated_at=excluded.updated_at`)
      .bind(source, family, success ? 1 : 0, Math.min(60000, latencyMs), now + retryAfterMs, httpStatus, now).run();
  }
}

export function sourcePriority(base, row, now = Date.now()) {
  if (row?.retry_at > now) return -Infinity;
  if (!row || row.attempts < 3 || now - row.updated_at > 86400000) return base;
  // A smoothed success rate prevents one lucky/failed request dominating routing.
  const reliability = (row.successes + 2) / (row.attempts + 4);
  return base + 20 * (reliability - 0.5) - Math.min(10, row.latency_ms / 1000);
}
