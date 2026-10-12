// Copyright 2026 Daksh Breja. All rights reserved.
import { DatabaseSync } from 'node:sqlite';

/** Real SQLite, with only the small SQL API surface used by Durable Objects. */
export function sqliteFixture({ filename = ':memory:', beforeExec = () => {} } = {}) {
  const database = new DatabaseSync(filename);
  let inTransaction = false;
  const storage = {
    sql: {
      exec(query, ...bindings) {
        beforeExec(query, bindings);
        const statement = database.prepare(query);
        const rows = statement.columns().length ? statement.all(...bindings) : (statement.run(...bindings), []);
        return { toArray: () => rows.map((row) => ({ ...row })), one: () => {
          if (rows.length !== 1) throw new Error('Expected exactly one row');
          return { ...rows[0] };
        }, [Symbol.iterator]: () => rows[Symbol.iterator]() };
      },
    },
    transactionSync(callback) {
      if (inTransaction) throw new Error('Unexpected nested transaction');
      inTransaction = true;
      database.exec('BEGIN');
      try { const result = callback(); database.exec('COMMIT'); return result; }
      catch (error) { database.exec('ROLLBACK'); throw error; }
      finally { inTransaction = false; }
    },
  };
  return { database, storage, close: () => database.close() };
}
