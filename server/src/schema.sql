CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Настройки хранятся как JSON-текст (ставки, множители, время смен и т.д.)
CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL
);

-- Одна запись на день: дата начала смены, тип (day/night), доп. смена или нет
CREATE TABLE IF NOT EXISTS shifts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  extra BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (user_id, date)
);

-- weekend: NULL — по календарю, TRUE — считать выходным, FALSE — считать будним.
-- ADD COLUMN IF NOT EXISTS — миграция для баз, созданных до появления поля.
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS weekend BOOLEAN;

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  day_of_month INTEGER NOT NULL,
  start_month TEXT NOT NULL,
  end_month TEXT
);

-- Доходы, которые пользователь вписывает сам (без налога).
-- status: potential (ожидается), confirmed (получен), failed (сорвался)
CREATE TABLE IF NOT EXISTS incomes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'potential'
);

CREATE TABLE IF NOT EXISTS goals (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target NUMERIC(12,2) NOT NULL,
  saved NUMERIC(12,2) NOT NULL DEFAULT 0,
  deadline TEXT NOT NULL
);
