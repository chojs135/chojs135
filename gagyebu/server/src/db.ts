import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CATEGORIES } from "./defaults.js";

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "gagyebu.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS households (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  sheet_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  type TEXT NOT NULL CHECK (type IN ('expense','income','transfer')),
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#8884d8',
  subcategories TEXT NOT NULL DEFAULT '[]',
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (household_id, type, name)
);
CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  filenames TEXT NOT NULL,
  doc_type TEXT,
  summary TEXT,
  draft TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('expense','income','transfer')),
  amount INTEGER NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  subcategory TEXT NOT NULL DEFAULT '',
  merchant TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT '',
  member_id INTEGER REFERENCES users(id),
  memo TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  upload_id INTEGER REFERENCES uploads(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_household_date ON transactions(household_id, date);
CREATE TABLE IF NOT EXISTS merchant_rules (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  keyword TEXT NOT NULL,
  type TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  subcategory TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (household_id, keyword)
);
CREATE TABLE IF NOT EXISTS budgets (
  household_id INTEGER NOT NULL REFERENCES households(id),
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  PRIMARY KEY (household_id, category_id)
);
`);

export function seedCategories(householdId: number) {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO categories (household_id, type, name, icon, color, subcategories, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    DEFAULT_CATEGORIES.forEach((c, i) =>
      insert.run(householdId, c.type, c.name, c.icon, c.color, JSON.stringify(c.subcategories), i),
    );
  })();
}

export type Category = {
  id: number;
  type: "expense" | "income" | "transfer";
  name: string;
  icon: string;
  color: string;
  subcategories: string[];
  sort: number;
};

export function getCategories(householdId: number): Category[] {
  const rows = db
    .prepare(`SELECT id, type, name, icon, color, subcategories, sort FROM categories WHERE household_id = ? ORDER BY sort, id`)
    .all(householdId) as (Omit<Category, "subcategories"> & { subcategories: string })[];
  return rows.map((r) => ({ ...r, subcategories: JSON.parse(r.subcategories) }));
}
