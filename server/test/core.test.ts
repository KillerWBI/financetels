import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS as S,
  shiftPay,
  monthWork,
  payoutForMonth,
  expensesForMonth,
  monthCash,
  goalPlan,
  addMonths,
  extraShiftNet,
  type Shift,
  type Expense,
} from '../../shared/core';

// 2026-11-09 — понедельник, 2026-11-07 — суббота, 2026-11-08 — воскресенье
test('дневная смена в будни: 10 ч × 33.40', () => {
  const p = shiftPay(S, { date: '2026-11-09', kind: 'day', extra: false });
  assert.equal(p.gross, 334);
  assert.equal(p.net, 257.18);
  assert.equal(p.nightHours, 0);
});

test('ночная смена: 3 ч × 33.40 + 7 ч × 38.40 = 369', () => {
  const p = shiftPay(S, { date: '2026-11-09', kind: 'night', extra: false });
  assert.equal(p.nightHours, 7);
  assert.equal(p.dayHours, 3);
  assert.equal(p.gross, 369);
  assert.equal(p.net, 284.13);
});

test('выходной: ×1.5 по дню начала смены (суббота и воскресенье)', () => {
  assert.equal(shiftPay(S, { date: '2026-11-07', kind: 'day', extra: false }).gross, 501);
  assert.equal(shiftPay(S, { date: '2026-11-08', kind: 'day', extra: false }).gross, 501);
  // ночная смена, начатая в пятницу, — будний множитель
  assert.equal(shiftPay(S, { date: '2026-11-06', kind: 'night', extra: false }).mult, 1);
  // ночная смена, начатая в воскресенье, — выходной
  assert.equal(shiftPay(S, { date: '2026-11-08', kind: 'night', extra: false }).mult, 1.5);
});

test('доп. смена: ×2 в будни, ×2.5 в выходной', () => {
  assert.equal(shiftPay(S, { date: '2026-11-09', kind: 'day', extra: true }).gross, 668);
  assert.equal(shiftPay(S, { date: '2026-11-09', kind: 'day', extra: true }).net, 514.36);
  assert.equal(shiftPay(S, { date: '2026-11-07', kind: 'day', extra: true }).gross, 835);
  assert.equal(shiftPay(S, { date: '2026-11-07', kind: 'day', extra: true }).net, 642.95);
  assert.equal(shiftPay(S, { date: '2026-11-09', kind: 'night', extra: true }).gross, 738);
});

const shifts: Shift[] = [
  { date: '2026-09-01', kind: 'day', extra: false }, // вт
  { date: '2026-10-05', kind: 'day', extra: false }, // пн
  { date: '2026-10-06', kind: 'night', extra: false }, // вт
];

test('месяц: brutto, netto, премия', () => {
  const m = monthWork(S, shifts, '2026-10');
  assert.equal(m.gross, 703);
  assert.equal(m.net, 541.31);
  assert.equal(m.bonusGross, 105.45);
  assert.equal(m.shifts, 2);
  assert.equal(m.hours, 20);
});

test('выплата в ноябре: зарплата за октябрь + премия за сентябрь', () => {
  const p = payoutForMonth(S, shifts, '2026-11');
  assert.equal(p.date, '2026-11-07');
  assert.equal(p.salaryMonth, '2026-10');
  assert.equal(p.bonusMonth, '2026-09');
  assert.equal(p.salaryNet, 541.31);
  assert.equal(p.bonusNet, 38.58); // 334 × 0.15 = 50.10 → ×0.77
  assert.equal(p.totalNet, 579.89);
});

test('регулярные платежи «от и до»', () => {
  const list: Expense[] = [
    { name: 'Зал', amount: 150, dayOfMonth: 10, startMonth: '2026-01', endMonth: null },
    { name: 'Рассрочка', amount: 300, dayOfMonth: 15, startMonth: '2026-10', endMonth: '2026-12' },
  ];
  assert.equal(expensesForMonth(list, '2026-09'), 150);
  assert.equal(expensesForMonth(list, '2026-10'), 450);
  assert.equal(expensesForMonth(list, '2026-12'), 450);
  assert.equal(expensesForMonth(list, '2027-01'), 150);
});

test('остаток месяца: потенциальные доходы отдельно от подтверждённых', () => {
  const expenses: Expense[] = [{ name: 'Зал', amount: 150, dayOfMonth: 10, startMonth: '2026-01', endMonth: null }];
  const c = monthCash(S, shifts, expenses, [
    { name: 'Подработка', amount: 200, date: '2026-11-12', status: 'confirmed' },
    { name: 'Рефералка', amount: 500, date: '2026-11-20', status: 'potential' },
    { name: 'Сорвалось', amount: 999, date: '2026-11-21', status: 'failed' },
  ], '2026-11');
  assert.equal(c.manualIncome, 200);
  assert.equal(c.potentialIncome, 500);
  assert.equal(c.free, 629.89); // 579.89 + 200 − 150
  assert.equal(c.freeWithPotential, 1129.89);
});

test('addMonths через границу года', () => {
  assert.equal(addMonths('2026-11', 2), '2027-01');
  assert.equal(addMonths('2026-01', -2), '2025-11');
});

test('цель: сколько откладывать и сколько доп. смен не хватает', () => {
  const plan = goalPlan(S, { name: 'Ноутбук', target: 6000, saved: 1200, deadline: '2027-05' }, '2026-11', 500);
  assert.equal(plan.remaining, 4800);
  assert.equal(plan.monthsLeft, 6);
  assert.equal(plan.perMonth, 800);
  assert.equal(plan.gapPerMonth, 300);
  assert.equal(plan.extraShiftsPerMonth.weekday, 1); // 300 / 514.36
  assert.equal(plan.extraShiftsPerMonth.weekend, 1);
  assert.equal(plan.reachable, false);
  assert.equal(extraShiftNet(S, false), 514.36);
});

test('цель достижима без доп. смен', () => {
  const plan = goalPlan(S, { name: 'X', target: 1000, saved: 0, deadline: '2027-01' }, '2026-11', 800);
  assert.equal(plan.perMonth, 500);
  assert.equal(plan.reachable, true);
  assert.equal(plan.extraShiftsPerMonth.weekday, 0);
});

test('ручной признак выходного: ночная смена в будний день как выходной', () => {
  // 2026-11-11 — среда
  const cal = shiftPay(S, { date: '2026-11-11', kind: 'night', extra: false });
  assert.equal(cal.mult, 1);
  assert.equal(cal.weekend, false);
  const manual = shiftPay(S, { date: '2026-11-11', kind: 'night', extra: false, weekend: true });
  assert.equal(manual.mult, 1.5);
  assert.equal(manual.weekend, true);
  assert.equal(manual.gross, 553.5); // 369 × 1.5
});

test('комбинации: ночная + доп + выходной = ×2.5', () => {
  const p = shiftPay(S, { date: '2026-11-11', kind: 'night', extra: true, weekend: true });
  assert.equal(p.mult, 2.5);
  assert.equal(p.gross, 922.5); // 369 × 2.5
});

test('суббота, отмеченная как будний день, считается без надбавки; null — по календарю', () => {
  // 2026-11-07 — суббота
  assert.equal(shiftPay(S, { date: '2026-11-07', kind: 'day', extra: false, weekend: false }).gross, 334);
  assert.equal(shiftPay(S, { date: '2026-11-07', kind: 'day', extra: false, weekend: null }).gross, 501);
  assert.equal(shiftPay(S, { date: '2026-11-07', kind: 'day', extra: true, weekend: false }).gross, 668);
});

test('ручной выходной попадает в сумму месяца', () => {
  const m = monthWork(S, [
    { date: '2026-11-11', kind: 'day', extra: false, weekend: true },
    { date: '2026-11-12', kind: 'day', extra: false },
  ], '2026-11');
  assert.equal(m.gross, 835); // 501 + 334
});
