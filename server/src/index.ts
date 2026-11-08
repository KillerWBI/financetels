import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createApp } from './app';
import { migrate } from './db';
import { serveClient } from './static';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Задайте DATABASE_URL, например postgres://user:pass@localhost:5432/budget');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('В production нужен JWT_SECRET');
  process.exit(1);
}

// DATABASE_SSL=true — для баз, которым нужен TLS (внутри Railway не требуется)
const pool = new pg.Pool({
  connectionString: url,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});
await migrate(pool);

const app = createApp(pool);
const here = dirname(fileURLToPath(import.meta.url));
const served = serveClient(app, resolve(here, '../../client/dist'));

const port = Number(process.env.PORT ?? 3001);
app.listen(port, '0.0.0.0', () =>
  console.log(`Сервер на порту ${port}${served ? ' (API и интерфейс)' : ' (только API)'}`),
);
