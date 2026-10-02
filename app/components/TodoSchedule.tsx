'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { eventLabel, parseItemEvents, upcomingTodos, type ItemEvent } from '../../lib/todo-event';
import type { PlanItem } from '../../lib/plan-items';

// --- 「📅 予定に入れる ToDo」(EXP-030) ---
// 今日から 7 日先までの ToDo を、時刻 (空なら終日) を選んで Google カレンダーに入れる。

const inputClass =
  'px-2 py-1 rounded-lg border border-gray-300 bg-white text-gray-900 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
const buttonClass =
  'px-3 py-1 rounded-lg border font-bold text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

/** プロジェクトの ToDo の予定の読み書き。 */
export function useItemEvents(projectId: string | null): {
  events: ItemEvent[];
  busyId: string | null;
  problem: string | null;
  done: string | null;
  schedule(item: PlanItem, start: string, end: string): Promise<void>;
} {
  const [data, setData] = useState<{ projectId: string; events: ItemEvent[] } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const currentId = useRef<string | null>(projectId);

  const load = useCallback(async (pid: string) => {
    try {
      const res = await fetch(`/api/items/events?projectId=${encodeURIComponent(pid)}`);
      const body: unknown = await res.json().catch(() => null);
      if (currentId.current !== pid) return;
      if (!res.ok) {
        setProblem('予定の一覧を読み込めませんでした');
        return;
      }
      setData({ projectId: pid, events: parseItemEvents((body as { events?: unknown } | null)?.events) });
    } catch {
      if (currentId.current === pid) setProblem('予定の一覧を読み込めませんでした');
    }
  }, []);

  useEffect(() => {
    currentId.current = projectId;
    setProblem(null);
    setDone(null);
    if (projectId) void load(projectId);
  }, [projectId, load]);

  const schedule = useCallback(async (item: PlanItem, start: string, end: string) => {
    const pid = currentId.current;
    if (!pid) return;
    setBusyId(item.id);
    setProblem(null);
    setDone(null);
    try {
      const res = await fetch(`/api/items/${encodeURIComponent(item.id)}/calendar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(start || end ? { start, end } : {}),
      });
      const body: unknown = await res.json().catch(() => null);
      if (currentId.current !== pid) return;
      if (!res.ok) {
        const error = (body as { error?: unknown } | null)?.error;
        setProblem(typeof error === 'string' ? error : '予定を作れませんでした');
        if (res.status === 409) await load(pid);
        return;
      }
      setDone(`『${item.title}』を予定に入れました`);
      await load(pid);
    } catch {
      setProblem('予定を作れませんでした');
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const events = projectId && data?.projectId === projectId ? data.events : [];
  return { events, busyId, problem, done, schedule };
}

type ViewProps = {
  today: string;
  items: PlanItem[];
  events: ItemEvent[];
  busyId: string | null;
  problem: string | null;
  done: string | null;
  onSchedule(item: PlanItem, start: string, end: string): void;
};

function Row({ item, event, busy, onSchedule }: { item: PlanItem; event: ItemEvent | undefined; busy: boolean; onSchedule: ViewProps['onSchedule'] }) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  // 押した後に入力欄が印に置き換わるので、フォーカスを印へ移す (a11y レビュー)
  const askedRef = useRef(false);
  const badgeRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (askedRef.current && event) {
      badgeRef.current?.focus();
      askedRef.current = false;
    }
  }, [event]);
  return (
    <li className="flex flex-col gap-2 p-2 rounded-lg border border-gray-200 bg-white">
      <span className="text-sm text-gray-900">
        <span className="text-gray-600">{item.dueDate}</span> {item.title}
      </span>
      {event ? (
        <span ref={badgeRef} tabIndex={-1} className="text-sm text-green-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
          {eventLabel(event)}
        </span>
      ) : (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            // 入れている間も押したボタンのフォーカスは残す (aria-disabled)。ここで止める
            if (busy) return;
            askedRef.current = true;
            onSchedule(item, start, end);
          }}
        >
          <input type="time" aria-label={`『${item.title}』の開始`} value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
          <span aria-hidden="true">〜</span>
          <input type="time" aria-label={`『${item.title}』の終了`} value={end} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
          <button
            type="submit"
            aria-disabled={busy}
            aria-busy={busy}
            aria-label={`『${item.title}』を予定に入れる`}
            className={`${buttonClass} ${busy ? 'bg-gray-300 border-gray-300 text-gray-600 cursor-wait' : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'}`}
          >
            {busy ? '入れています…' : '予定に入れる'}
          </button>
        </form>
      )}
    </li>
  );
}

/** 画面だけ (状態は外から)。 */
export function TodoScheduleView({ today, items, events, busyId, problem, done, onSchedule }: ViewProps) {
  const todos = upcomingTodos(items, today);
  const byItem = new Map(events.map((e) => [e.itemId, e]));
  return (
    <section aria-labelledby="todo-schedule-heading" className="flex flex-col gap-3">
      <h3 id="todo-schedule-heading" className="text-base font-bold text-gray-800">
        <span aria-hidden="true">📅</span> 予定に入れる ToDo (7 日先まで)
      </h3>
      {todos.length === 0 ? (
        <p className="text-sm text-gray-700">7 日先までの ToDo はまだありません</p>
      ) : (
        <>
          <p className="text-sm text-gray-600">時刻を空のままにすると終日の予定になります</p>
          <ul className="flex flex-col gap-2">
            {todos.map((t) => (
              <Row key={t.id} item={t} event={byItem.get(t.id)} busy={busyId === t.id} onSchedule={onSchedule} />
            ))}
          </ul>
        </>
      )}
      <div role="status">
        {problem && <p className="p-3 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-sm">{problem}</p>}
        {!problem && done && <p className="text-sm text-gray-700">{done}</p>}
      </div>
    </section>
  );
}
