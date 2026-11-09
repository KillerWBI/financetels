import type { Expense, Goal, GoalPlan, ManualIncome, MonthCash, MonthWork, Settings, Shift, ShiftPay } from '../../shared/core';

export type { Expense, Goal, GoalPlan, ManualIncome, MonthCash, MonthWork, Settings, Shift, ShiftPay };

export interface ShiftRow extends Shift {
  pay: ShiftPay;
}
export interface SummaryMonth {
  month: string;
  work: MonthWork;
  cash: MonthCash;
}
export interface Summary {
  settings: Settings;
  months: SummaryMonth[];
  goals: { goal: Goal; plan: GoalPlan }[];
  totals: { totalSaved: number; plannedToSave: number; avgFree: number; leftover: number };
}

const TOKEN_KEY = 'budget-token';
export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null): void => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) {
      setToken(null);
      window.dispatchEvent(new Event('budget-logout'));
    }
    throw new ApiError(data.error ?? 'Ошибка запроса', res.status);
  }
  return data as T;
}

export const api = {
  login: (email: string, password: string) => req<{ token: string }>('POST', '/auth/login', { email, password }),
  register: (email: string, password: string) => req<{ token: string }>('POST', '/auth/register', { email, password }),

  recoveryAccounts: (key: string) =>
    req<{ id: number; email: string; createdAt: string; shifts: number; expenses: number; incomes: number; goals: number }[]>(
      'POST',
      '/auth/recovery/accounts',
      { key },
    ),
  recoveryLink: (key: string, userId: number) => req<{ token: string; path: string }>('POST', '/auth/recovery/link', { key, userId }),
  resetPassword: (token: string, password: string) => req<{ token: string }>('POST', '/auth/reset', { token, password }),

  settings: () => req<Settings>('GET', '/settings'),
  saveSettings: (s: Partial<Settings>) => req<Settings>('PUT', '/settings', s),

  shifts: (from: string, to: string) => req<ShiftRow[]>('GET', `/shifts?from=${from}&to=${to}`),
  putShifts: (dates: string[], kind: 'day' | 'night', extra: boolean, weekend: boolean | null = null) =>
    req('PUT', '/shifts', { dates, kind, extra, weekend }),
  clearShifts: (dates: string[]) => req('POST', '/shifts/clear', { dates }),

  summary: (from: string, months: number) => req<Summary>('GET', `/summary?from=${from}&months=${months}`),

  expenses: () => req<Expense[]>('GET', '/expenses'),
  saveExpense: (e: Omit<Expense, 'id'>, id?: number) =>
    id ? req<Expense>('PUT', `/expenses/${id}`, e) : req<Expense>('POST', '/expenses', e),
  deleteExpense: (id: number) => req('DELETE', `/expenses/${id}`),

  incomes: () => req<ManualIncome[]>('GET', '/incomes'),
  saveIncome: (i: Omit<ManualIncome, 'id'>, id?: number) =>
    id ? req<ManualIncome>('PUT', `/incomes/${id}`, i) : req<ManualIncome>('POST', '/incomes', i),
  deleteIncome: (id: number) => req('DELETE', `/incomes/${id}`),

  goals: () => req<Goal[]>('GET', '/goals'),
  saveGoal: (g: Omit<Goal, 'id'>, id?: number) => (id ? req<Goal>('PUT', `/goals/${id}`, g) : req<Goal>('POST', '/goals', g)),
  contribute: (id: number, amount: number) => req<Goal>('POST', `/goals/${id}/contribute`, { amount }),
  deleteGoal: (id: number) => req('DELETE', `/goals/${id}`),
};
