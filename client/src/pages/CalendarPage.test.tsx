import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newDb } from 'pg-mem';
import { createApp } from '../../../server/src/app';
import { migrate } from '../../../server/src/db';
import { CalendarPage } from './CalendarPage';

// Сквозной тест: настоящий интерфейс + настоящий API на БД в памяти.
// Дата зафиксирована: ноябрь 2026 (11-е — среда, 7-е — суббота).

const realFetch = globalThis.fetch;
let server: Server;
let base = '';
let token = '';

const headers = () => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const serverShifts = async (): Promise<any[]> =>
  (await realFetch(`${base}/api/shifts?from=2026-11-01&to=2026-11-30`, { headers: headers() })).json();
const reset = async () => {
  const dates = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
  await realFetch(`${base}/api/shifts/clear`, { method: 'POST', headers: headers(), body: JSON.stringify({ dates }) });
};

beforeAll(async () => {
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  await migrate(pool);
  server = createApp(pool, 'ui-test-secret').listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // клиент ходит на относительные /api/... — направляем на тестовый сервер
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    realFetch(typeof input === 'string' && input.startsWith('/') ? base + input : input, init)) as typeof fetch;

  const r = await realFetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'ui@test.pl', password: 'secret1' }),
  });
  token = (await r.json()).token;
  localStorage.setItem('budget-token', token);

  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
});

afterAll(() => {
  server.close();
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

beforeEach(reset);
afterEach(cleanup);

const cell = (day: number) => screen.getByRole('button', { name: new RegExp(`^${day} ноября`) });
const seg = (name: string) => screen.getByRole('button', { name });
const extraBox = () => screen.getByRole('checkbox', { name: /^Доп\. смена/ });

async function open() {
  const user = userEvent.setup();
  render(<CalendarPage />);
  await screen.findByRole('grid');
  return user;
}

describe('календарь: настройка дня', () => {
  it('неделя начинается с воскресенья', async () => {
    await open();
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toEqual(['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']);
    // 1 ноября 2026 — воскресенье, значит пустых клеток перед ним нет
    const cells = Array.from(document.querySelectorAll('.grid > .cell'));
    expect(cells[0].getAttribute('aria-label')).toMatch(/^1 ноября/);
  });

  it('обычная смена в выходной: в зарплату обычная сумма, надбавка в премию', async () => {
    const user = await open();
    await user.click(cell(7)); // суббота
    await user.click(seg('Дневная'));
    await waitFor(() => expect(cell(7).getAttribute('aria-label')).toMatch(/дневная/));
    expect(cell(7).getAttribute('aria-label')).toMatch(/257,18/);
    const [s] = await serverShifts();
    expect(s.pay.gross).toBe(334);
    expect(s.pay.weekendBonusGross).toBe(167);
  });

  it('добавить смену, поменять тип, доп. и выходной в любой комбинации, потом убрать', async () => {
    const user = await open();
    expect(screen.getByText(/Выберите день в календаре/)).toBeTruthy();

    await user.click(cell(11)); // среда
    expect(await screen.findByRole('heading', { name: /11 ноября, среда/ })).toBeTruthy();
    expect(seg('Нет').getAttribute('aria-pressed')).toBe('true');

    // дневная
    await user.click(seg('Дневная'));
    await waitFor(() => expect(cell(11).getAttribute('aria-label')).toMatch(/дневная/));
    expect(cell(11).getAttribute('aria-label')).toMatch(/257,18/);

    // + доп. смена
    await user.click(extraBox());
    await waitFor(() => expect(cell(11).getAttribute('aria-label')).toMatch(/доп\. смена/));
    expect(cell(11).getAttribute('aria-label')).toMatch(/514,36/);

    // + выходной (вручную, среда)
    await user.click(seg('Выходной'));
    await waitFor(() => expect(cell(11).getAttribute('aria-label')).toMatch(/выходной/));
    expect(cell(11).getAttribute('aria-label')).toMatch(/642,95/);

    // меняем тип на ночную: доп. и выходной сохраняются
    await user.click(seg('Ночная'));
    await waitFor(() => expect(cell(11).getAttribute('aria-label')).toMatch(/ночная/));
    let [s] = await serverShifts();
    expect(s).toMatchObject({ date: '2026-11-11', kind: 'night', extra: true, weekend: true });
    expect(s.pay.mult).toBe(2.5);
    expect(s.pay.gross).toBe(922.5);

    // выходной обратно «по календарю»: остаётся ночная + доп., ×2
    await user.click(seg('По календарю'));
    await waitFor(async () => expect((await serverShifts())[0].weekend).toBeNull());
    [s] = await serverShifts();
    expect(s.pay.mult).toBe(2);
    expect(s.pay.gross).toBe(738);
    expect(cell(11).getAttribute('aria-label')).not.toMatch(/выходной/);

    // снять доп. смену
    await user.click(extraBox());
    await waitFor(async () => expect((await serverShifts())[0].extra).toBe(false));
    expect((await serverShifts())[0].pay.gross).toBe(369);

    // убрать смену совсем
    await user.click(screen.getByRole('button', { name: 'Убрать смену' }));
    await waitFor(() => expect(cell(11).getAttribute('aria-label')).toMatch(/смены нет/));
    expect(await serverShifts()).toHaveLength(0);
    expect(seg('Нет').getAttribute('aria-pressed')).toBe('true');
  });

  it('«Нет» тоже убирает смену', async () => {
    const user = await open();
    await user.click(cell(12));
    await user.click(seg('Ночная'));
    await waitFor(() => expect(cell(12).getAttribute('aria-label')).toMatch(/ночная/));
    await user.click(seg('Нет'));
    await waitFor(() => expect(cell(12).getAttribute('aria-label')).toMatch(/смены нет/));
    expect(await serverShifts()).toHaveLength(0);
  });

  it('несколько дней: поставить, изменить часть, убрать часть', async () => {
    const user = await open();
    await user.click(screen.getByRole('checkbox', { name: /Выбирать несколько дней/ }));
    await user.click(cell(12));
    await user.click(cell(13));
    await user.click(cell(14));
    expect(await screen.findByRole('heading', { name: /Выбрано дней: 3/ })).toBeTruthy();

    await user.click(seg('Ночная'));
    await waitFor(async () => expect(await serverShifts()).toHaveLength(3));
    expect((await serverShifts()).every((s) => s.kind === 'night')).toBe(true);

    // снять выбор с 14-го и отметить «доп.» только у 12-го и 13-го
    await user.click(cell(14));
    expect(await screen.findByRole('heading', { name: /Выбрано дней: 2/ })).toBeTruthy();
    await user.click(extraBox());
    await waitFor(async () => expect((await serverShifts()).filter((s) => s.extra)).toHaveLength(2));
    const byDate = Object.fromEntries((await serverShifts()).map((s) => [s.date, s]));
    expect(byDate['2026-11-12'].extra).toBe(true);
    expect(byDate['2026-11-13'].extra).toBe(true);
    expect(byDate['2026-11-14'].extra).toBe(false);

    // убрать смены у выбранных двух
    await user.click(screen.getByRole('button', { name: /Убрать смены \(2\)/ }));
    await waitFor(async () => expect(await serverShifts()).toHaveLength(1));
    expect((await serverShifts())[0].date).toBe('2026-11-14');
  });

  it('Shift + клик выбирает диапазон, Esc снимает выбор', async () => {
    const user = await open();
    await user.click(cell(20));
    await user.keyboard('{Shift>}');
    await user.click(cell(22));
    await user.keyboard('{/Shift}');
    expect(await screen.findByRole('heading', { name: /Выбрано дней: 3/ })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(await screen.findByText(/Выберите день в календаре/)).toBeTruthy();
  });

  it('повторяющийся график заполняет месяц и убирает смены на «В»', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Заполнить' }));
    // Д Д Н Н В В В В с 1-го по 30-е: 3 полных цикла + Д Д Н Н = 16 смен
    await waitFor(async () => expect(await serverShifts()).toHaveLength(16));
    const byDate = Object.fromEntries((await serverShifts()).map((s) => [s.date, s]));
    expect(byDate['2026-11-01'].kind).toBe('day');
    expect(byDate['2026-11-03'].kind).toBe('night');
    expect(byDate['2026-11-05']).toBeUndefined();
  });
});
