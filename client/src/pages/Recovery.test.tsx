import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newDb } from 'pg-mem';
import { createApp } from '../../../server/src/app';
import { migrate } from '../../../server/src/db';
import { Recovery } from './Recovery';

const KEY = 'ui-recovery-key-123456';
const realFetch = globalThis.fetch;
let server: Server;
let base = '';

beforeAll(async () => {
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  await migrate(pool);
  server = createApp(pool, 'ui-secret', KEY).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    realFetch(typeof input === 'string' && input.startsWith('/') ? base + input : input, init)) as typeof fetch;
  await realFetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'lost@test.pl', password: 'forgotten1' }),
  });
});
afterAll(() => {
  server.close();
  globalThis.fetch = realFetch;
});
afterEach(cleanup);

describe('восстановление доступа', () => {
  it('неверный ключ → ошибка; верный → аккаунт → новый пароль → вход', async () => {
    const user = userEvent.setup();
    const done = vi.fn();
    render(<Recovery onBack={() => {}} onDone={done} />);

    await user.type(screen.getByLabelText('Ключ восстановления'), 'wrong-key');
    await user.click(screen.getByRole('button', { name: 'Показать аккаунты' }));
    expect(await screen.findByText(/Неверный ключ/)).toBeTruthy();

    await user.clear(screen.getByLabelText('Ключ восстановления'));
    await user.type(screen.getByLabelText('Ключ восстановления'), KEY);
    await user.click(screen.getByRole('button', { name: 'Показать аккаунты' }));
    await user.click(await screen.findByRole('button', { name: /lost@test\.pl/ }));

    await user.type(await screen.findByLabelText('Новый пароль'), 'brandnew1');
    await user.click(screen.getByRole('button', { name: 'Сохранить и войти' }));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));

    const login = await realFetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'lost@test.pl', password: 'brandnew1' }),
    });
    expect(login.status).toBe(200);
  });
});
