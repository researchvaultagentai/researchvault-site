import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Real SQLite with the prepare/bind/first/all/run/batch surface used by D1.
// This tests SQL and transaction behavior locally, not the live D1 service.
export function sqliteD1() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec(readFileSync(new URL('../migrations/0001_work_control.sql', import.meta.url), 'utf8'));
  return {
    raw,
    prepare(sql) {
      const statement = raw.prepare(sql);
      const wrapper = {
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() { return statement.get(...this.args) ?? null; },
        async all() { return { results: statement.all(...this.args) }; },
        async run() { return { success: true, meta: statement.run(...this.args) }; },
        runSync() { return statement.run(...this.args); },
      };
      return wrapper;
    },
    async batch(statements) {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(statement => statement.runSync());
        raw.exec('COMMIT');
        return results;
      } catch (error) { raw.exec('ROLLBACK'); throw error; }
    },
  };
}
