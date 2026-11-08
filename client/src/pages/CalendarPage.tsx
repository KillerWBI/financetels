import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type ShiftRow, type Summary } from '../api';
import { addMonths, currentMonth, dayMonth, monthName, monthTitle, pln, today } from '../fmt';
import { daysInMonth } from '../../../shared/core';

type Brush = 'day' | 'night' | 'off';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const dateOf = (month: string, day: number): string => `${month}-${String(day).padStart(2, '0')}`;

function datesBetween(a: string, b: string): string[] {
  const [from, to] = a <= b ? [a, b] : [b, a];
  const out: string[] = [];
  const d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// Шаблон: «Д Д Н Н В В В В», «Д+» — доп. смена, В или - — выходной
function parsePattern(src: string): { kind: Brush; extra: boolean }[] {
  return src
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => {
      const extra = t.endsWith('+');
      const c = t.replace('+', '').toLowerCase();
      if (c === 'д' || c === 'd') return { kind: 'day' as const, extra };
      if (c === 'н' || c === 'n') return { kind: 'night' as const, extra };
      return { kind: 'off' as const, extra: false };
    });
}

export function CalendarPage() {
  const [month, setMonth] = useState(currentMonth());
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [brush, setBrush] = useState<Brush>('day');
  const [extra, setExtra] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [pattern, setPattern] = useState('Д Д Н Н В В В В');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, sum] = await Promise.all([
        api.shifts(dateOf(month, 1), dateOf(month, daysInMonth(month))),
        api.summary(month, 1),
      ]);
      setShifts(s);
      setSummary(sum);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить');
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const byDate = useMemo(() => new Map(shifts.map((s) => [s.date, s])), [shifts]);

  const apply = async (dates: string[], kind: Brush, isExtra: boolean) => {
    try {
      if (kind === 'off') await api.clearShifts(dates);
      else await api.putShifts(dates, kind, isExtra);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    }
  };

  const onDay = (date: string, shiftKey: boolean) => {
    const dates = shiftKey && anchor ? datesBetween(anchor, date) : [date];
    setAnchor(date);
    void apply(dates, brush, extra);
  };

  const fillPattern = async () => {
    const tokens = parsePattern(pattern);
    if (!tokens.length) return;
    const start = anchor && anchor.startsWith(month) ? Number(anchor.slice(8)) : 1;
    const groups = new Map<string, string[]>();
    for (let d = start, i = 0; d <= daysInMonth(month); d++, i++) {
      const t = tokens[i % tokens.length];
      const key = `${t.kind}|${t.extra}`;
      groups.set(key, [...(groups.get(key) ?? []), dateOf(month, d)]);
    }
    try {
      for (const [key, dates] of groups) {
        const [kind, ex] = key.split('|');
        if (kind === 'off') await api.clearShifts(dates);
        else await api.putShifts(dates, kind as 'day' | 'night', ex === 'true');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось заполнить');
    }
  };

  const first = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  const offset = (first + 6) % 7;
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth(month) }, (_, i) => i + 1)];
  const cur = summary?.months[0];
  const todayStr = today();

  return (
    <div className="cal-layout">
      <section>
        <div className="month-bar">
          <button className="icon" onClick={() => setMonth(addMonths(month, -1))} aria-label="Предыдущий месяц">‹</button>
          <h2>{monthTitle(month)}</h2>
          <button className="icon" onClick={() => setMonth(addMonths(month, 1))} aria-label="Следующий месяц">›</button>
          <button className="link" onClick={() => setMonth(currentMonth())}>Сегодня</button>
        </div>

        <div className="brushes" role="group" aria-label="Что ставить в день">
          <button className={brush === 'day' ? 'brush day on' : 'brush day'} onClick={() => setBrush('day')}>Дневная</button>
          <button className={brush === 'night' ? 'brush night on' : 'brush night'} onClick={() => setBrush('night')}>Ночная</button>
          <button className={brush === 'off' ? 'brush off on' : 'brush off'} onClick={() => setBrush('off')}>Выходной</button>
          <label className={'check' + (brush === 'off' ? ' disabled' : '')}>
            <input type="checkbox" checked={extra} disabled={brush === 'off'} onChange={(e) => setExtra(e.target.checked)} />
            Доп. смена
          </label>
        </div>
        <p className="hint">Нажмите на день, чтобы поставить смену. Shift + клик заполняет диапазон от прошлого выбранного дня.</p>

        {error && <p className="error" role="alert">{error}</p>}

        <div className="grid" role="grid" aria-label={`Календарь, ${monthTitle(month)}`}>
          {WEEKDAYS.map((w, i) => (
            <div key={w} className={'wd' + (i >= 5 ? ' we' : '')} role="columnheader">{w}</div>
          ))}
          {cells.map((d, i) => {
            if (d === null) return <div key={`e${i}`} className="cell empty" />;
            const date = dateOf(month, d);
            const s = byDate.get(date);
            const weekend = (offset + d - 1) % 7 >= 5;
            const cls = ['cell', s ? s.kind : 'free', s?.extra ? 'extra' : '', weekend ? 'we' : '', date === todayStr ? 'today' : '', date === anchor ? 'anchor' : '']
              .filter(Boolean)
              .join(' ');
            return (
              <button
                key={date}
                className={cls}
                onClick={(e) => onDay(date, e.shiftKey)}
                aria-label={`${dayMonth(date)}${s ? `, ${s.kind === 'day' ? 'дневная' : 'ночная'}${s.extra ? ' доп. смена' : ''}, ${pln(s.pay.net)} на руки` : ', выходной'}`}
              >
                <span className="dnum">{d}</span>
                {s && (
                  <>
                    <span className="dkind">{s.kind === 'day' ? 'День' : 'Ночь'}{s.extra ? ' +' : ''}</span>
                    <span className="dpay">{Math.round(s.pay.net)}</span>
                  </>
                )}
              </button>
            );
          })}
        </div>

        <div className="pattern">
          <label>
            Повторяющийся график с {anchor && anchor.startsWith(month) ? dayMonth(anchor) : `1 ${monthName(month).slice(0, 3)}`} до конца месяца
            <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="Д Д Н Н В В В В" />
          </label>
          <button onClick={fillPattern}>Заполнить</button>
          <p className="hint">Д — дневная, Н — ночная, В — выходной. Плюс после буквы — доп. смена (Д+). Шаблон повторяется по кругу.</p>
        </div>
      </section>

      <aside className="side">
        {cur && (
          <>
            <div className="panel">
              <h3>Заработано в {monthName(month)}</h3>
              <p className="big-num">{pln(cur.work.net)}</p>
              <p className="muted">на руки · brutto {pln(cur.work.gross)}</p>
              <dl>
                <dt>Смен</dt><dd>{cur.work.shifts} ({cur.work.dayShifts} дн., {cur.work.nightShifts} ноч., доп. {cur.work.extraShifts})</dd>
                <dt>Оплачено часов</dt><dd>{cur.work.hours}</dd>
                <dt>Премия за этот месяц</dt><dd>{pln(cur.work.bonusNet)}</dd>
              </dl>
              <p className="hint">Премия придёт 7 {monthName(addMonths(month, 2)).slice(0, 3)}.</p>
            </div>

            <div className="panel">
              <h3>Выплата {dayMonth(cur.cash.payout.date)}</h3>
              <p className="big-num">{pln(cur.cash.payout.totalNet)}</p>
              <dl>
                <dt>Зарплата за {monthName(cur.cash.payout.salaryMonth)}</dt><dd>{pln(cur.cash.payout.salaryNet)}</dd>
                <dt>Премия за {monthName(cur.cash.payout.bonusMonth)}</dt><dd>{pln(cur.cash.payout.bonusNet)}</dd>
                {cur.cash.manualIncome > 0 && (<><dt>Другие доходы</dt><dd>{pln(cur.cash.manualIncome)}</dd></>)}
                <dt>Обязательные платежи</dt><dd>−{pln(cur.cash.obligations)}</dd>
                {cur.cash.living > 0 && (<><dt>Повседневные траты</dt><dd>−{pln(cur.cash.living)}</dd></>)}
              </dl>
              <p className={'free ' + (cur.cash.free < 0 ? 'neg' : 'pos')}>
                Остаток {pln(cur.cash.free)}
              </p>
              {cur.cash.potentialIncome > 0 && (
                <p className="muted">С ожидаемыми доходами: {pln(cur.cash.freeWithPotential)}</p>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
