'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { MARK_LABEL, type DailyLog } from '../../lib/daily';
import { STATUS_LABEL, type PlanItem } from '../../lib/plan-items';
import {
  WEEKDAY_LABEL,
  dayInfo,
  monthGrid,
  periodLabel,
  shiftDate,
  techoStats,
  weekDates,
  weekdayIndex,
  type TechoMode,
} from '../../lib/techo';

// --- 📒 手帳 (EXP-036) ---
// 上: 日・週・月の切り替えと前後への移動 / 中: 見開き (週の 7 日・月の表) か日のページ / 下: これまでのデータ。

const MODES: [TechoMode, string][] = [['day', '日'], ['week', '週'], ['month', '月']];
const MARK_SIGN = { good: '〇', fair: '△', bad: '×' } as const;

const btn =
  'px-3 py-1.5 rounded-lg border text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

type Props = {
  today: string;
  mode: TechoMode;
  date: string;
  items: PlanItem[];
  logs: DailyLog[];
  notes: { kind: string; body: string; createdAt: string }[];
  onChange(mode: TechoMode, date: string): void;
  /** 日のページ (その日の ToDo と 1 日の記録)。 */
  renderDay(date: string): ReactNode;
};

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

// 中身 (日付・数・〇△×・ToDo) がそのままボタンの名前になる。aria-label で上書きしない (a11y レビュー)
function DayButton({ date, today, onPick, children, dim = false }: { date: string; today: string; onPick(d: string): void; children: ReactNode; dim?: boolean }) {
  const isToday = date === today;
  return (
    <button
      type="button"
      onClick={() => onPick(date)}
      aria-current={isToday ? 'date' : undefined}
      className={`w-full min-h-full text-left p-1.5 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${isToday ? 'border-2 border-blue-600 bg-blue-50' : 'border border-gray-200 bg-white hover:bg-gray-50'} ${dim ? 'text-gray-500' : 'text-gray-900'}`}
    >
      {children}
      <span className="sr-only">のページを開く</span>
    </button>
  );
}

function WeekView({ today, date, items, logs, onPick }: { today: string; date: string; items: PlanItem[]; logs: DailyLog[]; onPick(d: string): void }) {
  return (
    <ul className="flex flex-col gap-2">
      {weekDates(date).map((d) => {
        const info = dayInfo(items, logs, d);
        return (
          <li key={d}>
            <DayButton date={d} today={today} onPick={onPick}>
              <span className="flex items-center gap-2 text-sm font-bold">
                {md(d)} ({WEEKDAY_LABEL[weekdayIndex(d)]})
                {d === today && <span className="rounded bg-blue-600 px-1.5 text-xs text-white">今日</span>}
                {info.mark && <span className="font-normal">{MARK_LABEL[info.mark]}</span>}
                <span className="ml-auto font-normal text-gray-600">ToDo {info.doneCount}/{info.todos.length}</span>
              </span>
              {info.todos.length > 0 && (
                <span className="mt-1 flex flex-col gap-0.5 text-sm">
                  {info.todos.slice(0, 4).map((t) => (
                    <span key={t.id} className="min-w-0 break-words">
                      <span className="text-gray-600">[{STATUS_LABEL[t.status]}]</span> {t.title}
                    </span>
                  ))}
                  {info.todos.length > 4 && <span className="text-gray-600">ほか {info.todos.length - 4} つ</span>}
                </span>
              )}
            </DayButton>
          </li>
        );
      })}
    </ul>
  );
}

function MonthView({ today, date, items, logs, onPick }: { today: string; date: string; items: PlanItem[]; logs: DailyLog[]; onPick(d: string): void }) {
  return (
    <table className="w-full table-fixed border-separate border-spacing-1">
      <caption className="sr-only">{periodLabel('month', date)} の日付の表。各日の ToDo の済みの数と全部の数、1 日の記録</caption>
      <thead>
        <tr>
          {WEEKDAY_LABEL.map((w) => (
            <th key={w} scope="col" className="text-xs font-bold text-gray-700">{w}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {monthGrid(date).map((row) => (
          <tr key={row[0].date}>
            {row.map(({ date: d, inMonth }) => {
              const info = dayInfo(items, logs, d);
              return (
                <td key={d} className="align-top h-16">
                  <DayButton date={d} today={today} onPick={onPick} dim={!inMonth}>
                    {/* 見た目は短く、読み上げは文で (a11y レビュー) */}
                    <span aria-hidden="true">
                      <span className="block text-xs font-bold">{Number(d.slice(8, 10))}</span>
                      {info.todos.length > 0 && <span className="block text-xs">{info.doneCount}/{info.todos.length}</span>}
                      {info.mark && <span className="block text-xs">{MARK_SIGN[info.mark]}</span>}
                    </span>
                    <span className="sr-only">{monthCellText(d, today, info)}</span>
                  </DayButton>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 月の表の 1 日を読み上げる文: 「10月2日 (金) 今日、ToDo 1/3 済み、記録: 〇 できた」。 */
export function monthCellText(d: string, today: string, info: { todos: PlanItem[]; doneCount: number; mark: keyof typeof MARK_SIGN | null }): string {
  const parts = [`${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日 (${WEEKDAY_LABEL[weekdayIndex(d)]})${d === today ? ' 今日' : ''}`];
  if (info.todos.length > 0) parts.push(`ToDo ${info.doneCount}/${info.todos.length} 済み`);
  if (info.mark) parts.push(`記録: ${MARK_LABEL[info.mark]}`);
  return parts.join('、');
}

function MonthLegend() {
  return <p className="text-xs text-gray-600">数は ToDo の 済み/全部・〇 できた / △ 少し / × できなかった (1 日の記録)</p>;
}

function pct(r: { done: number; judged: number } | null): string {
  return r ? `${Math.round((r.done / r.judged) * 100)}% (${r.done}/${r.judged})` : 'まだ無し';
}

function Stats({ items, logs, notes, today }: { items: PlanItem[]; logs: DailyLog[]; notes: Props['notes']; today: string }) {
  const s = techoStats(items, logs, notes, today);
  const dl = (label: string, value: ReactNode) => (
    <div className="flex gap-2">
      <dt className="shrink-0 w-28 text-gray-600">{label}</dt>
      <dd className="min-w-0 break-words text-gray-900">{value}</dd>
    </div>
  );
  return (
    <section aria-labelledby="techo-stats-heading" className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-3">
      <h3 id="techo-stats-heading" className="text-base font-bold text-gray-800"><span aria-hidden="true">📊</span> これまでのデータ</h3>
      <h4 className="text-sm font-bold text-gray-700">進捗</h4>
      <dl className="flex flex-col gap-1 text-sm">
        {dl('KGI', s.kgi ? `${s.kgi.title} / ${s.kgi.daysLeft === null ? '期日なし' : s.kgi.daysLeft >= 0 ? `あと ${s.kgi.daysLeft} 日` : `${-s.kgi.daysLeft} 日過ぎ`}` : 'まだ無し')}
        {s.kpis.map((k, i) => dl(i === 0 ? 'KPI' : '', `${k.title}${k.target ? ` (判定基準 ${k.target})` : ''}${k.dueDate ? ` / 期日 ${k.dueDate}` : ''}`))}
      </dl>
      <h4 className="text-sm font-bold text-gray-700">達成</h4>
      <dl className="flex flex-col gap-1 text-sm">
        {dl('これまでの ToDo', `成功 ${s.totals.succeeded}・実行 ${s.totals.done}・失敗 ${s.totals.failed}・調整 ${s.totals.adjusted}・棚上げ ${s.totals.shelved}`)}
        {dl('できた割合', `最近 7 日 ${pct(s.rate7)} / 最近 30 日 ${pct(s.rate30)}`)}
        {dl('1 日の記録', `最近 30 日で ${s.loggedDays30} 日・続けて ${s.streak} 日`)}
      </dl>
      <h4 className="text-sm font-bold text-gray-700">AI と決めた判定・仮説</h4>
      {s.recentJudged.length === 0 && s.hypotheses.length === 0 ? (
        <p className="text-sm text-gray-700">まだありません。ToDo を「✓ 完了」にすると、AI と判定して記録されます。</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {s.recentJudged.map((j, i) => (
            <li key={`j-${i}`} className="min-w-0 break-words">
              <span className="text-gray-600">{j.dueDate ? md(j.dueDate) : ''} [{STATUS_LABEL[j.status]}]</span> {j.title}
            </li>
          ))}
          {s.hypotheses.map((h, i) => (
            <li key={`h-${i}`} className="min-w-0 break-words">
              <span className="text-gray-600">[仮説]</span> {h.body}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 手帳の画面 (状態は外から)。 */
export function TechoView({ today, mode, date, items, logs, notes, onChange, renderDay }: Props) {
  // 日付を押すと押したボタンが消えるので、見出しへフォーカスを移す (a11y レビュー)
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const moveFocus = useRef(false);
  useEffect(() => {
    if (moveFocus.current) {
      headingRef.current?.focus();
      moveFocus.current = false;
    }
  }, [mode, date]);
  const openDay = (d: string) => {
    moveFocus.current = true;
    onChange('day', d);
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="手帳の表示" className="flex gap-1">
          {MODES.map(([m, label]) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => onChange(m, date)}
              className={`${btn} ${mode === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-1">
          <button type="button" aria-label={`前の${mode === 'day' ? '日' : mode === 'week' ? '週' : '月'}`} onClick={() => onChange(mode, shiftDate(mode, date, -1))} className={`${btn} bg-white text-gray-800 border-gray-300 hover:bg-gray-50`}>
            <span aria-hidden="true">◀</span> 前
          </button>
          <button type="button" onClick={() => onChange(mode, today)} className={`${btn} bg-white text-gray-800 border-gray-300 hover:bg-gray-50`}>
            今日
          </button>
          <button type="button" aria-label={`次の${mode === 'day' ? '日' : mode === 'week' ? '週' : '月'}`} onClick={() => onChange(mode, shiftDate(mode, date, 1))} className={`${btn} bg-white text-gray-800 border-gray-300 hover:bg-gray-50`}>
            次 <span aria-hidden="true">▶</span>
          </button>
        </div>
      </div>
      <h3 ref={headingRef} tabIndex={-1} className="text-base font-bold text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
        <span aria-hidden="true">📒</span> {periodLabel(mode, date)}{mode === 'day' && date === today ? ' (今日)' : ''}
      </h3>
      <p role="status" className="sr-only">{`${mode === 'day' ? '日' : mode === 'week' ? '週' : '月'}の表示: ${periodLabel(mode, date)}`}</p>
      {mode === 'week' && <WeekView today={today} date={date} items={items} logs={logs} onPick={openDay} />}
      {mode === 'month' && (
        <>
          <MonthView today={today} date={date} items={items} logs={logs} onPick={openDay} />
          <MonthLegend />
        </>
      )}
      {mode === 'day' && renderDay(date)}
      <Stats items={items} logs={logs} notes={notes} today={today} />
    </div>
  );
}
