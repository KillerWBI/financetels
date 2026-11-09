import { useCallback, useEffect, useState } from 'react';
import { api, type BalanceData } from '../api';
import { dayMonth, monthName, monthTitle, pln, today, tone } from '../fmt';

const VERDICT = {
  ok: { cls: 'pos', title: 'Можно тратить', text: 'Платежи до выплаты и резерв на цели покрыты.' },
  careful: { cls: 'warn', title: 'Осторожно', text: 'Деньги на платежи есть, но на цели в этом месяце не хватит.' },
  stop: { cls: 'neg', title: 'Лучше не тратить', text: 'До выплаты не хватает денег на платежи и повседневные траты.' },
} as const;

export function BalancePage() {
  const [data, setData] = useState<BalanceData | null>(null);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('');
  const [saved, setSaved] = useState<string | null>(null); // null — поле не трогали, подставляем текущее
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    api
      .balance(6)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить'));
  }, []);
  useEffect(load, [load]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return <p className="muted">Загрузка…</p>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parse = (x: string): number => Number(x.replace(/\s/g, '').replace(',', '.'));
    const n = parse(amount);
    if (!Number.isFinite(n)) return setError('Введите сумму цифрами');
    const sv = saved === null || saved.trim() === '' ? null : parse(saved);
    if (sv !== null && (!Number.isFinite(sv) || sv < 0)) return setError('Отложено: введите сумму цифрами, не меньше нуля');
    setBusy(true);
    setError('');
    try {
      await api.addCheck(date, n, sv, note.trim());
      setAmount('');
      setSaved(null);
      setNote('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    await api.deleteCheck(id);
    load();
  };

  const v = VERDICT[data.verdict];
  const rows = showAll ? data.timeline : data.timeline.slice(0, 12);
  const lc = data.lastCheck;

  return (
    <div className="stack">
      {!data.hasAnchor && (
        <p className="hint" role="status">
          Сначала введите, сколько денег у вас реально сейчас (ниже). От этой суммы считаются все расчёты. Пока её нет, расчёт идёт от нуля.
        </p>
      )}

      <div className="stats">
        <div className="panel">
          <h3>На руках</h3>
          <p className="big-num">{pln(data.expectedNow)}</p>
          <p className="muted">можно тратить (счёт и наличные, по расчёту)</p>
        </div>
        <div className="panel">
          <h3>Отложено</h3>
          <p className="big-num">{pln(data.saved)}</p>
          <p className="muted">не тратится</p>
        </div>
        <div className="panel">
          <h3>Сальдо сейчас</h3>
          <p className={'big-num ' + tone(data.total)}>{pln(data.total)}</p>
          <p className="muted">на руках + отложено</p>
        </div>
        <div className="panel">
          <h3>Потенциально</h3>
          <p className={'big-num ' + tone(data.potential.totalWithPotential)}>{pln(data.potential.totalWithPotential)}</p>
          <p className="muted">
            {data.potential.items.length
              ? `с ожидаемыми ${data.potential.items.map((i) => `${i.label} ${i.amount > 0 ? '+' : ''}${pln(i.amount)} (${dayMonth(i.date)})`).join(', ')}`
              : 'ожидаемых доходов пока нет, добавьте их во вкладке «Доходы»'}
          </p>
        </div>
      </div>

      <div className={'panel verdict ' + v.cls}>
        <h3>{v.title}</h3>
        <p className={'big-num ' + (data.safeToSpend < 0 ? 'neg' : 'pos')}>{pln(data.safeToSpend)}</p>
        <p className="muted">
          можно потратить сейчас, чтобы дожить до выплаты {dayMonth(data.nextPayday.date)} (через {data.nextPayday.daysLeft} дн.). {v.text}
        </p>
        <dl className="calc">
          <dt>На счету сейчас (расчёт)</dt><dd>{pln(data.expectedNow)}</dd>
          <dt>Платежи до выплаты</dt><dd>−{pln(data.dueBeforePayday.total)}</dd>
          {data.livingReserve > 0 && (<><dt>Повседневные траты до выплаты</dt><dd>−{pln(data.livingReserve)}</dd></>)}
          {data.incomesBeforePayday > 0 && (<><dt>Подтверждённые доходы до выплаты</dt><dd>+{pln(data.incomesBeforePayday)}</dd></>)}
          <dt><strong>Можно потратить</strong></dt><dd><strong>{pln(data.safeToSpend)}</strong></dd>
          {data.goalsReserve > 0 && (
            <>
              <dt>Нужно отложить на цели (в месяц)</dt><dd>−{pln(data.goalsReserve)}</dd>
              <dt><strong>Свободно после целей</strong></dt>
              <dd className={tone(data.afterGoals)}><strong>{pln(data.afterGoals)}</strong></dd>
            </>
          )}
        </dl>
        {data.dueBeforePayday.items.length > 0 && (
          <p className="hint">
            Впереди: {data.dueBeforePayday.items.map((i) => `${i.label} ${pln(-i.amount)} (${dayMonth(i.date)})`).join(', ')}.
          </p>
        )}
        <p className="hint">
          Самая низкая точка до выплаты: {pln(data.lowest.amount)} ({dayMonth(data.lowest.date)}). Потенциальные доходы сюда не входят.
        </p>
      </div>

      <form className="panel" onSubmit={submit}>
        <h3>Сколько реально сейчас (сверка раз в месяц и после больших трат)</h3>
        <p className="muted">
          Впишите, сколько реально на руках и сколько всего отложено. Расчёт сверится с реальностью и дальше пойдёт от этих сумм. Раз в месяц достаточно обновлять обе суммы: траты и откладывание подтянутся сами.
        </p>
        {lc && (
          <p className="hint">
            Последняя проверка {dayMonth(lc.date)}: на руках {pln(lc.amount)}
            {lc.diff !== null && (
              <>
                {' '}(расчёт показывал {pln(lc.expectedAtEntry ?? 0)}, разница{' '}
                <span className={tone(lc.diff)}>{lc.diff > 0 ? '+' : ''}{pln(lc.diff)}</span>
                {lc.diff < 0 ? ': вы потратили больше, чем учтено' : lc.diff > 0 ? ': денег больше, чем по расчёту' : ''})
              </>
            )}
          </p>
        )}
        <div className="check-fields">
          <label>
            На руках сейчас, zł
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required placeholder="счёт + наличные, например 3800" />
          </label>
          <label>
            Отложено всего, zł
            <input
              inputMode="decimal"
              value={saved ?? String(data.saved || '')}
              onChange={(e) => setSaved(e.target.value)}
              placeholder="например 5000"
            />
          </label>
          <label>
            На дату
            <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label>
            Заметка
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="необязательно" />
          </label>
        </div>
        <button className="primary" disabled={busy}>Сохранить</button>
      </form>

      <div className="panel">
        <h3>Сколько будет</h3>
        <p className="muted">
          Зарплата минус обязательные платежи по графику и подтверждённые доходы. «Всего» включает отложенное. Колонка «с ожидаемыми» добавляет потенциальные доходы, когда они должны прийти.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Конец месяца</th>
                <th className="r">Придёт</th>
                <th className="r">Уйдёт</th>
                <th className="r">На руках</th>
                <th className="r">Всего (с отложенным)</th>
                <th className="r">Всего с ожидаемыми</th>
              </tr>
            </thead>
            <tbody>
              {data.months.map((m) => (
                <tr key={m.month}>
                  <td>{monthTitle(m.month)}</td>
                  <td className="r">{m.income ? pln(m.income) : '—'}</td>
                  <td className="r">{m.spent ? `−${pln(m.spent)}` : '—'}</td>
                  <td className={'r ' + tone(m.endBalance)}>{pln(m.endBalance)}</td>
                  <td className={'r strong ' + tone(m.totalEnd)}>{pln(m.totalEnd)}</td>
                  <td className="r">{m.totalEndWithPotential !== m.totalEnd ? pln(m.totalEndWithPotential) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3>Ближайшие движения денег</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Что</th>
                <th className="r">Сумма</th>
                <th className="r">Остаток</th>
                <th className="r">С ожидаемыми</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={r.kind === 'potential' ? 'potential' : undefined}>
                  <td>{dayMonth(r.date)}</td>
                  <td>
                    {r.kind === 'payout' && r.payout
                      ? `Выплата: зарплата за ${monthName(r.payout.salaryMonth)}, премия за ${monthName(r.payout.bonusMonth)}`
                      : r.label}
                    {r.kind === 'potential' && <span className="sub">ожидается</span>}
                  </td>
                  <td className={'r ' + tone(r.amount)}>{r.amount > 0 ? '+' : ''}{pln(r.amount)}</td>
                  <td className={'r ' + tone(r.balance)}>{pln(r.balance)}</td>
                  <td className="r">{pln(r.balanceWithPotential)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="muted">Пока нет движений. Заполните график и платежи.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {data.timeline.length > 12 && (
          <button type="button" className="link" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Свернуть' : `Показать все (${data.timeline.length})`}
          </button>
        )}
      </div>

      {data.checks.length > 0 && (
        <div className="panel">
          <h3>История проверок</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Дата</th><th className="r">На руках</th><th className="r">Отложено</th><th className="r">Расчёт</th><th className="r">Разница</th><th>Заметка</th><th /></tr>
              </thead>
              <tbody>
                {data.checks.map((c) => {
                  const diff = c.expectedAtEntry == null ? null : c.amount - c.expectedAtEntry;
                  return (
                    <tr key={c.id}>
                      <td>{dayMonth(c.date)}</td>
                      <td className="r">{pln(c.amount)}</td>
                      <td className="r">{c.saved == null ? '—' : pln(c.saved)}</td>
                      <td className="r">{c.expectedAtEntry == null ? '—' : pln(c.expectedAtEntry)}</td>
                      <td className={'r ' + (diff === null ? '' : tone(diff))}>{diff === null ? '—' : `${diff > 0 ? '+' : ''}${pln(diff)}`}</td>
                      <td>{c.note}</td>
                      <td className="r">
                        <button type="button" className="link danger" onClick={() => void remove(c.id)} aria-label={`Удалить проверку ${dayMonth(c.date)}`}>
                          Удалить
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
