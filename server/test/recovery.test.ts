import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { newDb } from 'pg-mem';
import { createApp } from '../src/app';
import { migrate } from '../src/db';

const KEY = 'test-recovery-key-123456';

async function makeApp(key: string | undefined | null = KEY) {
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  await migrate(pool);
  return createApp(pool, 'test-secret', key ?? undefined);
}

test('без RECOVERY_KEY восстановление выключено', async () => {
  const app = await makeApp(null);
  await request(app).post('/api/auth/recovery/accounts').send({ key: 'anything' }).expect(404);
  await request(app).post('/api/auth/recovery/link').send({ key: 'anything', userId: 1 }).expect(404);
});

test('неверный ключ не даёт ни списка аккаунтов, ни ссылки; после 10 ошибок блокировка', async () => {
  const app = await makeApp();
  await request(app).post('/api/auth/register').send({ email: 'a@b.pl', password: 'secret1' }).expect(201);
  await request(app).post('/api/auth/recovery/accounts').send({ key: 'wrong' }).expect(403);
  await request(app).post('/api/auth/recovery/accounts').send({}).expect(403);
  await request(app).post('/api/auth/recovery/link').send({ key: 'wrong', userId: 1 }).expect(403);
  for (let i = 0; i < 7; i++) await request(app).post('/api/auth/recovery/accounts').send({ key: 'x' + i }).expect(403);
  // уже 10 ошибок: даже верный ключ временно заблокирован
  await request(app).post('/api/auth/recovery/accounts').send({ key: KEY }).expect(429);
});

test('слишком короткий ключ на сервере отключает восстановление', async () => {
  const app = await makeApp('short');
  await request(app).post('/api/auth/recovery/accounts').send({ key: 'short' }).expect(404);
});

test('полный сценарий: список аккаунтов с данными → ссылка → новый пароль → вход; ссылка одноразовая', async () => {
  const app = await makeApp();
  const reg = await request(app).post('/api/auth/register').send({ email: 'me@x.pl', password: 'oldpass1' }).expect(201);
  await request(app).post('/api/auth/register').send({ email: 'empty@x.pl', password: 'oldpass2' }).expect(201);
  await request(app)
    .put('/api/shifts')
    .set('Authorization', `Bearer ${reg.body.token}`)
    .send({ dates: ['2026-11-02', '2026-11-03'], kind: 'day', extra: false })
    .expect(200);

  const list = await request(app).post('/api/auth/recovery/accounts').send({ key: KEY }).expect(200);
  assert.equal(list.body.length, 2);
  const mine = list.body.find((a: any) => a.email === 'me@x.pl');
  assert.equal(mine.shifts, 2);
  assert.equal(list.body.find((a: any) => a.email === 'empty@x.pl').shifts, 0);
  assert.equal(JSON.stringify(list.body).includes('hash'), false);

  const link = await request(app).post('/api/auth/recovery/link').send({ key: KEY, userId: mine.id }).expect(200);
  assert.match(link.body.path, /^\/\?reset=/);

  // токен сброса нельзя использовать как обычный токен доступа
  await request(app).get('/api/settings').set('Authorization', `Bearer ${link.body.token}`).expect(401);

  const done = await request(app).post('/api/auth/reset').send({ token: link.body.token, password: 'newpass1' }).expect(200);
  await request(app).get('/api/settings').set('Authorization', `Bearer ${done.body.token}`).expect(200);
  await request(app).post('/api/auth/login').send({ email: 'me@x.pl', password: 'newpass1' }).expect(200);
  await request(app).post('/api/auth/login').send({ email: 'me@x.pl', password: 'oldpass1' }).expect(401);

  // данные на месте
  const shifts = await request(app).get('/api/shifts?from=2026-11-01&to=2026-11-30').set('Authorization', `Bearer ${done.body.token}`).expect(200);
  assert.equal(shifts.body.length, 2);

  // повторное использование ссылки отклоняется
  await request(app).post('/api/auth/reset').send({ token: link.body.token, password: 'another1' }).expect(400);
});

test('сброс: короткий пароль и мусорный токен отклоняются', async () => {
  const app = await makeApp();
  await request(app).post('/api/auth/reset').send({ token: 'garbage', password: 'newpass1' }).expect(400);
  await request(app).post('/api/auth/reset').send({ token: 'garbage', password: '123' }).expect(400);
});
