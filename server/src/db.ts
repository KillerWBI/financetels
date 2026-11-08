import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Минимальный интерфейс пула: подходит и для pg.Pool, и для адаптера pg-mem в тестах.
export interface Db {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

const here = dirname(fileURLToPath(import.meta.url));

export async function migrate(db: Db): Promise<void> {
  const sql = readFileSync(join(here, 'schema.sql'), 'utf8');
  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await db.query(stmt);
  }
}
