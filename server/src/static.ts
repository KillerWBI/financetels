import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Express } from 'express';

// Отдаёт собранный клиент (client/dist) и возвращает index.html для всех не-API путей.
// Возвращает false, если сборки нет (например, при разработке через Vite).
export function serveClient(app: Express, dir: string): boolean {
  const index = join(dir, 'index.html');
  if (!existsSync(index)) return false;
  app.use(express.static(dir, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(index));
  return true;
}
