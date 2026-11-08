import { useEffect, useState } from 'react';
import { api, type Summary } from '../api';
import { currentMonth, dayMonth, monthName, pln, tone } from '../fmt';

export function OverviewPage() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .summary(currentMonth(), 6)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить'));
  }, []);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return <p className="muted">Загрузка…</p>;

  const { totals } = data;
  const hasShifts = data.months.some((m) => m.work.shifts > 0 || m.cash.payout.totalNet > 0);

  return (
    <div className="stack">
      <div className="stats">
        <div className="panel">
          <h3>Отложено</h3>
          <p className="big-num">{pln(totals.totalSaved)}</p>
          <p className="muted">по всем целям</p>
        </div>
        <div className="panel">
          <h3>Нужно откладывать</h3>
          <p className="big-num">{pln(totals.plannedToSave)}</p>
          <p className="muted">в месяц, чтобы успеть к срокам</p>
        </div>
        <div className="panel">
          <h3>Можно отложить</h3>
          <p className={'big-num ' + tone(totals.avgFree)}>{pln(totals.avgFree)}</p>
          <p className="muted">в месяц в среднем, ближайшие 3 выплаты</p>
        </div>
        <div className="panel">
          <h3>После целей остаётся</h3>
          <p className={'big-num ' + tone(totals.leftover)}>{pln(totals.leftover)}</p>
          <p className="muted">{totals.leftover < 0 ? 'не хватает на все цели' : 'свободно в месяц'}</p>
        </div>
      </div>

      {!hasShifts && <p className="hint">Пока нет смен. Заполните график, и здесь появятся выплаты по месяцам.</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Выплата</th>
              <th className="r">Зарплата</th>
              <th className="r">Премия</th>
              <th className="r">Другие доходы</th>
              <th className="r">Платежи</th>
              <th className="r">Остаток</th>
              <th className="r">С ожидаемыми</th>
            </tr>
          </thead>
          <tbody>
            {data.months.map(({ month, cash }) => (
              <tr key={month}>
                <td>
                  {dayMonth(cash.payout.date)}
                  <span className="sub">за {monthName(cash.payout.salaryMonth)}</span>
                </td>
                <td className="r">{pln(cash.payout.salaryNet)}</td>
                <td className="r">
                  {pln(cash.payout.bonusNet)}
                  <span className="sub">за {monthName(cash.payout.bonusMonth)}</span>
                </td>
                <td className="r">{cash.manualIncome ? pln(cash.manualIncome) : '—'}</td>
                <td className="r">−{pln(cash.obligations + cash.living)}</td>
                <td className={'r strong ' + tone(cash.free)}>{pln(cash.free)}</td>
                <td className="r">{cash.potentialIncome ? pln(cash.freeWithPotential) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">Суммы — на руки, после коэффициента {data.settings.netCoef}. Доходы, которые вы вписываете сами, идут без налога.</p>
    </div>
  );
}
