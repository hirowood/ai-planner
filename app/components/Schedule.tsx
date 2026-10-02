'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { parseItemSlots, slotLabel, timetable, type ItemSlot, type TimetableEntry } from '../../lib/slots';
import { TASK_STATUSES, TASK_STATUS_LABEL, parseTaskList, type DailyTask, type TaskStatus } from '../../lib/daily-tasks';
import { STATUS_LABEL, type ItemStatus, type PlanItem } from '../../lib/plan-items';
import { WEEKDAY_LABEL, addMonths, monthGrid, weekdayIndex } from '../../lib/techo';

// --- アプリ内の予定表 (EXP-039・040) ---
// タイムスケジュール (1 時間ごとの行)・ToDo の時刻の入力・日常のタスク・右の列のカレンダー。Google カレンダーは後で。

const input =
  'px-2 py-1 rounded-lg border border-gray-500 bg-white text-gray-900 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
const btn =
  'px-2 py-1 rounded-lg border text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

export type ScheduleItem = {
  key: string;
  title: string;
  start: string;
  end: string;
  /** 印: 「[日常]」やプロジェクト名 */
  badge: string;
  status: string;
};

/** 表示する時間の範囲: 既定 6〜24 時・それより早い / 遅い予定があれば広げる。 */
export function hourRange(entries: { start: string; end: string }[]): { from: number; to: number } {
  let from = 6;
  let to = 24;
  for (const e of entries) {
    if (!e.start || !e.end) continue;
    from = Math.min(from, Number(e.start.slice(0, 2)));
    to = Math.max(to, Math.ceil((Number(e.end.slice(0, 2)) * 60 + Number(e.end.slice(3, 5))) / 60));
  }
  return { from, to: Math.min(24, to) };
}

/** タイムスケジュール: 時刻のある予定を 1 時間ごとの行に・時刻の無いものは下に。 */
export function TimeSchedule({ items, headingId, label = '🕘 タイムスケジュール' }: { items: ScheduleItem[]; headingId: string; label?: string }) {
  const entries: TimetableEntry<ScheduleItem>[] = items.map((i) => ({ key: i.key, start: i.start, end: i.end, value: i }));
  const { timed, untimed } = timetable(entries);
  const { from, to } = hourRange(items);
  const hours = Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-base font-bold text-gray-800">{label}</h3>
      <ol className="flex flex-col border-t border-gray-200">
        {hours.map((h) => {
          const here = timed.filter((e) => Number(e.start.slice(0, 2)) === h);
          return (
            <li key={h} className="flex gap-2 border-b border-gray-200 py-1 min-h-8">
              <span className="w-12 shrink-0 text-xs text-gray-600 tabular-nums">{String(h).padStart(2, '0')}:00</span>
              <ul className="flex min-w-0 flex-1 flex-col gap-1">
                {here.map((e) => (
                  <li key={e.key} className="min-w-0 break-words rounded border-l-4 border-blue-600 bg-blue-50 px-2 py-1 text-sm text-gray-900">
                    <span className="tabular-nums font-bold">{slotLabel(e.start, e.end)}</span> {e.value.title}
                    <span className="ml-1 text-gray-600">{e.value.badge} [{e.value.status}]</span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
      <h4 className="text-sm font-bold text-gray-700">時刻なし</h4>
      {untimed.length === 0 ? (
        <p className="text-sm text-gray-700">ありません</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {untimed.map((e) => (
            <li key={e.key} className="min-w-0 break-words">
              {e.value.title} <span className="text-gray-600">{e.value.badge} [{e.value.status}]</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** ToDo の時刻を入れる / 外す (EXP-039)。 */
export function SlotEditor({ item, slot, onSave }: { item: PlanItem; slot: ItemSlot | undefined; onSave(itemId: string, start: string, end: string): void }) {
  const [start, setStart] = useState(slot?.start ?? '');
  const [end, setEnd] = useState(slot?.end ?? '');
  return (
    <form
      className="flex flex-wrap items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(item.id, start, end);
      }}
    >
      <input type="time" aria-label={`『${item.title}』の開始`} value={start} onChange={(e) => setStart(e.target.value)} className={input} />
      <span aria-hidden="true">〜</span>
      <input type="time" aria-label={`『${item.title}』の終了`} value={end} onChange={(e) => setEnd(e.target.value)} className={input} />
      <button type="submit" className={`${btn} bg-white text-blue-700 border-blue-300 hover:bg-blue-50`}>時刻を入れる</button>
      {slot && (
        <button type="button" onClick={() => { setStart(''); setEnd(''); onSave(item.id, '', ''); }} className={`${btn} bg-white text-gray-800 border-gray-300 hover:bg-gray-50`}>
          時刻を外す
        </button>
      )}
    </form>
  );
}

/** プロジェクトの ToDo の時刻 (EXP-039)。 */
export function useSlots(projectId: string | null): { slots: ItemSlot[]; problem: string | null; save(itemId: string, start: string, end: string): Promise<void> } {
  const [data, setData] = useState<{ projectId: string; slots: ItemSlot[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const current = useRef<string | null>(projectId);
  // 読み直しの合図 (保存の後に足す)
  const [version, setVersion] = useState(0);
  const load = useCallback(async () => {
    setVersion((v) => v + 1);
  }, []);
  useEffect(() => {
    current.current = projectId;
    if (!projectId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/items/slots?projectId=${encodeURIComponent(projectId)}`);
        const body: unknown = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) return setProblem('時刻を読み込めませんでした');
        setData({ projectId, slots: parseItemSlots((body as { slots?: unknown } | null)?.slots) });
        setProblem(null);
      } catch {
        if (!cancelled) setProblem('時刻を読み込めませんでした');
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, version]);
  const save = useCallback(async (itemId: string, start: string, end: string) => {
    const pid = current.current;
    if (!pid) return;
    try {
      const res = await fetch(`/api/items/${encodeURIComponent(itemId)}/slot`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start, end }),
      });
      if (!res.ok) {
        setProblem(res.status === 400 ? '時刻は開始と終了の両方を入れてください (終了は開始より後)' : '時刻を保存できませんでした');
        return;
      }
      await load();
    } catch {
      setProblem('時刻を保存できませんでした');
    }
  }, [load]);
  const slots = projectId && data?.projectId === projectId ? data.slots : [];
  return { slots, problem, save };
}

/** 日常のタスク (EXP-040)。from〜to を読む。 */
export function useTasks(from: string, to: string): {
  tasks: DailyTask[];
  problem: string | null;
  create(day: string, title: string, start: string, end: string): Promise<boolean>;
  update(id: string, patch: { title?: string; status?: TaskStatus; start?: string; end?: string }): Promise<void>;
  remove(id: string): Promise<void>;
} {
  const [tasks, setTasks] = useState<DailyTask[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const load = useCallback(async () => {
    setVersion((v) => v + 1);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/tasks?from=${from}&to=${to}`);
        const body: unknown = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) return setProblem('日常の ToDo を読み込めませんでした');
        setTasks(parseTaskList((body as { tasks?: unknown } | null)?.tasks));
        setProblem(null);
      } catch {
        if (!cancelled) setProblem('日常の ToDo を読み込めませんでした');
      }
    })();
    return () => { cancelled = true; };
  }, [from, to, version]);
  const create = useCallback(async (day: string, title: string, start: string, end: string) => {
    try {
      const res = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day, title, start, end }) });
      if (!res.ok) {
        setProblem(res.status === 400 ? '題 (100 字まで) と、時刻は開始と終了の両方を入れてください' : '日常の ToDo を足せませんでした');
        return false;
      }
      await load();
      return true;
    } catch {
      setProblem('日常の ToDo を足せませんでした');
      return false;
    }
  }, [load]);
  const update = useCallback(async (id: string, patch: { title?: string; status?: TaskStatus; start?: string; end?: string }) => {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      if (!res.ok) return setProblem('日常の ToDo を変えられませんでした');
      await load();
    } catch {
      setProblem('日常の ToDo を変えられませんでした');
    }
  }, [load]);
  const remove = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) return setProblem('日常の ToDo を消せませんでした');
      await load();
    } catch {
      setProblem('日常の ToDo を消せませんでした');
    }
  }, [load]);
  return { tasks, problem, create, update, remove };
}

/** 日常の ToDo の欄 (EXP-040): 足す・状態・消す (2 回押し)。 */
export function DailyTasksView({ day, tasks, problem, onCreate, onUpdate, onRemove }: {
  day: string;
  tasks: DailyTask[];
  problem: string | null;
  onCreate(title: string, start: string, end: string): Promise<boolean> | void;
  onUpdate(id: string, patch: { status?: TaskStatus }): void;
  onRemove(id: string): void;
}) {
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [armed, setArmed] = useState<string | null>(null);
  const mine = tasks.filter((t) => t.day === day);
  return (
    <section aria-labelledby="daily-tasks-heading" className="flex flex-col gap-2">
      <h3 id="daily-tasks-heading" className="text-base font-bold text-gray-800"><span aria-hidden="true">🏠</span> 日常の ToDo</h3>
      <p className="text-sm text-gray-600">プロジェクトの外の予定 (買い物・通院など)。時間割にも出ます。</p>
      {mine.length === 0 ? (
        <p className="text-sm text-gray-700">この日の日常の ToDo はまだありません。</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {mine.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 break-words text-sm text-gray-900">
                {t.start && t.end && <span className="tabular-nums font-bold">{slotLabel(t.start, t.end)} </span>}
                {t.title}
              </span>
              <span role="group" aria-label={`『${t.title}』の状態`} className="flex gap-1">
                {TASK_STATUSES.map((s) => (
                  <button key={s} type="button" aria-pressed={t.status === s} onClick={() => onUpdate(t.id, { status: s })} className={`${btn} ${t.status === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'}`}>
                    {TASK_STATUS_LABEL[s]}
                  </button>
                ))}
              </span>
              <button
                type="button"
                onClick={() => { if (armed === t.id) { setArmed(null); onRemove(t.id); } else setArmed(t.id); }}
                className={`${btn} bg-white text-gray-800 border-gray-300 hover:bg-gray-50`}
              >
                {armed === t.id ? 'もう一度押すと消えます' : `『${t.title}』を消す`}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return;
          const ok = await onCreate(title, start, end);
          if (ok !== false) { setTitle(''); setStart(''); setEnd(''); }
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-gray-700">
          日常の ToDo
          <input type="text" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          開始
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          終了
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={input} />
        </label>
        <button type="submit" className={`${btn} bg-blue-600 text-white border-blue-600 hover:bg-blue-700`}>足す</button>
      </form>
      <div role="status">{problem && <p className="p-2 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-sm">{problem}</p>}</div>
    </section>
  );
}

// --- 右の列の「📅 カレンダー」(アプリ内・全プロジェクト) ---

type ScheduledTodo = { itemId: string; projectName: string; title: string; dueDate: string; status: ItemStatus; start: string; end: string };

/** 月の表の範囲 (表に出る最初と最後の日)。 */
export function gridRange(date: string): { from: string; to: string } {
  const g = monthGrid(date);
  return { from: g[0][0].date, to: g[g.length - 1][6].date };
}

/** その日の予定 (全プロジェクトの ToDo + 日常のタスク) をタイムスケジュールの形に。 */
export function daySchedule(todos: ScheduledTodo[], tasks: DailyTask[], day: string): ScheduleItem[] {
  return [
    ...todos.filter((t) => t.dueDate === day).map((t) => ({ key: `i-${t.itemId}`, title: t.title, start: t.start, end: t.end, badge: `[${t.projectName}]`, status: STATUS_LABEL[t.status] })),
    ...tasks.filter((t) => t.day === day).map((t) => ({ key: `t-${t.id}`, title: t.title, start: t.start, end: t.end, badge: '[日常]', status: TASK_STATUS_LABEL[t.status] })),
  ];
}

export function AppCalendarView({ today, date, todos, tasks, problem, onChange }: {
  today: string;
  date: string;
  todos: ScheduledTodo[];
  tasks: DailyTask[];
  problem: string | null;
  onChange(date: string): void;
}) {
  const grid = monthGrid(date);
  return (
    <section aria-labelledby="app-calendar-heading" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 id="app-calendar-heading" className="text-lg font-bold text-blue-700">
          <span aria-hidden="true">📅</span> {date.slice(0, 4)}年{Number(date.slice(5, 7))}月
        </h2>
        <div className="ml-auto flex gap-1">
          <button type="button" aria-label="前の月" onClick={() => onChange(addMonths(date, -1))} className={`${btn} bg-white text-gray-800 border-gray-300`}><span aria-hidden="true">◀</span></button>
          <button type="button" onClick={() => onChange(today)} className={`${btn} bg-white text-gray-800 border-gray-300`}>今日</button>
          <button type="button" aria-label="次の月" onClick={() => onChange(addMonths(date, 1))} className={`${btn} bg-white text-gray-800 border-gray-300`}><span aria-hidden="true">▶</span></button>
        </div>
      </div>
      <p className="text-xs text-gray-600">数は その日の予定の数 (すべてのプロジェクトの ToDo と日常の ToDo)</p>
      <table className="w-full table-fixed border-separate border-spacing-1">
        <caption className="sr-only">日付を選ぶと、その日のタイムスケジュールが下に出ます</caption>
        <thead>
          <tr>{WEEKDAY_LABEL.map((w) => <th key={w} scope="col" className="text-xs font-bold text-gray-700">{w}</th>)}</tr>
        </thead>
        <tbody>
          {grid.map((row) => (
            <tr key={row[0].date}>
              {row.map(({ date: d, inMonth }) => {
                const n = daySchedule(todos, tasks, d).length;
                const selected = d === date;
                return (
                  <td key={d} className="align-top">
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-current={d === today ? 'date' : undefined}
                      onClick={() => onChange(d)}
                      className={`w-full min-h-10 rounded-md p-1 text-left text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${selected ? 'border-2 border-blue-600 bg-blue-50' : d === today ? 'border-2 border-gray-500 bg-white' : 'border border-gray-200 bg-white'} ${inMonth ? 'text-gray-900' : 'text-gray-500'}`}
                    >
                      <span aria-hidden="true" className="block font-bold">{Number(d.slice(8, 10))}</span>
                      {n > 0 && <span aria-hidden="true" className="block">{n}</span>}
                      <span className="sr-only">{`${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日 (${WEEKDAY_LABEL[weekdayIndex(d)]})${d === today ? ' 今日' : ''}、予定 ${n}`}</span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div role="status">{problem && <p className="p-2 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-sm">{problem}</p>}</div>
      <TimeSchedule
        items={daySchedule(todos, tasks, date)}
        headingId="app-calendar-day-heading"
        label={`🕘 ${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日 (${WEEKDAY_LABEL[weekdayIndex(date)]}) のタイムスケジュール`}
      />
    </section>
  );
}

/** 右の列のカレンダー (読み込みつき)。 */
export function AppCalendar({ today }: { today: string }) {
  const [date, setDate] = useState(today);
  const { from, to } = gridRange(date);
  const { tasks, problem: taskProblem } = useTasks(from, to);
  const [todos, setTodos] = useState<ScheduledTodo[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/items/schedule?from=${from}&to=${to}`);
        const body: unknown = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) return setProblem('予定を読み込めませんでした');
        const list = (body as { todos?: unknown } | null)?.todos;
        setTodos(Array.isArray(list) ? (list as ScheduledTodo[]) : []);
        setProblem(null);
      } catch {
        if (!cancelled) setProblem('予定を読み込めませんでした');
      }
    })();
    return () => { cancelled = true; };
  }, [from, to]);
  return <AppCalendarView today={today} date={date} todos={todos} tasks={tasks} problem={problem ?? taskProblem} onChange={setDate} />;
}

