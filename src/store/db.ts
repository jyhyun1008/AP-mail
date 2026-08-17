import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/**
 * Opens (creating if needed) the SQLite database at dbPath and applies schema.sql.
 * schema.sql uses `CREATE TABLE IF NOT EXISTS`/`CREATE INDEX IF NOT EXISTS`, so this
 * is safe to run on every boot — there is no separate migration runner in v1.
 */
export function openDatabase(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  db.exec(schema);

  return db;
}
