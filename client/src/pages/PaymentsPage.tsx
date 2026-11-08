import { useCallback, useEffect, useState } from 'react';
import { api, type Expense } from '../api';
import { currentMonth, monthShort, pln } from '../fmt';
import { expenseActive } from '../../../shared/core';

const toNum = (s: string): number => Number(s.replace(',', '.'));

interface Form {
  name: string;
  amount: string;
  dayOfMonth: string;
  startMonth: string;
  endMonth: string;
}
const empty = (): Form => ({ name: '', amount: '', dayOfMonth: '1', startMonth: currentMonth(), endMonth: '' });

export function PaymentsPage() {
  const [list, setList] = useState<Expense[]>([]);
  const [form, setForm] = useState<Form>(empty());
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setList(await api.expenses());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.saveExpense(
        {
          name: form.name.trim(),
          amount: toNum(form.amount),
          dayOfMonth: Number(form.dayOfMonth),
          startMonth: form.startMonth,
          endMonth: form.endMonth || null,
        },
        editing ?? undefined,
      );
      setForm(empty());
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    }
  };

  const edit = (x: Expense) => {
    setEditing(x.id ?? null);
    setForm({ name: x.name, amount: String(x.amount), dayOfMonth: String(x.dayOfMonth), startMonth: x.startMonth, endMonth: x.endMonth ?? '' });
  };

  const now = currentMonth();
  const activeTotal = list.filter((x) => expenseActive(x, now)).reduce((a, x) => a + x.amount, 0);

  return (
    <div className="two-col">
      <section>
        <h2>Обязательные платежи</h2>
        <p className="muted">Сейчас действуют на {pln(activeTotal)} в месяц.</p>
        {list.length === 0 && <p className="hint">Платежей пока нет. Добавьте подписки, кредит, зал: каждый месяц они вычтутся из выплаты сами.</p>}
        <ul className="rows">
          {list.map((x) => {
            const state = expenseActive(x, now) ? '' : x.startMonth > now ? 'ещё не начался' : 'закончился';
            return (
              <li key={x.id} className={state ? 'row dim' : 'row'}>
                <div>
                  <strong>{x.name}</strong>
                  <span className="sub">
                    {x.dayOfMonth}-го числа · с {monthShort(x.startMonth)} {x.endMonth ? `до ${monthShort(x.endMonth)}` : 'без срока'}
                    {state && ` · ${state}`}
                  </span>
                </div>
                <div className="row-end">
                  <span className="amount">{pln(x.amount)}</span>
                  <button className="link" onClick={() => edit(x)}>Изменить</button>
                  <button
                    className="link danger"
                    onClick={async () => {
                      await api.deleteExpense(x.id!);
                      await load();
                    }}
                  >
                    Удалить
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <form className="panel form" onSubmit={submit}>
        <h3>{editing ? 'Изменить платёж' : 'Новый платёж'}</h3>
        <label>
          Название
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </label>
        <label>
          Сумма в месяц, zł
          <input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
        </label>
        <label>
          День списания
          <input type="number" min={1} max={31} value={form.dayOfMonth} onChange={(e) => setForm({ ...form, dayOfMonth: e.target.value })} required />
        </label>
        <label>
          Начало
          <input type="month" value={form.startMonth} onChange={(e) => setForm({ ...form, startMonth: e.target.value })} required />
        </label>
        <label>
          Конец (включительно)
          <input type="month" value={form.endMonth} onChange={(e) => setForm({ ...form, endMonth: e.target.value })} />
        </label>
        <p className="hint">Оставьте конец пустым, если платёж без срока.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary">{editing ? 'Сохранить' : 'Добавить платёж'}</button>
        {editing && (
          <button type="button" className="link" onClick={() => { setEditing(null); setForm(empty()); }}>
            Отменить
          </button>
        )}
      </form>
    </div>
  );
}
