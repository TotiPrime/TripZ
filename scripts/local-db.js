import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function localDatabase(path=':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS trip_schema_migrations(name TEXT PRIMARY KEY);');
  const has=db.prepare('SELECT 1 FROM trip_schema_migrations WHERE name=?');
  const mark=db.prepare('INSERT INTO trip_schema_migrations(name) VALUES (?)');
  for (const name of ['0000_reservations','0001_interactive_plan','0002_customer_profiles','0003_requests_without_table_hold','0004_accounts']) {
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!has.get(name)) {
        db.exec(readFileSync(new URL('../drizzle/'+name+'.sql',import.meta.url),'utf8'));
        mark.run(name);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  let queue = Promise.resolve();
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {bind(...args) {
        return {
          sql,
          first: async () => stmt.get(...args) ?? null,
          all: async () => ({results:stmt.all(...args)}),
          run: async () => ({meta:stmt.run(...args)})
        };
      }};
    },
    batch(statements) {
      const batch = queue.then(async () => {
        db.exec('BEGIN');
        try {
          const results = [];
          for (const stmt of statements) results.push(await (/^SELECT /i.test(stmt.sql) ? stmt.all() : stmt.run()));
          db.exec('COMMIT');
          return results;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      });
      queue = batch.catch(() => {});
      return batch;
    }
  };
}
