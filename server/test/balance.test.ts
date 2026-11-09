import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { newDb } from 'pg-mem';
import { createApp } from '../src/app';
import { migrate } from '../src/db';
import { DEFAULT_SETTINGS as S, round2, buildBalance, type Expense, type Goal, type ManualIncome, type Shift } from '../../shared/core';

// Сценарий: сегодня 2026-11-09. В октябре 2 дневные смены (668 brutto → 514,36 на руки).
// Выплата 7 ноября = 514,36 (премия за сентябрь 0). Премия за октябрь 77,15 придёт 7 декабря.
const shifts: Shift[] = [
  { date: '2026-10-05', kind: 'day', extra: false },
  { date: '2026-10-06', kind: 'day', extra: false },
];
const gym: Expense = { name: 'Зал', amount: 100, dayOfMonth: 5, startMonth: '2026-01', endMonth: null };
const rent: Expense = { name: 'Аренда', amount: 500, dayOfMonth: 15, startMonth: '2026-01', endMonth: null };
const TODAY = '2026-11-09';
const check = { date: '2026-11-01', amount: 1000 };

test('баланс сейчас = ручная сумма + выплаты − платежи после даты проверки', () => {
  const r = buildBalance(S, shifts, [gym, rent], [], [], [check], TODAY);
  // 1000 − зал (5 ноября) + выплата (7 ноября). Аренда 15-го ещё впереди.
  assert.equal(r.expectedNow, 1414.36);
  assert.equal(r.nextPayday.date, '2026-12-07');
  assert.equal(r.nextPayday.daysLeft, 28);
  assert.equal(r.nextPayday.amount, 77.15);
});

test('сколько можно потратить: минус платежи до выплаты', () => {
  const r = buildBalance(S, shifts, [gym, rent], [], [], [check], TODAY);
  // до 7 декабря: аренда 15 ноября (500) и зал 5 декабря (100)
  assert.equal(r.dueBeforePayday.total, 600);
  assert.equal(r.safeToSpend, 814.36);
  assert.equal(r.verdict, 'ok');
  assert.equal(r.lowest.amount, 814.36);
  assert.equal(r.lowest.date, '2026-12-05');
});

test('повседневные траты вычитаются равномерно по дням', () => {
  const s = { ...S, monthlyLiving: 730 }; // ровно 24 zł в день
  const r = buildBalance(s, shifts, [gym, rent], [], [], [check], TODAY);
  assert.equal(r.expectedNow, 1222.36); // 1000 − 100 + 514,36 − 24 × 8 дней
  assert.equal(r.livingReserve, 672); // 28 дней до выплаты
  assert.equal(r.safeToSpend, -49.64);
  assert.equal(r.verdict, 'stop');
});

test('цели: если после резерва на цели не хватает — «осторожно»', () => {
  const goal: Goal = { name: 'Ноутбук', target: 1000, saved: 0, deadline: '2026-12' }; // 1 месяц до срока
  const r = buildBalance(S, shifts, [gym, rent], [], [goal], [check], TODAY);
  assert.equal(r.goalsReserve, 1000 / 1); // monthsLeft = 1
  assert.equal(r.afterGoals, -185.64);
  assert.equal(r.verdict, 'careful');
});

test('потенциальный доход меняет только сценарий «с ожидаемыми»', () => {
  const inc: ManualIncome[] = [{ name: 'Подработка', amount: 300, date: '2026-11-20', status: 'potential' }];
  const r = buildBalance(S, shifts, [gym, rent], inc, [], [check], TODAY);
  const row = r.timeline.find((t) => t.label === 'Подработка')!;
  assert.equal(row.kind, 'potential');
  assert.equal(row.balance, 914.36); // без него
  assert.equal(row.balanceWithPotential, 1214.36);
  assert.equal(r.safeToSpend, 814.36); // в «можно потратить» потенциал не входит
  assert.equal(round2(r.months[0].endBalanceWithPotential - r.months[0].endBalance), 300);
});

test('подтверждённый доход до выплаты увеличивает «можно потратить»; сорвавшийся не учитывается', () => {
  const inc: ManualIncome[] = [
    { name: 'Рефералка', amount: 200, date: '2026-11-25', status: 'confirmed' },
    { name: 'Сорвалось', amount: 999, date: '2026-11-26', status: 'failed' },
  ];
  const r = buildBalance(S, shifts, [gym, rent], inc, [], [check], TODAY);
  assert.equal(r.incomesBeforePayday, 200);
  assert.equal(r.safeToSpend, 1014.36);
  assert.ok(!r.timeline.some((t) => t.label === 'Сорвалось'));
});

test('без ручной проверки: расчёт от нуля и признак hasAnchor=false', () => {
  const r = buildBalance(S, shifts, [gym, rent], [], [], [], TODAY);
  assert.equal(r.hasAnchor, false);
  assert.equal(r.expectedNow, 0);
});

test('новая проверка заменяет точку отсчёта: берётся последняя по дате', () => {
  const r = buildBalance(S, shifts, [gym, rent], [], [], [check, { date: '2026-11-08', amount: 2000 }], TODAY);
  assert.equal(r.expectedNow, 2000); // после 8 ноября событий нет
  assert.equal(r.anchor?.amount, 2000);
});

test('будущие месяцы: баланс на конец месяца и выплата декабря с премией', () => {
  const r = buildBalance(S, shifts, [gym, rent], [], [], [check], TODAY, 3);
  assert.deepEqual(r.months.map((m) => m.month), ['2026-11', '2026-12', '2027-01']);
  // конец ноября: 1414,36 − аренда 500 = 914,36
  assert.equal(r.months[0].endBalance, 914.36);
  // декабрь: − зал 100 − аренда 500 + выплата 77,15 = 391,51
  assert.equal(r.months[1].endBalance, 391.51);
});

// ---------- API ----------
let app: ReturnType<typeof createApp>;
let auth: Record<string, string> = {};
before(async () => {
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  await migrate(pool);
  app = createApp(pool, 'test-secret');
  const r = await request(app).post('/api/auth/register').send({ email: 'bal@test.pl', password: 'secret1' }).expect(201);
  auth = { Authorization: `Bearer ${r.body.token}` };
  await request(app).put('/api/shifts').set(auth).send({ dates: ['2026-10-05', '2026-10-06'], kind: 'day', extra: false }).expect(200);
  await request(app).post('/api/expenses').set(auth).send(gym).expect(201);
  await request(app).post('/api/expenses').set(auth).send(rent).expect(201);
});

test('API: без проверки — hasAnchor=false; после ввода реальной суммы расчёт идёт от неё', async () => {
  const before = await request(app).get('/api/balance?asOf=2026-11-09').set(auth).expect(200);
  assert.equal(before.body.hasAnchor, false);

  await request(app).post('/api/balance/checks').set(auth).send({ date: '2026-11-01', amount: 1000, note: 'старт' }).expect(201);
  const r = await request(app).get('/api/balance?asOf=2026-11-09').set(auth).expect(200);
  assert.equal(r.body.hasAnchor, true);
  assert.equal(r.body.expectedNow, 1414.36);
  assert.equal(r.body.safeToSpend, 814.36);
  assert.equal(r.body.checks.length, 1);
});

test('API: вторая проверка сохраняет, что показывал расчёт, и считает разницу', async () => {
  // расчёт на 9 ноября: 1414,36. Реально на счету 1300 → разница −114,36 (где-то потратил)
  const c = await request(app).post('/api/balance/checks').set(auth).send({ date: '2026-11-09', amount: 1300 }).expect(201);
  assert.equal(c.body.expectedAtEntry, 1414.36);
  const r = await request(app).get('/api/balance?asOf=2026-11-09').set(auth).expect(200);
  assert.equal(r.body.expectedNow, 1300);
  assert.equal(r.body.lastCheck.diff, -114.36);
  assert.equal(r.body.safeToSpend, 700); // 1300 − 600
  assert.equal(r.body.checks.length, 2);
  assert.equal(r.body.checks[0].amount, 1300); // новые сверху
});

test('API: удаление проверки возвращает прежнюю точку отсчёта; чужие проверки недоступны', async () => {
  const list = (await request(app).get('/api/balance?asOf=2026-11-09').set(auth)).body.checks;
  const other = await request(app).post('/api/auth/register').send({ email: 'other@test.pl', password: 'secret1' });
  const otherAuth = { Authorization: `Bearer ${other.body.token}` };
  await request(app).delete(`/api/balance/checks/${list[0].id}`).set(otherAuth).expect(200); // ничего не удалит
  assert.equal((await request(app).get('/api/balance?asOf=2026-11-09').set(auth)).body.checks.length, 2);
  assert.equal((await request(app).get('/api/balance?asOf=2026-11-09').set(otherAuth)).body.hasAnchor, false);

  await request(app).delete(`/api/balance/checks/${list[0].id}`).set(auth).expect(200);
  const r = await request(app).get('/api/balance?asOf=2026-11-09').set(auth).expect(200);
  assert.equal(r.body.expectedNow, 1414.36);
});

test('API: проверки валидируются (будущая дата, мусор)', async () => {
  await request(app).post('/api/balance/checks').set(auth).send({ date: '2099-01-01', amount: 10 }).expect(400);
  await request(app).post('/api/balance/checks').set(auth).send({ date: 'вчера', amount: 10 }).expect(400);
  await request(app).post('/api/balance/checks').set(auth).send({ date: '2026-11-09', amount: 'много' }).expect(400);
});
