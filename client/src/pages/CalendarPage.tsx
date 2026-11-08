import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type ShiftRow, type Summary } from '../api';
import { addMonths, currentMonth, dayMonth, monthName, monthTitle, pln, today } from '../fmt';
import { daysInMonth, isWeekend } from '../../../shared/core';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WEEKDAY_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

const dateOf = (month: string, day: number): string => `${month}-${String(day).padStart(2, '0')}`;
const fmtMult = (m: number): string => `×${String(m).replace('.', ',')}`;
const weekdayName = (date: string): string => WEEKDAY_FULL[new Date(`${date}T00:00:00Z`).getUTCDay()];

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

type Kind = 'day' | 'night';
type KindChoice = 'none' | Kind;

// Шаблон: «Д Д Н Н В В В В», «Д+» — доп. смена, В или - — выходной
function parsePattern(src: string): { kind: KindChoice; extra: boolean }[] {
  return src
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => {
      const extra = t.endsWith('+');
      const c = t.replace('+', '').toLowerCase();
      if (c === 'д' || c === 'd') return { kind: 'day' as const, extra };
      if (c === 'н' || c === 'n') return { kind: 'night' as const, extra };
      return { kind: 'none' as const, extra: false };
    });
}

interface Change {
  kind?: KindChoice;
  extra?: boolean;
  weekend?: boolean | null;
}

function Seg<T extends string>(props: {
  label: string;
  value: T | null;
  options: { value: T; text: string }[];
  disabled?: boolean;
  onPick: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={props.label} className="seg">
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={'seg-btn' + (props.value === o.value ? ' on' : '')}
          aria-pressed={props.value === o.value}
          disabled={props.disabled}
          onClick={() => props.onPick(o.value)}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

export function CalendarPage() {
  const [month, setMonth] = useState(currentMonth());
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [multi, setMulti] = useState(false);
  const [pattern, setPattern] = useState('Д Д Н Н В В В В');
  const [busy, setBusy] = useState(false);
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

  // при смене месяца выбор сбрасывается
  useEffect(() => {
    setSelected([]);
    setAnchor(null);
  }, [month]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const byDate = useMemo(() => new Map(shifts.map((s) => [s.date, s])), [shifts]);

  const onDay = (date: string, e: React.MouseEvent) => {
    if (e.shiftKey && anchor) {
      const range = datesBetween(anchor, date);
      setSelected(e.ctrlKey || e.metaKey ? Array.from(new Set([...selected, ...range])) : range);
      return;
    }
    setAnchor(date);
    if (e.ctrlKey || e.metaKey || multi) {
      setSelected(selected.includes(date) ? selected.filter((d) => d !== date) : [...selected, date]);
    } else {
      setSelected([date]);
    }
  };

  // ---- состояние выбранных дней ----
  const selShifts = selected.map((d) => byDate.get(d));
  const withShift = selShifts.filter((s): s is ShiftRow => Boolean(s));
  const allHaveShift = selected.length > 0 && withShift.length === selected.length;

  const kindVal: KindChoice | null =
    selected.length === 0
      ? null
      : withShift.length === 0
        ? 'none'
        : allHaveShift && withShift.every((s) => s.kind === withShift[0].kind)
          ? withShift[0].kind
          : null;
  const extraVal: boolean | 'mixed' =
    withShift.length === 0 ? false : withShift.every((s) => s.extra) ? true : withShift.some((s) => s.extra) ? 'mixed' : false;
  const weekendVals = new Set(withShift.map((s) => (s.weekend === null || s.weekend === undefined ? 'cal' : s.weekend ? 'yes' : 'no')));
  const weekendVal: 'cal' | 'yes' | 'no' | null = weekendVals.size === 1 ? (Array.from(weekendVals)[0] as 'cal' | 'yes' | 'no') : null;

  // ---- применение изменения ко всем выбранным дням ----
  const commit = async (change: Change) => {
    if (!selected.length || busy) return;
    const groups = new Map<string, { dates: string[]; kind: Kind; extra: boolean; weekend: boolean | null }>();
    const clear: string[] = [];
    for (const d of selected) {
      const cur = byDate.get(d);
      if (change.kind === 'none') {
        if (cur) clear.push(d);
        continue;
      }
      const kind = (change.kind as Kind | undefined) ?? cur?.kind;
      if (!kind) continue; // смены нет и тип не выбран — менять нечего
      const extra = change.extra ?? cur?.extra ?? false;
      const weekend = change.weekend !== undefined ? change.weekend : (cur?.weekend ?? null);
      const key = `${kind}|${extra}|${weekend}`;
      const g = groups.get(key) ?? { dates: [], kind, extra, weekend };
      g.dates.push(d);
      groups.set(key, g);
    }
    setBusy(true);
    try {
      if (clear.length) await api.clearShifts(clear);
      for (const g of groups.values()) await api.putShifts(g.dates, g.kind, g.extra, g.weekend);
      await load();
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
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
    setBusy(true);
    try {
      for (const [key, dates] of groups) {
        const [kind, ex] = key.split('|');
        if (kind === 'none') await api.clearShifts(dates);
        else await api.putShifts(dates, kind as Kind, ex === 'true');
      }
      await load();
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось заполнить');
    } finally {
      setBusy(false);
    }
  };

  const first = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  const offset = (first + 6) % 7;
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth(month) }, (_, i) => i + 1)];
  const cur = summary?.months[0];
  const st = summary?.settings;
  const todayStr = today();
  const one = selected.length === 1 ? selected[0] : null;
  const oneShift = one ? byDate.get(one) : undefined;
  const totalNet = withShift.reduce((a, s) => a + s.pay.net, 0);

  const reason = (s: ShiftRow): string => {
    const manual = s.weekend !== null && s.weekend !== undefined;
    if (s.extra && s.pay.weekend) return manual ? 'доп. смена, выходной вручную' : 'доп. смена в выходной';
    if (s.extra) return 'доп. смена';
    if (s.pay.weekend) return manual ? 'выходной вручную' : 'выходной по календарю';
    return 'обычный день';
  };

  return (
    <div className="cal-layout">
      <section>
        <div className="month-bar">
          <button className="icon" onClick={() => setMonth(addMonths(month, -1))} aria-label="Предыдущий месяц">‹</button>
          <h2>{monthTitle(month)}</h2>
          <button className="icon" onClick={() => setMonth(addMonths(month, 1))} aria-label="Следующий месяц">›</button>
          <button className="link" onClick={() => setMonth(currentMonth())}>Сегодня</button>
        </div>

        <div className="select-bar">
          <label className="check">
            <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
            Выбирать несколько дней
          </label>
          {selected.length > 0 && (
            <button className="link" onClick={() => setSelected([])}>Снять выбор ({selected.length})</button>
          )}
        </div>
        <p className="hint">Нажмите на день, чтобы настроить его справа. Ctrl или Cmd + клик добавляет день к выбору, Shift + клик выбирает диапазон.</p>

        {error && <p className="error" role="alert">{error}</p>}

        <div className="grid" role="grid" aria-label={`Календарь, ${monthTitle(month)}`}>
          {WEEKDAYS.map((w, i) => (
            <div key={w} className={'wd' + (i >= 5 ? ' we' : '')} role="columnheader">{w}</div>
          ))}
          {cells.map((d, i) => {
            if (d === null) return <div key={`e${i}`} className="cell empty" />;
            const date = dateOf(month, d);
            const s = byDate.get(date);
            const calWeekend = isWeekend(date);
            const isSel = selected.includes(date);
            const cls = [
              'cell',
              s ? s.kind : 'free',
              s?.extra ? 'extra' : '',
              !s && calWeekend ? 'we' : '',
              date === todayStr ? 'today' : '',
              isSel ? 'sel' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <button
                key={date}
                className={cls}
                aria-pressed={isSel}
                onClick={(e) => onDay(date, e)}
                aria-label={`${dayMonth(date)}, ${weekdayName(date)}${s ? `, ${s.kind === 'day' ? 'дневная' : 'ночная'}${s.extra ? ', доп. смена' : ''}${s.pay.weekend ? ', выходной' : ''}, ${pln(s.pay.net)} на руки` : ', смены нет'}`}
              >
                <span className="dtop">
                  <span className="dnum">{d}</span>
                  {s && s.pay.mult !== 1 && <span className="dmult">{fmtMult(s.pay.mult)}</span>}
                </span>
                {s && <span className="dkind">{s.kind === 'day' ? 'День' : 'Ночь'}{s.extra ? ' · доп.' : ''}</span>}
                {s && <span className="dpay">{Math.round(s.pay.net)}</span>}
              </button>
            );
          })}
        </div>

        <div className="pattern">
          <label>
            Повторяющийся график с {anchor && anchor.startsWith(month) ? dayMonth(anchor) : `1 ${monthName(month).slice(0, 3)}`} до конца месяца
            <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="Д Д Н Н В В В В" />
          </label>
          <button onClick={fillPattern} disabled={busy}>Заполнить</button>
          <p className="hint">Д — дневная, Н — ночная, В — выходной (смена убирается). Плюс после буквы — доп. смена (Д+). Шаблон повторяется по кругу. Тонкие настройки дня делайте справа.</p>
        </div>
      </section>

      <aside className="side">
        <div className="panel editor" aria-live="polite">
          {selected.length === 0 ? (
            <>
              <h3>День</h3>
              <p className="muted">Выберите день в календаре, чтобы поставить, изменить или убрать смену.</p>
            </>
          ) : (
            <>
              <h3>
                {one ? `${dayMonth(one)}, ${weekdayName(one)}` : `Выбрано дней: ${selected.length}`}
              </h3>
              {!one && (
                <p className="muted">
                  Со сменой: {withShift.length}. Изменения применяются ко всем выбранным дням.
                </p>
              )}

              <div className="field">
                <span className="field-label">Смена</span>
                <Seg<KindChoice>
                  label="Тип смены"
                  value={kindVal}
                  disabled={busy}
                  options={[
                    { value: 'none', text: 'Нет' },
                    { value: 'day', text: 'Дневная' },
                    { value: 'night', text: 'Ночная' },
                  ]}
                  onPick={(v) => void commit({ kind: v })}
                />
                {st && (
                  <span className="hint">
                    Дневная {st.dayShiftStart}–{st.dayShiftEnd}, ночная {st.nightShiftStart}–{st.nightShiftEnd}
                  </span>
                )}
              </div>

              <div className="field">
                <span className="field-label">Доп. смена</span>
                <label className={'check' + (withShift.length === 0 ? ' disabled' : '')}>
                  <input
                    type="checkbox"
                    checked={extraVal === true}
                    ref={(el) => {
                      if (el) el.indeterminate = extraVal === 'mixed';
                    }}
                    disabled={withShift.length === 0 || busy}
                    onChange={(e) => void commit({ extra: e.target.checked })}
                  />
                  Доп. смена ({st ? `${fmtMult(st.extraMult)}, в выходной ${fmtMult(st.extraWeekendMult)}` : ''})
                </label>
              </div>

              <div className="field">
                <span className="field-label">Выходной</span>
                <Seg<'cal' | 'yes' | 'no'>
                  label="Выходной день"
                  value={weekendVal}
                  disabled={withShift.length === 0 || busy}
                  options={[
                    { value: 'cal', text: 'По календарю' },
                    { value: 'yes', text: 'Выходной' },
                    { value: 'no', text: 'Будний' },
                  ]}
                  onPick={(v) => void commit({ weekend: v === 'cal' ? null : v === 'yes' })}
                />
                <span className="hint">
                  «По календарю» — суббота и воскресенье{st ? ` (${fmtMult(st.weekendMult)})` : ''}. «Выходной» подходит для праздника или для переноса, «Будний» убирает надбавку.
                </span>
              </div>

              {one && oneShift && (
                <dl className="calc">
                  <dt>Считается как</dt><dd>{reason(oneShift)}</dd>
                  <dt>Часов оплачивается</dt>
                  <dd>
                    {oneShift.pay.paidHours}
                    {oneShift.pay.nightHours > 0 && ` (ночных ${oneShift.pay.nightHours})`}
                  </dd>
                  <dt>Множитель</dt><dd>{fmtMult(oneShift.pay.mult)}</dd>
                  <dt>Brutto</dt><dd>{pln(oneShift.pay.gross)}</dd>
                  <dt>На руки</dt><dd><strong>{pln(oneShift.pay.net)}</strong></dd>
                </dl>
              )}
              {!one && withShift.length > 0 && (
                <p className="calc-total">На руки за выбранные смены: <strong>{pln(totalNet)}</strong></p>
              )}
              {one && !oneShift && <p className="hint">В этот день смены нет. Выберите «Дневная» или «Ночная», чтобы добавить.</p>}

              {withShift.length > 0 && (
                <button className="danger-btn" disabled={busy} onClick={() => void commit({ kind: 'none' })}>
                  {one ? 'Убрать смену' : `Убрать смены (${withShift.length})`}
                </button>
              )}
            </>
          )}
        </div>

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
