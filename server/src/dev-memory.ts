// Запуск API на встроенной БД в памяти — без установки PostgreSQL.
// Данные пропадают при остановке. Только для знакомства с приложением.
import { newDb } from 'pg-mem';
import { createApp } from './app';
import { migrate } from './db';

const { Pool } = newDb().adapters.createPg();
const pool = new Pool();
await migrate(pool);

const port = Number(process.env.PORT ?? 3001);
createApp(pool).listen(port, () => console.log(`API (БД в памяти) на http://localhost:${port}`));
