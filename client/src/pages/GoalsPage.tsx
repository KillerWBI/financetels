import { useCallback, useEffect, useState } from 'react';
import { api, type Summary } from '../api';
import { addMonths, currentMonth, monthTitle, pln } from '../fmt';

const toNum = (s: string): number => Number(s.replace(',', '.'));

interface Form {
  name: string;
  target: string;
  saved: string;
  deadline: string;
}
const empty = (): Form => ({ name: '', target: '', saved: '0', deadline: addMonths(currentMonth(), 6) });

export function GoalsPage() {
  const [data, setData] = useState<Summary | null>(null);
  const [form, setForm] = useState<Form>(empty());
  const [editing, setEditing] = useState<number | null>(null);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api.summary(currentMonth(), 1));
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
      await api.saveGoal(
        { name: form.name.trim(), target: toNum(form.target), saved: toNum(form.saved || '0'), deadline: form.deadline },
        editing ?? undefined,
      );
      setForm(empty());
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    }
  };

  const contribute = async (id: number, sign: 1 | -1) => {
    const v = toNum(amounts[id] ?? '');
    if (!v || v <= 0) return;
    await api.contribute(id, sign * v);
    setAmounts({ ...amounts, [id]: '' });
    await load();
  };

  return (
    <div className="two-col">
      <section>
        <h2>Цели</h2>
        {data && (
          <p className="muted">
            Отложено {pln(data.totals.totalSaved)}. Нужно откладывать {pln(data.totals.plannedToSave)} в месяц, свободно в среднем {pln(data.totals.avgFree)}.
          </p>
        )}
        {data && data.goals.length === 0 && <p className="hint">Целей пока нет. Задайте сумму и срок, и здесь появится, сколько откладывать каждый месяц.</p>}
        <ul className="cards">
          {data?.goals.map(({ goal, plan }) => {
            const pct = Math.min(100, Math.round((goal.saved / goal.target) * 100));
            return (
              <li key={goal.id} className="panel goal">
                <div className="goal-head">
                  <h3>{goal.name}</h3>
                  <span className="muted">до {monthTitle(goal.deadline)}</span>
                </div>
                <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${goal.name}: ${pct}%`}>
                  <span style={{ width: `${pct}%` }} />
                </div>
                <p>
                  <strong>{pln(goal.saved)}</strong> из {pln(goal.target)} · {pct}%
                </p>
                {plan.remaining === 0 ? (
                  <p className="pos strong">Цель достигнута.</p>
                ) : (
                  <>
                    <p>
                      Осталось {pln(plan.remaining)}. За {plan.monthsLeft} мес. откладывать по <strong>{pln(plan.perMonth)}</strong> в месяц.
                    </p>
                    {plan.reachable ? (
                      <p className="pos">Свободного остатка хватает ({pln(plan.avgFree)} в месяц), если на другие цели не уходит.</p>
                    ) : (
                      <p className="neg">
                        Не хватает {pln(plan.gapPerMonth)} в месяц. Это {plan.extraShiftsPerMonth.weekday} доп. смен в будни или{' '}
                        {plan.extraShiftsPerMonth.weekend} в выходные каждый месяц.
                      </p>
                    )}
                  </>
                )}
                <div className="contrib">
                  <input
                    inputMode="decimal"
                    placeholder="Сумма, zł"
                    aria-label={`Сумма для цели ${goal.name}`}
                    value={amounts[goal.id!] ?? ''}
                    onChange={(e) => setAmounts({ ...amounts, [goal.id!]: e.target.value })}
                  />
                  <button onClick={() => contribute(goal.id!, 1)}>Отложить</button>
                  <button onClick={() => contribute(goal.id!, -1)}>Забрать</button>
                  <button className="link" onClick={() => { setEditing(goal.id!); setForm({ name: goal.name, target: String(goal.target), saved: String(goal.saved), deadline: goal.deadline }); }}>Изменить</button>
                  <button className="link danger" onClick={async () => { await api.deleteGoal(goal.id!); await load(); }}>Удалить</button>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="hint">План считается от текущего месяца и среднего свободного остатка за ближайшие 3 выплаты. Если целей несколько, остаток делится между ними, смотрите «После целей остаётся» в обзоре.</p>
      </section>

      <form className="panel form" onSubmit={submit}>
        <h3>{editing ? 'Изменить цель' : 'Новая цель'}</h3>
        <label>
          Название
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </label>
        <label>
          Сколько нужно, zł
          <input inputMode="decimal" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} required />
        </label>
        <label>
          Уже отложено, zł
          <input inputMode="decimal" value={form.saved} onChange={(e) => setForm({ ...form, saved: e.target.value })} />
        </label>
        <label>
          Срок (месяц)
          <input type="month" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} required />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary">{editing ? 'Сохранить' : 'Добавить цель'}</button>
        {editing && (
          <button type="button" className="link" onClick={() => { setEditing(null); setForm(empty()); }}>
            Отменить
          </button>
        )}
      </form>
    </div>
  );
}
