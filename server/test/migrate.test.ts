import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { newDb } from 'pg-mem';

const schema = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/schema.sql'), 'utf8');

// pg-mem не умеет повторно выполнять CREATE TABLE IF NOT EXISTS для существующих таблиц,
// поэтому здесь проверяется сам оператор миграции. Полный прогон на настоящем PostgreSQL
// делается отдельно (старая схема → migrate() → API).
test('ALTER из schema.sql добавляет weekend в старую таблицу shifts и безопасен при повторе', async () => {
  const alter = schema
    .split(';')
    .map((s) => s.replace(/--.*$/gm, '').trim())
    .find((s) => /^ALTER TABLE shifts ADD COLUMN IF NOT EXISTS weekend/i.test(s));
  assert.ok(alter, 'в schema.sql нет миграции для weekend');

  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  await pool.query('CREATE TABLE shifts (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL, extra BOOLEAN NOT NULL DEFAULT FALSE)');
  await pool.query("INSERT INTO shifts (user_id, date, kind, extra) VALUES (1, '2026-10-05', 'day', false)");

  await pool.query(alter);
  await pool.query(alter);

  const r = await pool.query('SELECT date, weekend FROM shifts');
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].weekend, null);
  await pool.query("UPDATE shifts SET weekend = TRUE WHERE date = '2026-10-05'");
  assert.equal((await pool.query('SELECT weekend FROM shifts')).rows[0].weekend, true);
});
