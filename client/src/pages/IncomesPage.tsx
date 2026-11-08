import { useCallback, useEffect, useState } from 'react';
import { api, type ManualIncome } from '../api';
import { dayMonth, pln, today } from '../fmt';

const toNum = (s: string): number => Number(s.replace(',', '.'));

type Status = ManualIncome['status'];
const STATUS_LABEL: Record<Status, string> = { potential: 'Ожидается', confirmed: 'Получено', failed: 'Сорвалось' };

interface Form {
  name: string;
  amount: string;
  date: string;
  status: Status;
}
const empty = (): Form => ({ name: '', amount: '', date: today(), status: 'potential' });

export function IncomesPage() {
  const [list, setList] = useState<ManualIncome[]>([]);
  const [form, setForm] = useState<Form>(empty());
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setList(await api.incomes());
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
      await api.saveIncome({ name: form.name.trim(), amount: toNum(form.amount), date: form.date, status: form.status }, editing ?? undefined);
      setForm(empty());
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    }
  };

  const setStatus = async (x: ManualIncome, status: Status) => {
    await api.saveIncome({ name: x.name, amount: x.amount, date: x.date, status }, x.id);
    await load();
  };

  const potential = list.filter((x) => x.status === 'potential').reduce((a, x) => a + x.amount, 0);

  return (
    <div className="two-col">
      <section>
        <h2>Другие доходы</h2>
        <p className="muted">
          Подработка, рефералки и всё, что не приходит с зарплатой. Ожидаемые учитываются отдельно и не входят в остаток, пока вы не отметите «Получено». Налог не удерживается.
        </p>
        <p className="muted">Ожидается всего: <strong>{pln(potential)}</strong></p>
        {list.length === 0 && <p className="hint">Пока пусто. Добавьте ожидаемую подработку или реферальную выплату.</p>}
        <ul className="rows">
          {list.map((x) => (
            <li key={x.id} className={'row ' + (x.status === 'failed' ? 'dim' : '')}>
              <div>
                <strong>{x.name}</strong>
                <span className="sub">{dayMonth(x.date)} · <span className={'badge ' + x.status}>{STATUS_LABEL[x.status]}</span></span>
              </div>
              <div className="row-end">
                <span className="amount">{pln(x.amount)}</span>
                {x.status !== 'confirmed' && <button className="link" onClick={() => setStatus(x, 'confirmed')}>Получено</button>}
                {x.status === 'potential' && <button className="link" onClick={() => setStatus(x, 'failed')}>Сорвалось</button>}
                {x.status !== 'potential' && <button className="link" onClick={() => setStatus(x, 'potential')}>Снова ожидается</button>}
                <button className="link" onClick={() => { setEditing(x.id!); setForm({ name: x.name, amount: String(x.amount), date: x.date, status: x.status }); }}>Изменить</button>
                <button className="link danger" onClick={async () => { await api.deleteIncome(x.id!); await load(); }}>Удалить</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <form className="panel form" onSubmit={submit}>
        <h3>{editing ? 'Изменить доход' : 'Новый доход'}</h3>
        <label>
          Название
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </label>
        <label>
          Сумма, zł
          <input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
        </label>
        <label>
          Когда ожидается
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
        </label>
        <label>
          Статус
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Status })}>
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary">{editing ? 'Сохранить' : 'Добавить доход'}</button>
        {editing && (
          <button type="button" className="link" onClick={() => { setEditing(null); setForm(empty()); }}>
            Отменить
          </button>
        )}
      </form>
    </div>
  );
}
