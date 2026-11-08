import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { newDb } from 'pg-mem';
import { createApp } from '../src/app';
import { migrate } from '../src/db';

let app: ReturnType<typeof createApp>;
let token = '';
const auth = () => ({ Authorization: `Bearer ${token}` });

before(async () => {
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  await migrate(pool);
  app = createApp(pool, 'test-secret');
});

test('без токена — 401', async () => {
  await request(app).get('/api/settings').expect(401);
});

test('регистрация, повторная регистрация, логин', async () => {
  const r = await request(app).post('/api/auth/register').send({ email: 'A@test.pl', password: 'secret1' }).expect(201);
  assert.ok(r.body.token);
  await request(app).post('/api/auth/register').send({ email: 'a@test.pl', password: 'secret1' }).expect(409);
  await request(app).post('/api/auth/login').send({ email: 'a@test.pl', password: 'wrong-pass' }).expect(401);
  const l = await request(app).post('/api/auth/login').send({ email: 'a@test.pl', password: 'secret1' }).expect(200);
  token = l.body.token;
});

test('настройки по умолчанию и частичное обновление', async () => {
  const s = await request(app).get('/api/settings').set(auth()).expect(200);
  assert.equal(s.body.dayRate, 33.4);
  assert.equal(s.body.netCoef, 0.77);
  const u = await request(app).put('/api/settings').set(auth()).send({ monthlyLiving: 0 }).expect(200);
  assert.equal(u.body.nightRate, 38.4);
  await request(app).put('/api/settings').set(auth()).send({ netCoef: 5 }).expect(400);
});

test('график: запись диапазона, перезапись, расчёт смены, удаление', async () => {
  await request(app).put('/api/shifts').set(auth()).send({ dates: ['2026-09-01'], kind: 'day', extra: false }).expect(200);
  await request(app).put('/api/shifts').set(auth()).send({ dates: ['2026-10-05'], kind: 'day', extra: false }).expect(200);
  await request(app).put('/api/shifts').set(auth()).send({ dates: ['2026-10-06'], kind: 'night', extra: false }).expect(200);
  // перезапись той же даты — одна запись, а не две
  await request(app).put('/api/shifts').set(auth()).send({ dates: ['2026-10-07', '2026-10-07'], kind: 'day', extra: true }).expect(200);
  let list = await request(app).get('/api/shifts?from=2026-10-01&to=2026-10-31').set(auth()).expect(200);
  assert.equal(list.body.length, 3);
  const night = list.body.find((s: any) => s.date === '2026-10-06');
  assert.equal(night.pay.gross, 369);
  await request(app).post('/api/shifts/clear').set(auth()).send({ dates: ['2026-10-07'] }).expect(200);
  list = await request(app).get('/api/shifts?from=2026-10-01&to=2026-10-31').set(auth()).expect(200);
  assert.equal(list.body.length, 2);
});

test('платежи, доходы, цели: создание и чужие данные недоступны', async () => {
  const e = await request(app)
    .post('/api/expenses')
    .set(auth())
    .send({ name: 'Зал', amount: 150, dayOfMonth: 10, startMonth: '2026-01', endMonth: null })
    .expect(201);
  assert.equal(e.body.amount, 150);
  const i = await request(app)
    .post('/api/incomes')
    .set(auth())
    .send({ name: 'Рефералка', amount: 500, date: '2026-11-20', status: 'potential' })
    .expect(201);
  const g = await request(app)
    .post('/api/goals')
    .set(auth())
    .send({ name: 'Ноутбук', target: 6000, saved: 1200, deadline: '2027-05' })
    .expect(201);

  const c = await request(app).post(`/api/goals/${g.body.id}/contribute`).set(auth()).send({ amount: 300 }).expect(200);
  assert.equal(c.body.saved, 1500);
  const w = await request(app).post(`/api/goals/${g.body.id}/contribute`).set(auth()).send({ amount: -300 }).expect(200);
  assert.equal(w.body.saved, 1200);

  // статус потенциального дохода меняется (сорвалось → не учитывается)
  await request(app)
    .put(`/api/incomes/${i.body.id}`)
    .set(auth())
    .send({ name: 'Рефералка', amount: 500, date: '2026-11-20', status: 'failed' })
    .expect(200);
  await request(app)
    .put(`/api/incomes/${i.body.id}`)
    .set(auth())
    .send({ name: 'Рефералка', amount: 500, date: '2026-11-20', status: 'potential' })
    .expect(200);

  // второй пользователь не видит и не меняет чужое
  const r2 = await request(app).post('/api/auth/register').send({ email: 'b@test.pl', password: 'secret2' }).expect(201);
  const b = { Authorization: `Bearer ${r2.body.token}` };
  assert.deepEqual((await request(app).get('/api/expenses').set(b)).body, []);
  await request(app).put(`/api/goals/${g.body.id}`).set(b).send({ name: 'x', target: 1, saved: 0, deadline: '2027-01' }).expect(404);
});

test('сводка: ноябрь = зарплата за октябрь + премия за сентябрь', async () => {
  const r = await request(app).get('/api/summary?from=2026-11&months=3').set(auth()).expect(200);
  assert.equal(r.body.months.length, 3);
  const nov = r.body.months[0];
  assert.equal(nov.cash.payout.date, '2026-11-07');
  assert.equal(nov.cash.payout.totalNet, 579.89);
  assert.equal(nov.cash.obligations, 150);
  assert.equal(nov.cash.free, 429.89);
  assert.equal(nov.cash.potentialIncome, 500);
  assert.equal(nov.cash.freeWithPotential, 929.89);
  assert.equal(r.body.months[0].work.gross, 0); // в ноябре смен ещё не внесено
  // октябрь — заработано
  const oct = (await request(app).get('/api/summary?from=2026-10&months=1').set(auth())).body.months[0];
  assert.equal(oct.work.gross, 703);
  assert.equal(oct.work.net, 541.31);
  // цель считается от месяца from
  assert.equal(r.body.goals.length, 1);
  assert.equal(r.body.goals[0].plan.remaining, 4800);
  assert.equal(r.body.goals[0].plan.monthsLeft, 6);
  assert.equal(r.body.totals.totalSaved, 1200);
});

test('валидация: плохая дата и месяц', async () => {
  await request(app).put('/api/shifts').set(auth()).send({ dates: ['2026-13-1'], kind: 'day' }).expect(400);
  await request(app).get('/api/summary?from=2026-1').set(auth()).expect(400);
});

test('смена с ручным признаком выходного: сохранение, чтение, смена типа, сброс', async () => {
  // 2026-11-11 — среда
  await request(app).put('/api/shifts').set(auth()).send({ dates: ['2026-11-11'], kind: 'night', extra: true, weekend: true }).expect(200);
  let list = await request(app).get('/api/shifts?from=2026-11-01&to=2026-11-30').set(auth()).expect(200);
  let s = list.body.find((x: any) => x.date === '2026-11-11');
  assert.equal(s.weekend, true);
  assert.equal(s.extra, true);
  assert.equal(s.pay.mult, 2.5);
  assert.equal(s.pay.gross, 922.5);

  // правка той же даты: убираем «доп.», возвращаем «по календарю»
  await request(app).put('/api/shifts').set(auth()).send({ dates: ['2026-11-11'], kind: 'night', extra: false, weekend: null }).expect(200);
  list = await request(app).get('/api/shifts?from=2026-11-01&to=2026-11-30').set(auth()).expect(200);
  s = list.body.find((x: any) => x.date === '2026-11-11');
  assert.equal(s.weekend, null);
  assert.equal(s.pay.mult, 1);

  // без поля weekend — по календарю (обратная совместимость клиента)
  await request(app).put('/api/shifts').set(auth()).send({ dates: ['2026-11-12'], kind: 'day' }).expect(200);
  list = await request(app).get('/api/shifts?from=2026-11-01&to=2026-11-30').set(auth()).expect(200);
  assert.equal(list.body.find((x: any) => x.date === '2026-11-12').weekend, null);

  // полное удаление
  await request(app).post('/api/shifts/clear').set(auth()).send({ dates: ['2026-11-11', '2026-11-12'] }).expect(200);
  list = await request(app).get('/api/shifts?from=2026-11-01&to=2026-11-30').set(auth()).expect(200);
  assert.equal(list.body.length, 0);
});
