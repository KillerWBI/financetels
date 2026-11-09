// Расчётное ядро: чистые функции без зависимостей от БД и UI.
// Даты — строки 'YYYY-MM-DD', месяцы — 'YYYY-MM'. Деньги — PLN.

export interface Settings {
  dayRate: number; // ставка за час, дневные часы (brutto)
  nightRate: number; // ставка за час, ночные часы (brutto)
  netCoef: number; // коэффициент налога (netto = brutto * netCoef)
  paidHours: number; // оплачиваемых часов за смену
  dayShiftStart: string;
  dayShiftEnd: string;
  nightShiftStart: string;
  nightShiftEnd: string;
  nightWindowStart: string; // начало ночных часов
  nightWindowEnd: string; // конец ночных часов
  weekendMult: number; // обычная смена в выходной
  extraMult: number; // доп. смена в будни
  extraWeekendMult: number; // доп. смена в выходной
  bonusPct: number; // премия от brutto за месяц
  payDay: number; // число месяца выплаты
  monthlyLiving: number; // лимит на повседневные траты в месяц
}

export const DEFAULT_SETTINGS: Settings = {
  dayRate: 33.4,
  nightRate: 38.4,
  netCoef: 0.77,
  paidHours: 10,
  dayShiftStart: '06:00',
  dayShiftEnd: '16:30',
  nightShiftStart: '17:30',
  nightShiftEnd: '04:00',
  nightWindowStart: '21:00',
  nightWindowEnd: '04:00',
  weekendMult: 1.5,
  extraMult: 2,
  extraWeekendMult: 2.5,
  bonusPct: 0.15,
  payDay: 7,
  monthlyLiving: 0,
};

export type ShiftKind = 'day' | 'night';

export interface Shift {
  date: string; // дата начала смены
  kind: ShiftKind;
  extra: boolean; // доп. смена
  // Ручной признак выходного: true — считать выходным (например, праздник),
  // false — считать будним, null/не задан — по календарю (суббота и воскресенье).
  weekend?: boolean | null;
}

export interface ShiftPay {
  gross: number; // в зарплату (без надбавки за выходной у обычной смены)
  weekendBonusGross: number; // надбавка за выходной у обычной смены: уходит в премию
  weekendBonusNet: number;
  net: number;
  mult: number;
  paidHours: number;
  nightHours: number;
  dayHours: number;
  weekend: boolean;
}

export const round2 = (x: number): number => Math.round((x + Number.EPSILON) * 100) / 100;

export function parseTime(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h + (m || 0) / 60;
}

function parseDate(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function isWeekend(date: string): boolean {
  const wd = parseDate(date).getUTCDay();
  return wd === 0 || wd === 6;
}

export const monthOf = (date: string): string => date.slice(0, 7);

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export function monthDiff(from: string, to: string): number {
  const [y1, m1] = from.split('-').map(Number);
  const [y2, m2] = to.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function shiftWindow(s: Settings, kind: ShiftKind): [number, number] {
  const start = parseTime(kind === 'day' ? s.dayShiftStart : s.nightShiftStart);
  let end = parseTime(kind === 'day' ? s.dayShiftEnd : s.nightShiftEnd);
  if (end <= start) end += 24;
  return [start, end];
}

function overlap(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

function nightOverlapHours(start: number, end: number, s: Settings): number {
  const ns = parseTime(s.nightWindowStart);
  let ne = parseTime(s.nightWindowEnd);
  if (ne <= ns) ne += 24;
  let total = 0;
  for (const shift of [-24, 0, 24]) total += overlap(start, end, ns + shift, ne + shift);
  return total;
}

export function effectiveWeekend(date: string, override?: boolean | null): boolean {
  return override ?? isWeekend(date);
}

// Множитель, который идёт в зарплату. У обычной смены в выходной он равен 1:
// надбавка (weekendMult - 1, т.е. +50%) уходит в премию. Доп. смены не затронуты.
export function shiftMultiplier(s: Settings, date: string, extra: boolean, weekendOverride?: boolean | null): number {
  const weekend = effectiveWeekend(date, weekendOverride);
  if (extra && weekend) return s.extraWeekendMult;
  if (extra) return s.extraMult;
  return 1;
}

// Неоплачиваемая часть смены (разница между длительностью и paidHours)
// вычитается из дневной части.
export function shiftPay(s: Settings, shift: Shift): ShiftPay {
  const [start, end] = shiftWindow(s, shift.kind);
  const elapsed = end - start;
  const paid = Math.min(s.paidHours, elapsed);
  const nightHours = Math.min(nightOverlapHours(start, end, s), paid);
  const dayHours = paid - nightHours;
  const mult = shiftMultiplier(s, shift.date, shift.extra, shift.weekend);
  const base = dayHours * s.dayRate + nightHours * s.nightRate;
  const gross = round2(base * mult);
  const weekend = effectiveWeekend(shift.date, shift.weekend);
  const weekendBonusGross = !shift.extra && weekend ? round2(base * (s.weekendMult - 1)) : 0;
  return {
    gross,
    weekendBonusGross,
    weekendBonusNet: round2(weekendBonusGross * s.netCoef),
    net: round2(gross * s.netCoef),
    mult,
    paidHours: paid,
    nightHours,
    dayHours,
    weekend,
  };
}

export interface MonthWork {
  month: string;
  gross: number;
  net: number;
  weekendBonusGross: number; // надбавка за выходные, вошла в премию
  bonusGross: number; // премия за этот месяц: % от (зарплата + надбавка за выходные) + сама надбавка (выплата позже)
  bonusNet: number;
  shifts: number;
  extraShifts: number;
  dayShifts: number;
  nightShifts: number;
  hours: number;
}

export function monthWork(s: Settings, shifts: Shift[], month: string): MonthWork {
  const list = shifts.filter((x) => monthOf(x.date) === month);
  let gross = 0;
  let weekendBonus = 0;
  let hours = 0;
  for (const sh of list) {
    const p = shiftPay(s, sh);
    gross += p.gross;
    weekendBonus += p.weekendBonusGross;
    hours += p.paidHours;
  }
  gross = round2(gross);
  weekendBonus = round2(weekendBonus);
  const bonusGross = round2((gross + weekendBonus) * s.bonusPct + weekendBonus);
  return {
    month,
    gross,
    weekendBonusGross: weekendBonus,
    net: round2(gross * s.netCoef),
    bonusGross,
    bonusNet: round2(bonusGross * s.netCoef),
    shifts: list.length,
    extraShifts: list.filter((x) => x.extra).length,
    dayShifts: list.filter((x) => x.kind === 'day').length,
    nightShifts: list.filter((x) => x.kind === 'night').length,
    hours,
  };
}

export interface Payout {
  payMonth: string; // месяц, в котором приходят деньги
  date: string; // дата выплаты
  salaryMonth: string; // за какой месяц зарплата
  bonusMonth: string; // за какой месяц премия
  salaryNet: number;
  bonusNet: number;
  totalNet: number;
}

// В payMonth на payDay приходит: зарплата за предыдущий месяц и премия за позапрошлый.
export function payoutForMonth(s: Settings, shifts: Shift[], payMonth: string): Payout {
  const salaryMonth = addMonths(payMonth, -1);
  const bonusMonth = addMonths(payMonth, -2);
  const salary = monthWork(s, shifts, salaryMonth);
  const bonus = monthWork(s, shifts, bonusMonth);
  const day = Math.min(s.payDay, daysInMonth(payMonth));
  return {
    payMonth,
    date: `${payMonth}-${String(day).padStart(2, '0')}`,
    salaryMonth,
    bonusMonth,
    salaryNet: salary.net,
    bonusNet: bonus.bonusNet,
    totalNet: round2(salary.net + bonus.bonusNet),
  };
}

export interface Expense {
  id?: number;
  name: string;
  amount: number;
  dayOfMonth: number;
  startMonth: string; // 'YYYY-MM'
  endMonth: string | null; // включительно, null — бессрочно
}

export function expenseActive(e: Expense, month: string): boolean {
  if (month < e.startMonth) return false;
  if (e.endMonth && month > e.endMonth) return false;
  return true;
}

export function expensesForMonth(list: Expense[], month: string): number {
  return round2(list.filter((e) => expenseActive(e, month)).reduce((a, e) => a + e.amount, 0));
}

export interface ManualIncome {
  id?: number;
  name: string;
  amount: number; // без налога
  date: string;
  status: 'potential' | 'confirmed' | 'failed';
}

export interface MonthCash {
  month: string;
  payout: Payout;
  manualIncome: number; // подтверждённые, без налога
  potentialIncome: number; // ещё не подтверждённые
  obligations: number;
  living: number;
  free: number; // что можно отложить без потенциальных доходов
  freeWithPotential: number;
}

export function monthCash(
  s: Settings,
  shifts: Shift[],
  expenses: Expense[],
  incomes: ManualIncome[],
  month: string,
): MonthCash {
  const payout = payoutForMonth(s, shifts, month);
  const inMonth = incomes.filter((i) => monthOf(i.date) === month);
  const manualIncome = round2(inMonth.filter((i) => i.status === 'confirmed').reduce((a, i) => a + i.amount, 0));
  const potentialIncome = round2(inMonth.filter((i) => i.status === 'potential').reduce((a, i) => a + i.amount, 0));
  const obligations = expensesForMonth(expenses, month);
  const living = s.monthlyLiving;
  const free = round2(payout.totalNet + manualIncome - obligations - living);
  return {
    month,
    payout,
    manualIncome,
    potentialIncome,
    obligations,
    living,
    free,
    freeWithPotential: round2(free + potentialIncome),
  };
}

export interface Goal {
  id?: number;
  name: string;
  target: number;
  saved: number;
  deadline: string; // 'YYYY-MM'
}

export interface GoalPlan {
  remaining: number;
  monthsLeft: number;
  perMonth: number; // сколько откладывать в месяц
  avgFree: number; // средний свободный остаток в месяц (по ближайшим выплатам)
  gapPerMonth: number; // чего не хватает в месяц (0 если хватает)
  extraShiftsPerMonth: { weekday: number; weekend: number }; // доп. дневных смен в месяц, чтобы закрыть разницу
  reachable: boolean;
}

export function extraShiftNet(s: Settings, weekend: boolean): number {
  // эталон: доп. дневная смена в будни (2024-01-03, среда) или выходной (2024-01-06, суббота)
  const date = weekend ? '2024-01-06' : '2024-01-03';
  return shiftPay(s, { date, kind: 'day', extra: true }).net;
}

export function goalPlan(s: Settings, goal: Goal, fromMonth: string, avgFree: number): GoalPlan {
  const remaining = round2(Math.max(0, goal.target - goal.saved));
  const monthsLeft = Math.max(1, monthDiff(fromMonth, goal.deadline));
  const perMonth = round2(remaining / monthsLeft);
  const gapPerMonth = round2(Math.max(0, perMonth - avgFree));
  const wd = extraShiftNet(s, false);
  const we = extraShiftNet(s, true);
  return {
    remaining,
    monthsLeft,
    perMonth,
    avgFree: round2(avgFree),
    gapPerMonth,
    extraShiftsPerMonth: {
      weekday: gapPerMonth > 0 ? Math.ceil(gapPerMonth / wd) : 0,
      weekend: gapPerMonth > 0 ? Math.ceil(gapPerMonth / we) : 0,
    },
    reachable: gapPerMonth === 0,
  };
}

// ---------------------------------------------------------------------------
// Баланс: сколько денег сейчас, сколько будет и можно ли тратить.
// Точка отсчёта — последняя ручная проверка («реально на счету X на дату D»).
// От неё считаются события: выплаты (7-го), платежи, подтверждённые доходы.
// Потенциальные доходы идут отдельным сценарием. Повседневные траты
// (monthlyLiving) вычитаются равномерно по дням.
// ---------------------------------------------------------------------------

export interface BalanceCheck {
  id?: number;
  date: string; // дата, на которую пользователь назвал реальную сумму
  amount: number;
  note?: string;
  expectedAtEntry?: number | null; // что показывал расчёт в момент ввода
}

export type CashEventKind = 'payout' | 'expense' | 'income' | 'potential' | 'marker';

export interface CashEvent {
  date: string;
  kind: CashEventKind;
  label: string;
  amount: number; // со знаком: доход +, платёж −
  payout?: { salaryMonth: string; bonusMonth: string; salaryNet: number; bonusNet: number };
}

export function addDays(date: string, n: number): string {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayDiff(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86400000);
}

const lastDayOf = (m: string): string => `${m}-${String(daysInMonth(m)).padStart(2, '0')}`;
const clampDay = (m: string, day: number): string => `${m}-${String(Math.min(Math.max(day, 1), daysInMonth(m))).padStart(2, '0')}`;

// Среднее число дней в месяце для дневного расхода
export const livingPerDay = (s: Settings): number => (s.monthlyLiving * 12) / 365;

// События в интервале (from, to]: from не включается, to включается.
export function cashEvents(
  s: Settings,
  shifts: Shift[],
  expenses: Expense[],
  incomes: ManualIncome[],
  from: string,
  to: string,
): CashEvent[] {
  const out: CashEvent[] = [];
  const inRange = (d: string): boolean => d > from && d <= to;

  for (let m = monthOf(from); m <= monthOf(to); m = addMonths(m, 1)) {
    const p = payoutForMonth(s, shifts, m);
    if (p.totalNet !== 0 && inRange(p.date)) {
      out.push({
        date: p.date,
        kind: 'payout',
        label: 'Выплата',
        amount: p.totalNet,
        payout: { salaryMonth: p.salaryMonth, bonusMonth: p.bonusMonth, salaryNet: p.salaryNet, bonusNet: p.bonusNet },
      });
    }
    for (const e of expenses) {
      if (!expenseActive(e, m)) continue;
      const d = clampDay(m, e.dayOfMonth);
      if (inRange(d)) out.push({ date: d, kind: 'expense', label: e.name, amount: -e.amount });
    }
  }

  for (const i of incomes) {
    if (i.status === 'failed') continue;
    if (i.status === 'confirmed') {
      if (inRange(i.date)) out.push({ date: i.date, kind: 'income', label: i.name, amount: i.amount });
    } else {
      // ожидаемый: если дата уже прошла, а он не подтверждён — считаем, что придёт «завтра»
      const d = i.date > from ? i.date : addDays(from, 1);
      if (inRange(d)) out.push({ date: d, kind: 'potential', label: i.name, amount: i.amount });
    }
  }

  const order: Record<CashEventKind, number> = { expense: 0, payout: 1, income: 1, potential: 2, marker: 3 };
  return out.sort((a, b) => (a.date === b.date ? order[a.kind] - order[b.kind] : a.date < b.date ? -1 : 1));
}

function walk(
  start: number,
  startDate: string,
  events: CashEvent[],
  perDay: number,
  withPotential: boolean,
): number[] {
  let bal = start;
  let prev = startDate;
  return events.map((e) => {
    bal -= perDay * dayDiff(prev, e.date);
    prev = e.date;
    if (e.kind !== 'potential' || withPotential) bal += e.amount;
    return bal;
  });
}

export interface TimelineRow extends CashEvent {
  balance: number; // без потенциальных
  balanceWithPotential: number;
}

export interface BalanceReport {
  today: string;
  hasAnchor: boolean;
  anchor: { date: string; amount: number } | null;
  expectedNow: number; // сколько должно быть на счету сейчас по расчёту
  lastCheck: { date: string; amount: number; expectedAtEntry: number | null; diff: number | null } | null;
  nextPayday: { date: string; daysLeft: number; amount: number };
  dueBeforePayday: { total: number; items: CashEvent[] };
  incomesBeforePayday: number;
  livingReserve: number;
  safeToSpend: number; // сейчас, до следующей выплаты, без потенциальных доходов
  goalsReserve: number; // сколько нужно отложить на цели в этом месяце
  afterGoals: number;
  verdict: 'ok' | 'careful' | 'stop';
  lowest: { date: string; amount: number }; // самая низкая точка до выплаты
  timeline: TimelineRow[];
  months: { month: string; endBalance: number; endBalanceWithPotential: number; income: number; spent: number }[];
}

export function buildBalance(
  s: Settings,
  shifts: Shift[],
  expenses: Expense[],
  incomes: ManualIncome[],
  goals: Goal[],
  checks: BalanceCheck[],
  today: string,
  horizonMonths = 6,
): BalanceReport {
  const perDay = livingPerDay(s);
  // последняя проверка: самая поздняя дата, при равенстве — последняя добавленная
  const sorted = checks
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.date === b.c.date ? a.i - b.i : a.c.date < b.c.date ? -1 : 1))
    .map((x) => x.c);
  const last = sorted[sorted.length - 1];
  const startDate = last ? last.date : today;
  const startAmount = last ? last.amount : 0;

  // 1. Сколько должно быть сейчас
  const upToToday = cashEvents(s, shifts, expenses, incomes, startDate, today).filter((e) => e.kind !== 'potential');
  const nowEvents = walk(startAmount, startDate, upToToday, perDay, false);
  const lastBal = nowEvents.length ? nowEvents[nowEvents.length - 1] : startAmount;
  const lastEventDate = upToToday.length ? upToToday[upToToday.length - 1].date : startDate;
  const expectedNow = round2(lastBal - perDay * Math.max(0, dayDiff(lastEventDate, today)));

  // 2. Ближайшая выплата по графику
  let payMonth = monthOf(today);
  let payDate = clampDay(payMonth, s.payDay);
  if (payDate <= today) {
    payMonth = addMonths(payMonth, 1);
    payDate = clampDay(payMonth, s.payDay);
  }
  const nextPay = payoutForMonth(s, shifts, payMonth);

  // 3. Будущие события и два сценария
  const horizonEnd = lastDayOf(addMonths(monthOf(today), horizonMonths - 1));
  const future = cashEvents(s, shifts, expenses, incomes, today, horizonEnd);
  const markers: CashEvent[] = [];
  for (let m = monthOf(today); m <= monthOf(horizonEnd); m = addMonths(m, 1)) {
    markers.push({ date: lastDayOf(m), kind: 'marker', label: m, amount: 0 });
  }
  const all = [...future, ...markers].sort((a, b) =>
    a.date === b.date ? (a.kind === 'marker' ? 1 : 0) - (b.kind === 'marker' ? 1 : 0) : a.date < b.date ? -1 : 1,
  );
  const certain = walk(expectedNow, today, all, perDay, false);
  const withPot = walk(expectedNow, today, all, perDay, true);
  const rows = all.map((e, i) => ({ ...e, balance: round2(certain[i]), balanceWithPotential: round2(withPot[i]) }));

  const timeline = rows.filter((r) => r.kind !== 'marker');
  const months = rows
    .filter((r) => r.kind === 'marker')
    .map((r) => {
      const inMonth = future.filter((e) => monthOf(e.date) === r.label);
      return {
        month: r.label,
        endBalance: r.balance,
        endBalanceWithPotential: r.balanceWithPotential,
        income: round2(inMonth.filter((e) => e.kind !== 'potential' && e.amount > 0).reduce((a, e) => a + e.amount, 0)),
        spent: round2(-inMonth.filter((e) => e.amount < 0).reduce((a, e) => a + e.amount, 0)),
      };
    });

  // 4. Можно ли тратить: до следующей выплаты
  const dueItems = future.filter((e) => e.kind === 'expense' && e.date <= payDate);
  const due = round2(-dueItems.reduce((a, e) => a + e.amount, 0));
  const incomesBefore = round2(
    future.filter((e) => e.kind === 'income' && e.date < payDate).reduce((a, e) => a + e.amount, 0),
  );
  const daysLeft = dayDiff(today, payDate);
  const livingReserve = round2(perDay * daysLeft);
  const safeToSpend = round2(expectedNow - due + incomesBefore - livingReserve);

  const fromMonth = monthOf(today);
  const goalsReserve = round2(goals.reduce((a, g) => a + goalPlan(s, g, fromMonth, 0).perMonth, 0));
  const afterGoals = round2(safeToSpend - goalsReserve);

  let lowest = { date: today, amount: expectedNow };
  all.forEach((e, i) => {
    if (e.kind !== 'marker' && e.date <= payDate && certain[i] < lowest.amount) lowest = { date: e.date, amount: round2(certain[i]) };
  });

  const lastCheck = last
    ? {
        date: last.date,
        amount: last.amount,
        expectedAtEntry: last.expectedAtEntry ?? null,
        diff: last.expectedAtEntry == null ? null : round2(last.amount - last.expectedAtEntry),
      }
    : null;

  return {
    today,
    hasAnchor: Boolean(last),
    anchor: last ? { date: last.date, amount: last.amount } : null,
    expectedNow,
    lastCheck,
    nextPayday: { date: payDate, daysLeft, amount: nextPay.totalNet },
    dueBeforePayday: { total: due, items: dueItems },
    incomesBeforePayday: incomesBefore,
    livingReserve,
    safeToSpend,
    goalsReserve,
    afterGoals,
    verdict: safeToSpend < 0 ? 'stop' : afterGoals < 0 ? 'careful' : 'ok',
    lowest,
    timeline,
    months,
  };
}
