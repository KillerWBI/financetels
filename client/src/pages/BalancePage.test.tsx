import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newDb } from 'pg-mem';
import { createApp } from '../../../server/src/app';
import { migrate } from '../../../server/src/db';
import { BalancePage } from './BalancePage';

// Сегодня 2026-11-09. Октябрь: 2 дневные смены, выплата 7 ноября 514,36.
const realFetch = globalThis.fetch;
let server: Server;
let base = '';
let token = '';
const h = () => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const post = (path: string, method: string, body: unknown) => realFetch(base + path, { method, headers: h(), body: JSON.stringify(body) });

beforeAll(async () => {
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  await migrate(pool);
  server = createApp(pool, 'ui-balance').listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    realFetch(typeof input === 'string' && input.startsWith('/') ? base + input : input, init)) as typeof fetch;
  const r = await post('/api/auth/register', 'POST', { email: 'b@test.pl', password: 'secret1' });
  token = (await r.json()).token;
  localStorage.setItem('budget-token', token);
  await post('/api/shifts', 'PUT', { dates: ['2026-10-05', '2026-10-06'], kind: 'day', extra: false });
  await post('/api/expenses', 'POST', { name: 'Зал', amount: 100, dayOfMonth: 5, startMonth: '2026-01', endMonth: null });
  await post('/api/expenses', 'POST', { name: 'Аренда', amount: 500, dayOfMonth: 15, startMonth: '2026-01', endMonth: null });
  await post('/api/incomes', 'POST', { name: 'Подработка', amount: 300, date: '2026-11-20', status: 'potential' });
  // цель «Машина» с накопленными 5000 должна сама попасть в «Отложено»
  await post('/api/goals', 'POST', { name: 'Машина', target: 5000, saved: 5000, deadline: '2027-11' });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-09T10:00:00Z'));
});
afterAll(() => {
  server.close();
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});
afterEach(cleanup);

describe('экран «Баланс»', () => {
  it('ввод реальной суммы → расчёт, «можно потратить», прогноз с потенциальным доходом, сверка и удаление', async () => {
    const user = userEvent.setup();
    render(<BalancePage />);
    expect(await screen.findByText(/Сначала введите, сколько денег у вас реально/)).toBeTruthy();

    await user.type(screen.getByLabelText(/На руках сейчас/), '1000');
    expect(screen.getByLabelText(/Отложено вне целей/)).toBeTruthy();
    const date = screen.getByLabelText('На дату') as HTMLInputElement;
    await user.clear(date);
    await user.type(date, '2026-11-01');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    // 1000 − зал 100 + выплата 514,36 = 1414,36; до выплаты 7 декабря платежи 600 → можно 814,36
    await waitFor(() => expect(screen.queryByText(/Сначала введите/)).toBeNull());
    const card = screen.getByText('Можно тратить').closest('.panel') as HTMLElement;
    expect(within(card).getAllByText(/814,36/).length).toBeGreaterThan(0);
    expect(within(card).getByText(/1\s?414,36/)).toBeTruthy();

    const saved = screen.getByText('Отложено').closest('.panel') as HTMLElement;
    expect(within(saved).getByText(/5\s?000,00/)).toBeTruthy();
    expect(within(saved).getByText(/в целях/)).toBeTruthy();
    // сальдо: на руках + отложено = 6 414,36; потенциально +300 → 6 714,36
    const saldo = screen.getByText('Сальдо сейчас').closest('.panel') as HTMLElement;
    expect(within(saldo).getByText(/6\s?414,36/)).toBeTruthy();
    const pot = screen.getByText('Потенциально').closest('.panel') as HTMLElement;
    expect(within(pot).getByText(/6\s?714,36/)).toBeTruthy();
    expect(within(pot).getByText(/Подработка/)).toBeTruthy();

    // потенциальный доход виден в прогнозе, но не в «можно потратить»
    const rowPot = screen.getByText('Подработка').closest('tr') as HTMLElement;
    expect(within(rowPot).getByText(/ожидается/)).toBeTruthy();
    expect(within(rowPot).getByText(/1\s?214,36/)).toBeTruthy();

    // реальная сумма отличается от расчёта: потратил больше, чем учтено
    await user.type(screen.getByLabelText(/На руках сейчас/), '1300');
    const d2 = screen.getByLabelText('На дату') as HTMLInputElement;
    await user.clear(d2);
    await user.type(d2, '2026-11-09');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.getByText(/расчёт показывал/)).toBeTruthy());
    expect(screen.getAllByText(/114,36/).length).toBeGreaterThan(0);
    const card2 = screen.getByText('Можно тратить').closest('.panel') as HTMLElement;
    expect(within(card2).getAllByText(/700,00/).length).toBeGreaterThan(0);

    // удаление последней проверки возвращает расчёт от первой
    await user.click(screen.getAllByRole('button', { name: /Удалить проверку/ })[0]);
    await waitFor(() => expect(within(screen.getByText('Можно тратить').closest('.panel') as HTMLElement).getAllByText(/814,36/).length).toBeGreaterThan(0));
  });
});
