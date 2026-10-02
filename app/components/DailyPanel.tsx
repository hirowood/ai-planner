'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GOODS_MAX,
  GOOD_CHARS,
  MARKS,
  MARK_LABEL,
  TODAY_TODO_TARGET,
  TOMORROW_CHARS,
  parseDailyLog,
  todayTodos,
  type DailyLog,
  type DailyMark,
} from '../../lib/daily';
import { STATUS_LABEL, STATUS_ORDER, type ItemPatch, type ItemStatus, type PlanItem } from '../../lib/plan-items';
import { todayJst } from '../../lib/smart';
import { TODO_PER_KDI as TODO_PER_KDI_DAY } from '../../lib/hierarchy-step';

/** 今日の ToDo を親の KDI ごとにまとめる (KDI の古い順・親の無いものは最後) (EXP-031)。 */
export function groupByKdi(todos: PlanItem[], items: PlanItem[]): { key: string; label: string; todos: PlanItem[] }[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out = new Map<string, { key: string; label: string; todos: PlanItem[]; order: string }>();
  for (const t of todos) {
    const kdi = t.parentId ? byId.get(t.parentId) : undefined;
    const key = kdi ? kdi.id : 'none';
    const g = out.get(key) ?? { key, label: kdi ? `KDI: ${kdi.title}` : 'KDI なし', todos: [], order: kdi ? kdi.createdAt : '\uffff' };
    g.todos.push(t);
    out.set(key, g);
  }
  return [...out.values()].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)).map(({ key, label, todos }) => ({ key, label, todos }));
}

// --- 「☀️ 今日」のタブ (EXP-020) ---
// 朝: 今日が期日の ToDo を見る / 夜: 〇△×・良かったこと 3 つ・明日はこうする を書く。

export const ASK_TODAY_TODOS = '今日の ToDo を KDI ごとに 3 つずつ決めたい';
export const ASK_COMMENT = '今日の振り返りを記録しました。ひとことください';

type Draft = { mark: DailyMark | null; goods: string[]; tomorrow: string };
const EMPTY_DRAFT: Draft = { mark: null, goods: ['', '', ''], tomorrow: '' };

function draftFrom(log: DailyLog | undefined): Draft {
  if (!log) return EMPTY_DRAFT;
  const goods = [...log.goods, '', '', ''].slice(0, GOODS_MAX);
  return { mark: log.mark, goods, tomorrow: log.tomorrow };
}

const inputClass =
  'w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-900 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
// 状態の選択は中身の幅だけ取る (w-full を付けない: 題の幅を奪わない)
const selectClass =
  'w-auto shrink-0 px-2 py-2 rounded-lg border border-gray-300 bg-white text-gray-900 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
const buttonClass =
  'px-3 py-2 rounded-lg border font-bold text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

/** 1 日の記録の読み書き。projectId が変わったら読み直す。 */
export function useDaily(projectId: string | null): {
  logs: DailyLog[];
  today: string;
  problem: string | null;
  saving: boolean;
  savedDay: string | null;
  save(day: string, d: { mark: DailyMark; goods: string[]; tomorrow: string }): Promise<boolean>;
} {
  const [data, setData] = useState<{ projectId: string; logs: DailyLog[] } | null>(null);
  const [today, setToday] = useState(() => todayJst());
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedDay, setSavedDay] = useState<string | null>(null);
  const currentId = useRef<string | null>(projectId);

  const load = useCallback(async (pid: string) => {
    try {
      const res = await fetch(`/api/daily?projectId=${encodeURIComponent(pid)}`);
      const body: unknown = await res.json().catch(() => null);
      if (currentId.current !== pid) return;
      if (!res.ok) {
        setProblem('記録を読み込めませんでした');
        setData({ projectId: pid, logs: [] });
        return;
      }
      const raw = (body as { logs?: unknown; today?: unknown } | null) ?? {};
      const logs = Array.isArray(raw.logs) ? raw.logs.map(parseDailyLog).filter((l): l is DailyLog => l !== null) : [];
      if (typeof raw.today === 'string') setToday(raw.today);
      setData({ projectId: pid, logs });
      setProblem(null);
    } catch {
      if (currentId.current === pid) setProblem('記録を読み込めませんでした');
    }
  }, []);

  useEffect(() => {
    currentId.current = projectId;
    setSavedDay(null);
    if (projectId) void load(projectId);
  }, [projectId, load]);

  const save = useCallback(async (day: string, d: { mark: DailyMark; goods: string[]; tomorrow: string }) => {
    const pid = currentId.current;
    if (!pid) return false;
    setSaving(true);
    try {
      const res = await fetch('/api/daily', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: pid, day, mark: d.mark, goods: d.goods, tomorrow: d.tomorrow }),
      });
      if (!res.ok) {
        setProblem(res.status === 400 ? '記録の入力を確かめてください (良かったことは 100 字まで・明日は 200 字まで)' : '記録を保存できませんでした');
        return false;
      }
      await load(pid);
      setSavedDay(day);
      return true;
    } catch {
      setProblem('記録を保存できませんでした');
      return false;
    } finally {
      setSaving(false);
    }
  }, [load]);

  const logs = projectId && data?.projectId === projectId ? data.logs : [];
  return { logs, today, problem, saving, savedDay, save };
}

type ViewProps = {
  today: string;
  items: PlanItem[];
  logs: DailyLog[];
  problem: string | null;
  saving: boolean;
  saved: boolean;
  onUpdateItem(id: string, patch: ItemPatch): void;
  onSave(d: { mark: DailyMark; goods: string[]; tomorrow: string }): void;
  onAsk(text: string): void;
  /** ToDo の id → 予定の印 (EXP-030)。 */
  eventLabels?: Record<string, string>;
};

/** 画面だけ (状態は外から)。描画のテストはこれを使う。 */
export function DailyView({ today, items, logs, problem, saving, saved, onUpdateItem, onSave, onAsk, eventLabels = {} }: ViewProps) {
  const todayLog = logs.find((l) => l.day === today);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(todayLog));
  const [loadedFor, setLoadedFor] = useState<string | null>(todayLog ? `${today}:${todayLog.updatedAt}` : null);
  // 読み込みが後から届いたら、まだ書いていない欄に今日の記録を入れる
  const key = todayLog ? `${today}:${todayLog.updatedAt}` : null;
  if (key !== loadedFor) {
    setLoadedFor(key);
    if (todayLog) setDraft(draftFrom(todayLog));
  }

  const todos = todayTodos(items, today);
  const groups = groupByKdi(todos, items);
  const others = logs.filter((l) => l.day !== today);

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="today-todos-heading" className="flex flex-col gap-3">
        <h3 id="today-todos-heading" className="text-base font-bold text-gray-800">
          <span aria-hidden="true">☀️</span> 今日の ToDo ({today})
        </h3>
        <p className="text-sm text-gray-600">目安: KDI ごとに {TODO_PER_KDI_DAY} つ・1 日 {TODAY_TODO_TARGET} つほど (今 {todos.length} つ)</p>
        {todos.length === 0 && (
          <p className="text-sm text-gray-700">今日が期日の ToDo はまだありません。会話で KDI から今日の ToDo を決めましょう。</p>
        )}
        {groups.map((g) => (
          <div key={g.key} className="flex flex-col gap-2">
            <h4 className="text-sm font-bold text-gray-700">{g.label}</h4>
            <ul className="flex flex-col gap-2">
              {g.todos.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 break-words text-sm text-gray-900">
                    {t.title}
                    {eventLabels[t.id] && <span className="ml-2 text-green-800">{eventLabels[t.id]}</span>}
                    {t.target && <span className="block text-gray-600">判定基準: {t.target}</span>}
                  </span>
                  <select
                    aria-label={`『${t.title}』の状態`}
                    value={t.status}
                    onChange={(e) => onUpdateItem(t.id, { status: e.target.value as ItemStatus })}
                    className={selectClass}
                  >
                    {STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {todos.length < TODAY_TODO_TARGET && (
          <button type="button" onClick={() => onAsk(ASK_TODAY_TODOS)} className={`${buttonClass} self-start bg-white text-blue-700 border-blue-300 hover:bg-blue-50`}>
            {ASK_TODAY_TODOS}
          </button>
        )}
        {todos.length > TODAY_TODO_TARGET && (
          <p className="text-sm text-amber-900">今日の ToDo が {todos.length} つあります。{TODAY_TODO_TARGET} つほどに絞ると回しやすいです。</p>
        )}
      </section>

      <section aria-labelledby="today-check-heading" className="flex flex-col gap-3">
        <h3 id="today-check-heading" className="text-base font-bold text-gray-800">
          <span aria-hidden="true">🌙</span> 今日の振り返り
        </h3>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            // 押せない状態でもフォーカスは残す (aria-disabled)。ここで止める (a11y レビュー)
            if (!draft.mark || saving) return;
            onSave({ mark: draft.mark, goods: draft.goods, tomorrow: draft.tomorrow });
          }}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-bold text-gray-800">今日はどうでしたか？</legend>
            <div className="flex gap-2">
              {MARKS.map((m) => (
                <label key={m} className={`${buttonClass} relative flex-1 text-center cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 ${draft.mark === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'}`}>
                  <input
                    type="radio"
                    name="daily-mark"
                    value={m}
                    checked={draft.mark === m}
                    onChange={() => setDraft((d) => ({ ...d, mark: m }))}
                    required
                    className="sr-only"
                  />
                  {MARK_LABEL[m]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-bold text-gray-800">良かったこと (3 つまで)</legend>
            {draft.goods.map((g, i) => (
              <input
                key={i}
                type="text"
                aria-label={`良かったこと ${i + 1}`}
                maxLength={GOOD_CHARS}
                value={g}
                onChange={(e) => setDraft((d) => ({ ...d, goods: d.goods.map((x, j) => (j === i ? e.target.value : x)) }))}
                className={inputClass}
              />
            ))}
          </fieldset>
          <label className="flex flex-col gap-1 text-sm font-bold text-gray-800">
            明日はこうする
            <input
              type="text"
              maxLength={TOMORROW_CHARS}
              value={draft.tomorrow}
              onChange={(e) => setDraft((d) => ({ ...d, tomorrow: e.target.value }))}
              className={inputClass}
            />
          </label>
          <button
            type="submit"
            aria-disabled={!draft.mark || saving}
            aria-describedby={!draft.mark ? 'daily-save-hint' : undefined}
            className={`${buttonClass} ${!draft.mark || saving ? 'bg-gray-300 border-gray-300 text-gray-600 cursor-not-allowed' : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'}`}
          >
            {saving ? '保存中…' : todayLog ? '今日の記録を上書きする' : '今日の記録を保存する'}
          </button>
          {!draft.mark && <p id="daily-save-hint" className="text-sm text-gray-600">〇△× を選ぶと保存できます</p>}
        </form>
        <div role="status" className="flex flex-col gap-2">
          {problem && <p className="p-3 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-sm">{problem}</p>}
          {saved && !problem && (
            <>
              <p className="text-sm text-gray-700">今日の記録を保存しました</p>
              <button type="button" onClick={() => onAsk(ASK_COMMENT)} className={`${buttonClass} self-start bg-white text-blue-700 border-blue-300 hover:bg-blue-50`}>
                AI にひとことをもらう
              </button>
            </>
          )}
        </div>
      </section>

      <section aria-labelledby="recent-days-heading" className="flex flex-col gap-2">
        <h3 id="recent-days-heading" className="text-base font-bold text-gray-800">最近の記録</h3>
        {others.length === 0 && !todayLog ? (
          <p className="text-sm text-gray-700">まだ記録がありません</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm text-gray-800">
            {logs.map((l) => (
              <li key={l.day}>
                {l.day} {MARK_LABEL[l.mark]}・良かったこと {l.goods.length} つ
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
