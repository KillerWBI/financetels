import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { Db } from './db';
import {
  DEFAULT_SETTINGS,
  addMonths,
  goalPlan,
  monthCash,
  monthWork,
  round2,
  shiftPay,
  type Expense,
  type Goal,
  type ManualIncome,
  type Settings,
  type Shift,
} from '../../shared/core';

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const monthRe = /^\d{4}-\d{2}$/;
const date = z.string().regex(dateRe);
const month = z.string().regex(monthRe);

const settingsSchema = z
  .object({
    dayRate: z.number().positive(),
    nightRate: z.number().positive(),
    netCoef: z.number().min(0.01).max(1),
    paidHours: z.number().positive().max(24),
    dayShiftStart: z.string().regex(/^\d{2}:\d{2}$/),
    dayShiftEnd: z.string().regex(/^\d{2}:\d{2}$/),
    nightShiftStart: z.string().regex(/^\d{2}:\d{2}$/),
    nightShiftEnd: z.string().regex(/^\d{2}:\d{2}$/),
    nightWindowStart: z.string().regex(/^\d{2}:\d{2}$/),
    nightWindowEnd: z.string().regex(/^\d{2}:\d{2}$/),
    weekendMult: z.number().positive(),
    extraMult: z.number().positive(),
    extraWeekendMult: z.number().positive(),
    bonusPct: z.number().min(0).max(1),
    payDay: z.number().int().min(1).max(31),
    monthlyLiving: z.number().min(0),
  })
  .partial();

const credsSchema = z.object({ email: z.string().email(), password: z.string().min(6) });
const shiftsPutSchema = z.object({
  dates: z.array(date).min(1).max(366),
  kind: z.enum(['day', 'night']),
  extra: z.boolean().default(false),
});
const shiftsClearSchema = z.object({ dates: z.array(date).min(1).max(366) });
const expenseSchema = z.object({
  name: z.string().min(1),
  amount: z.number().nonnegative(),
  dayOfMonth: z.number().int().min(1).max(31),
  startMonth: month,
  endMonth: month.nullable().default(null),
});
const incomeSchema = z.object({
  name: z.string().min(1),
  amount: z.number().nonnegative(),
  date,
  status: z.enum(['potential', 'confirmed', 'failed']).default('potential'),
});
const goalSchema = z.object({
  name: z.string().min(1),
  target: z.number().positive(),
  saved: z.number().nonnegative().default(0),
  deadline: month,
});

type Handler = (req: Request & { userId: number }, res: Response) => Promise<unknown>;
const wrap =
  (fn: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req as Request & { userId: number }, res).catch(next);
  };

export function createApp(db: Db, jwtSecret = process.env.JWT_SECRET ?? 'dev-secret-change-me'): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const sign = (id: number): string => jwt.sign({ sub: id }, jwtSecret, { expiresIn: '30d' });

  // ---------- auth ----------
  app.post(
    '/api/auth/register',
    wrap(async (req, res) => {
      const body = credsSchema.parse(req.body);
      const email = body.email.toLowerCase();
      const exists = await db.query('SELECT id FROM users WHERE email = $1', [email]);
      if (exists.rows.length) return res.status(409).json({ error: 'Email уже зарегистрирован' });
      const hash = await bcrypt.hash(body.password, 10);
      const r = await db.query(
        'INSERT INTO users (email, password_hash, created_at) VALUES ($1, $2, $3) RETURNING id',
        [email, hash, new Date().toISOString()],
      );
      const id = Number(r.rows[0].id);
      await db.query('INSERT INTO settings (user_id, data) VALUES ($1, $2)', [id, JSON.stringify({})]);
      res.status(201).json({ token: sign(id) });
    }),
  );

  app.post(
    '/api/auth/login',
    wrap(async (req, res) => {
      const body = credsSchema.parse(req.body);
      const r = await db.query('SELECT id, password_hash FROM users WHERE email = $1', [body.email.toLowerCase()]);
      const row = r.rows[0];
      if (!row || !(await bcrypt.compare(body.password, row.password_hash))) {
        return res.status(401).json({ error: 'Неверный email или пароль' });
      }
      res.json({ token: sign(Number(row.id)) });
    }),
  );

  // Проверка здоровья для хостинга (без входа)
  app.get(
    '/api/health',
    wrap(async (_req, res) => {
      await db.query('SELECT 1');
      res.json({ ok: true });
    }),
  );

  // ---------- auth middleware ----------
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return void res.status(401).json({ error: 'Нужен вход' });
    try {
      const payload = jwt.verify(h.slice(7), jwtSecret) as unknown as { sub: number };
      (req as Request & { userId: number }).userId = Number(payload.sub);
      next();
    } catch {
      res.status(401).json({ error: 'Сессия истекла' });
    }
  });

  // ---------- загрузка данных ----------
  const loadSettings = async (userId: number): Promise<Settings> => {
    const r = await db.query('SELECT data FROM settings WHERE user_id = $1', [userId]);
    const stored = r.rows[0] ? JSON.parse(r.rows[0].data) : {};
    return { ...DEFAULT_SETTINGS, ...stored };
  };

  const mapShift = (r: any): Shift => ({ date: r.date, kind: r.kind, extra: Boolean(r.extra) });
  const mapExpense = (r: any) => ({
    id: Number(r.id),
    name: r.name,
    amount: Number(r.amount),
    dayOfMonth: Number(r.day_of_month),
    startMonth: r.start_month,
    endMonth: r.end_month ?? null,
  });
  const mapIncome = (r: any) => ({
    id: Number(r.id),
    name: r.name,
    amount: Number(r.amount),
    date: r.date,
    status: r.status,
  });
  const mapGoal = (r: any): Goal => ({
    id: Number(r.id),
    name: r.name,
    target: Number(r.target),
    saved: Number(r.saved),
    deadline: r.deadline,
  });

  const loadShifts = async (userId: number): Promise<Shift[]> =>
    (await db.query('SELECT date, kind, extra FROM shifts WHERE user_id = $1 ORDER BY date', [userId])).rows.map(mapShift);
  const loadExpenses = async (userId: number): Promise<Expense[]> =>
    (await db.query('SELECT * FROM expenses WHERE user_id = $1 ORDER BY id', [userId])).rows.map(mapExpense);
  const loadIncomes = async (userId: number): Promise<ManualIncome[]> =>
    (await db.query('SELECT * FROM incomes WHERE user_id = $1 ORDER BY date', [userId])).rows.map(mapIncome);
  const loadGoals = async (userId: number): Promise<Goal[]> =>
    (await db.query('SELECT * FROM goals WHERE user_id = $1 ORDER BY deadline', [userId])).rows.map(mapGoal);

  // ---------- settings ----------
  app.get('/api/settings', wrap(async (req, res) => res.json(await loadSettings(req.userId))));

  app.put(
    '/api/settings',
    wrap(async (req, res) => {
      const patch = settingsSchema.parse(req.body);
      const merged = { ...(await loadSettings(req.userId)), ...patch };
      await db.query(
        'INSERT INTO settings (user_id, data) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data = $2',
        [req.userId, JSON.stringify(merged)],
      );
      res.json(merged);
    }),
  );

  // ---------- shifts ----------
  app.get(
    '/api/shifts',
    wrap(async (req, res) => {
      const from = date.parse(req.query.from);
      const to = date.parse(req.query.to);
      const [settings, rows] = await Promise.all([
        loadSettings(req.userId),
        db.query('SELECT date, kind, extra FROM shifts WHERE user_id = $1 AND date >= $2 AND date <= $3 ORDER BY date', [
          req.userId,
          from,
          to,
        ]),
      ]);
      res.json(rows.rows.map(mapShift).map((s) => ({ ...s, pay: shiftPay(settings, s) })));
    }),
  );

  app.put(
    '/api/shifts',
    wrap(async (req, res) => {
      const b = shiftsPutSchema.parse(req.body);
      for (const d of new Set(b.dates)) {
        await db.query(
          `INSERT INTO shifts (user_id, date, kind, extra) VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, date) DO UPDATE SET kind = $3, extra = $4`,
          [req.userId, d, b.kind, b.extra],
        );
      }
      res.json({ ok: true, count: new Set(b.dates).size });
    }),
  );

  app.post(
    '/api/shifts/clear',
    wrap(async (req, res) => {
      const b = shiftsClearSchema.parse(req.body);
      for (const d of new Set(b.dates)) {
        await db.query('DELETE FROM shifts WHERE user_id = $1 AND date = $2', [req.userId, d]);
      }
      res.json({ ok: true });
    }),
  );

  // ---------- expenses ----------
  app.get('/api/expenses', wrap(async (req, res) => res.json(await loadExpenses(req.userId))));

  app.post(
    '/api/expenses',
    wrap(async (req, res) => {
      const b = expenseSchema.parse(req.body);
      const r = await db.query(
        `INSERT INTO expenses (user_id, name, amount, day_of_month, start_month, end_month)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [req.userId, b.name, b.amount, b.dayOfMonth, b.startMonth, b.endMonth],
      );
      res.status(201).json(mapExpense(r.rows[0]));
    }),
  );

  app.put(
    '/api/expenses/:id',
    wrap(async (req, res) => {
      const b = expenseSchema.parse(req.body);
      const r = await db.query(
        `UPDATE expenses SET name = $3, amount = $4, day_of_month = $5, start_month = $6, end_month = $7
         WHERE id = $1 AND user_id = $2 RETURNING *`,
        [Number(req.params.id), req.userId, b.name, b.amount, b.dayOfMonth, b.startMonth, b.endMonth],
      );
      if (!r.rows[0]) return res.status(404).json({ error: 'Не найдено' });
      res.json(mapExpense(r.rows[0]));
    }),
  );

  app.delete(
    '/api/expenses/:id',
    wrap(async (req, res) => {
      await db.query('DELETE FROM expenses WHERE id = $1 AND user_id = $2', [Number(req.params.id), req.userId]);
      res.json({ ok: true });
    }),
  );

  // ---------- incomes (потенциальные и разовые, без налога) ----------
  app.get('/api/incomes', wrap(async (req, res) => res.json(await loadIncomes(req.userId))));

  app.post(
    '/api/incomes',
    wrap(async (req, res) => {
      const b = incomeSchema.parse(req.body);
      const r = await db.query(
        'INSERT INTO incomes (user_id, name, amount, date, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [req.userId, b.name, b.amount, b.date, b.status],
      );
      res.status(201).json(mapIncome(r.rows[0]));
    }),
  );

  app.put(
    '/api/incomes/:id',
    wrap(async (req, res) => {
      const b = incomeSchema.parse(req.body);
      const r = await db.query(
        'UPDATE incomes SET name = $3, amount = $4, date = $5, status = $6 WHERE id = $1 AND user_id = $2 RETURNING *',
        [Number(req.params.id), req.userId, b.name, b.amount, b.date, b.status],
      );
      if (!r.rows[0]) return res.status(404).json({ error: 'Не найдено' });
      res.json(mapIncome(r.rows[0]));
    }),
  );

  app.delete(
    '/api/incomes/:id',
    wrap(async (req, res) => {
      await db.query('DELETE FROM incomes WHERE id = $1 AND user_id = $2', [Number(req.params.id), req.userId]);
      res.json({ ok: true });
    }),
  );

  // ---------- goals ----------
  app.get('/api/goals', wrap(async (req, res) => res.json(await loadGoals(req.userId))));

  app.post(
    '/api/goals',
    wrap(async (req, res) => {
      const b = goalSchema.parse(req.body);
      const r = await db.query(
        'INSERT INTO goals (user_id, name, target, saved, deadline) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [req.userId, b.name, b.target, b.saved, b.deadline],
      );
      res.status(201).json(mapGoal(r.rows[0]));
    }),
  );

  app.put(
    '/api/goals/:id',
    wrap(async (req, res) => {
      const b = goalSchema.parse(req.body);
      const r = await db.query(
        'UPDATE goals SET name = $3, target = $4, saved = $5, deadline = $6 WHERE id = $1 AND user_id = $2 RETURNING *',
        [Number(req.params.id), req.userId, b.name, b.target, b.saved, b.deadline],
      );
      if (!r.rows[0]) return res.status(404).json({ error: 'Не найдено' });
      res.json(mapGoal(r.rows[0]));
    }),
  );

  // Положить в цель (amount > 0) или забрать (amount < 0)
  app.post(
    '/api/goals/:id/contribute',
    wrap(async (req, res) => {
      const { amount } = z.object({ amount: z.number() }).parse(req.body);
      const cur = await db.query('SELECT * FROM goals WHERE id = $1 AND user_id = $2', [Number(req.params.id), req.userId]);
      if (!cur.rows[0]) return res.status(404).json({ error: 'Не найдено' });
      const saved = Math.max(0, round2(Number(cur.rows[0].saved) + amount));
      const r = await db.query('UPDATE goals SET saved = $3 WHERE id = $1 AND user_id = $2 RETURNING *', [
        Number(req.params.id),
        req.userId,
        saved,
      ]);
      res.json(mapGoal(r.rows[0]));
    }),
  );

  app.delete(
    '/api/goals/:id',
    wrap(async (req, res) => {
      await db.query('DELETE FROM goals WHERE id = $1 AND user_id = $2', [Number(req.params.id), req.userId]);
      res.json({ ok: true });
    }),
  );

  // ---------- summary ----------
  // GET /api/summary?from=YYYY-MM&months=6
  // Для каждого месяца: work — заработано за месяц (смены), cash — что приходит в этом месяце (7-го)
  // и остаток после обязательных платежей. Цели считаются от месяца from.
  app.get(
    '/api/summary',
    wrap(async (req, res) => {
      const from = month.parse(req.query.from);
      const n = z.coerce.number().int().min(1).max(36).default(6).parse(req.query.months);
      const [settings, shifts, expenses, incomes, goals] = await Promise.all([
        loadSettings(req.userId),
        loadShifts(req.userId),
        loadExpenses(req.userId),
        loadIncomes(req.userId),
        loadGoals(req.userId),
      ]);

      const months = Array.from({ length: n }, (_, i) => {
        const m = addMonths(from, i);
        return { month: m, work: monthWork(settings, shifts, m), cash: monthCash(settings, shifts, expenses, incomes, m) };
      });

      // Средний свободный остаток по ближайшим трём выплатам (без потенциальных доходов)
      const lookahead = Array.from({ length: 3 }, (_, i) => monthCash(settings, shifts, expenses, incomes, addMonths(from, i)));
      const avgFree = lookahead.reduce((a, c) => a + c.free, 0) / lookahead.length;

      const plans = goals.map((g) => ({ goal: g, plan: goalPlan(settings, g, from, avgFree) }));
      const totalSaved = round2(goals.reduce((a, g) => a + g.saved, 0));
      const plannedToSave = round2(plans.reduce((a, p) => a + p.plan.perMonth, 0));

      res.json({
        settings,
        months,
        goals: plans,
        totals: {
          totalSaved,
          plannedToSave,
          avgFree: round2(avgFree),
          leftover: round2(avgFree - plannedToSave),
        },
      });
    }),
  );

  // ---------- ошибки ----------
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) {
      return void res.status(400).json({ error: 'Неверные данные', details: err.issues });
    }
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  });

  return app;
}
