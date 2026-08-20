import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

class Statement {
  constructor(statement) {
    this.statement = statement;
    this.bindings = [];
  }
  bind(...bindings) { this.bindings = bindings; return this; }
  async all() { return { success: true, results: this.statement.all(...this.bindings) }; }
  async first() { return this.statement.get(...this.bindings) || null; }
  async run() {
    const result = this.statement.run(...this.bindings);
    return { success: true, meta: { changes: result.changes } };
  }
}

export class D1Mock {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec(fs.readFileSync(new URL('../../migrations/0001_cloudflare_native.sql', import.meta.url), 'utf8'));
  }
  prepare(sql) { return new Statement(this.sqlite.prepare(sql)); }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) {
        if (/^\s*(SELECT|WITH)\b/i.test(statement.statement.sourceSQL || '')) results.push(await statement.all());
        else results.push(await statement.run());
      }
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}
