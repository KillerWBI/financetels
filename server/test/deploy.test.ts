import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { newDb } from 'pg-mem';
import { createApp } from '../src/app';
import { migrate } from '../src/db';
import { serveClient } from '../src/static';

async function makeApp() {
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  await migrate(pool);
  return createApp(pool, 'test-secret');
}

test('health-check открыт без входа и проверяет БД', async () => {
  const app = await makeApp();
  const r = await request(app).get('/api/health').expect(200);
  assert.deepEqual(r.body, { ok: true });
});

test('без сборки клиента serveClient ничего не подключает', async () => {
  const app = await makeApp();
  assert.equal(serveClient(app, join(tmpdir(), 'no-such-dist-dir')), false);
});

test('сборка клиента: корень и клиентские пути отдают index.html, /api остаётся API', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dist-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Смены и деньги</title>');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');

  const app = await makeApp();
  assert.equal(serveClient(app, dir), true);

  const root = await request(app).get('/').expect(200);
  assert.match(root.text, /Смены и деньги/);
  const deep = await request(app).get('/calendar/2026-11').expect(200);
  assert.match(deep.text, /Смены и деньги/);
  const js = await request(app).get('/assets/app.js').expect(200);
  assert.match(js.headers['content-type'], /javascript/);

  // API не подменяется страницей: без токена — 401, а не HTML
  const api = await request(app).get('/api/settings').expect(401);
  assert.equal(api.body.error, 'Нужен вход');
  await request(app).get('/api/health').expect(200);
});
