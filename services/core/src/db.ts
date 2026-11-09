import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Db = Database;

const MIGRATIONS = readFileSync(join(import.meta.dir, "migrations.sql"), "utf8");

export function openDb(path = process.env.LAYOVER_DB ?? "layover.db"): Db {
  const db = new Database(path, { create: true, strict: true });
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(MIGRATIONS);
  return db;
}

export function kvGet(db: Db, k: string): string | undefined {
  const row = db.query<{ v: string }, [string]>("SELECT v FROM kv WHERE k = ?").get(k);
  return row?.v;
}

export function kvSet(db: Db, k: string, v: string) {
  db.query("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, v);
}
