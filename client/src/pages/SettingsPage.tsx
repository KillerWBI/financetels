import { useEffect, useState } from 'react';
import { api, type Settings } from '../api';

type Key = keyof Settings;
interface Field {
  key: Key;
  label: string;
  kind: 'number' | 'time' | 'percent' | 'int';
  hint?: string;
}

const GROUPS: { title: string; fields: Field[] }[] = [
  {
    title: 'Ставки',
    fields: [
      { key: 'dayRate', label: 'Дневная ставка, zł/ч (brutto)', kind: 'number' },
      { key: 'nightRate', label: 'Ночная ставка, zł/ч (brutto)', kind: 'number' },
      { key: 'paidHours', label: 'Оплачиваемых часов за смену', kind: 'number', hint: 'Неоплачиваемые минуты вычитаются из дневной части смены.' },
      { key: 'netCoef', label: 'Коэффициент на руки', kind: 'number', hint: '0,77 = минус 23% налогов.' },
    ],
  },
  {
    title: 'Время смен',
    fields: [
      { key: 'dayShiftStart', label: 'Дневная: начало', kind: 'time' },
      { key: 'dayShiftEnd', label: 'Дневная: конец', kind: 'time' },
      { key: 'nightShiftStart', label: 'Ночная: начало', kind: 'time' },
      { key: 'nightShiftEnd', label: 'Ночная: конец', kind: 'time' },
      { key: 'nightWindowStart', label: 'Ночные часы с', kind: 'time' },
      { key: 'nightWindowEnd', label: 'Ночные часы до', kind: 'time' },
    ],
  },
  {
    title: 'Множители',
    fields: [
      { key: 'weekendMult', label: 'Выходной (суббота и воскресенье)', kind: 'number', hint: 'Считается по дню начала смены.' },
      { key: 'extraMult', label: 'Доп. смена в будни', kind: 'number' },
      { key: 'extraWeekendMult', label: 'Доп. смена в выходной', kind: 'number' },
    ],
  },
  {
    title: 'Премия и выплата',
    fields: [
      { key: 'bonusPct', label: 'Премия, % от brutto за месяц', kind: 'percent', hint: 'Приходит через месяц после зарплаты.' },
      { key: 'payDay', label: 'День выплаты', kind: 'int' },
      { key: 'monthlyLiving', label: 'Повседневные траты в месяц, zł', kind: 'number', hint: 'Вычитается из остатка. 0 — не учитывать.' },
    ],
  },
];

const toNum = (s: string): number => Number(s.replace(',', '.'));

export function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const fill = (s: Settings) => {
    const v: Record<string, string> = {};
    for (const g of GROUPS) for (const f of g.fields) v[f.key] = f.kind === 'percent' ? String(+(Number(s[f.key]) * 100).toFixed(2)) : String(s[f.key]);
    setValues(v);
  };

  useEffect(() => {
    api.settings().then(fill).catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить'));
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    setError('');
    const patch: Record<string, number | string> = {};
    for (const g of GROUPS)
      for (const f of g.fields) {
        const raw = values[f.key];
        patch[f.key] = f.kind === 'time' ? raw : f.kind === 'percent' ? toNum(raw) / 100 : toNum(raw);
      }
    try {
      fill(await api.saveSettings(patch as Partial<Settings>));
      setMsg('Сохранено. Все суммы пересчитаны.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    }
  };

  if (!Object.keys(values).length) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Загрузка…</p>;

  return (
    <form className="settings" onSubmit={save}>
      <h2>Настройки расчёта</h2>
      {GROUPS.map((g) => (
        <fieldset key={g.title} className="panel">
          <legend>{g.title}</legend>
          {g.fields.map((f) => (
            <label key={f.key}>
              {f.label}
              <input
                type={f.kind === 'time' ? 'time' : 'text'}
                inputMode={f.kind === 'time' ? undefined : 'decimal'}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                required
              />
              {f.hint && <span className="hint">{f.hint}</span>}
            </label>
          ))}
        </fieldset>
      ))}
      {error && <p className="error" role="alert">{error}</p>}
      {msg && <p className="pos" role="status">{msg}</p>}
      <button className="primary">Сохранить настройки</button>
    </form>
  );
}
