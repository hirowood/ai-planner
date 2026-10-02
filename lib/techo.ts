// --- 電子手帳 (EXP-036) ---
// 日・週・月の見開きと、これまでのデータの集計。純粋な関数だけ (日付は "YYYY-MM-DD" の日本時間の日付)。

import type { DailyLog, DailyMark } from "./daily";
import type { ItemStatus, PlanItem } from "./plan-items";
import { daysBetween } from "./progress";
import { HYPOTHESIS_KIND } from "./progress";

export type TechoMode = "day" | "week" | "month";
export const WEEKDAY_LABEL = ["月", "火", "水", "木", "金", "土", "日"] as const;

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toUtc(ymd: string): Date | null {
  const m = YMD_RE.exec(ymd);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}
const fmt = (d: Date) => d.toISOString().slice(0, 10);

/** n 日後 (負なら前)。日付でなければそのまま。 */
export function addDays(ymd: string, n: number): string {
  const d = toUtc(ymd);
  if (!d) return ymd;
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

/** n か月後の同じ日 (無ければその月の末日)。 */
export function addMonths(ymd: string, n: number): string {
  const d = toUtc(ymd);
  if (!d) return ymd;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return fmt(new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last))));
}

/** 月曜を 0 とした曜日の番号。 */
export function weekdayIndex(ymd: string): number {
  const d = toUtc(ymd);
  return d ? (d.getUTCDay() + 6) % 7 : 0;
}

/** その日を含む月曜はじまりの 7 日。 */
export function weekDates(ymd: string): string[] {
  const start = addDays(ymd, -weekdayIndex(ymd));
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** 月曜はじまりの月の表。前後の月の日も含めて 7 日ずつの行。 */
export function monthGrid(ymd: string): { date: string; inMonth: boolean }[][] {
  const month = ymd.slice(0, 7);
  const first = `${month}-01`;
  const last = addDays(addMonths(first, 1), -1);
  let cur = addDays(first, -weekdayIndex(first));
  const end = addDays(last, 6 - weekdayIndex(last));
  const rows: { date: string; inMonth: boolean }[][] = [];
  while (cur <= end) {
    const row = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(cur, i);
      return { date, inMonth: date.slice(0, 7) === month };
    });
    rows.push(row);
    cur = addDays(cur, 7);
  }
  return rows;
}

export type DayInfo = {
  todos: PlanItem[];
  counts: Record<ItemStatus, number>;
  doneCount: number; // 実行 + 成功
  mark: DailyMark | null;
};

const ZERO: Record<ItemStatus, number> = { todo: 0, doing: 0, done: 0, shelved: 0, failed: 0, succeeded: 0, adjusted: 0 };

/** その日が期日の ToDo・状態の数・1 日の記録の〇△×。 */
export function dayInfo(items: PlanItem[], logs: DailyLog[], date: string): DayInfo {
  const todos = items
    .filter((i) => i.level === "todo" && i.dueDate === date)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const counts = { ...ZERO };
  for (const t of todos) counts[t.status] += 1;
  const log = logs.find((l) => l.day === date);
  return { todos, counts, doneCount: counts.done + counts.succeeded, mark: log ? log.mark : null };
}

function rate(items: PlanItem[], today: string, days: number): { done: number; judged: number } | null {
  let done = 0;
  let judged = 0;
  for (const i of items) {
    if (i.level !== "todo") continue;
    const d = daysBetween(i.dueDate, today);
    if (d === null || d < 0 || d >= days) continue;
    if (i.status === "done" || i.status === "succeeded") done += 1;
    if (i.status === "done" || i.status === "succeeded" || i.status === "failed") judged += 1;
  }
  return judged > 0 ? { done, judged } : null;
}

export type TechoStats = {
  totals: { succeeded: number; done: number; failed: number; adjusted: number; shelved: number };
  rate7: { done: number; judged: number } | null;
  rate30: { done: number; judged: number } | null;
  loggedDays30: number;
  streak: number;
  kgi: { title: string; dueDate: string; daysLeft: number | null } | null;
  kpis: { title: string; target: string; dueDate: string }[];
  recentJudged: { title: string; status: ItemStatus; dueDate: string }[];
  hypotheses: { body: string; createdAt: string }[];
};

/** これまでのデータ: 達成・できた割合・記録・進捗・AI の評価。 */
export function techoStats(
  items: PlanItem[],
  logs: DailyLog[],
  notes: { kind: string; body: string; createdAt: string }[],
  today: string,
): TechoStats {
  const todos = items.filter((i) => i.level === "todo");
  const count = (s: ItemStatus) => todos.filter((t) => t.status === s).length;
  const logged = new Set(logs.map((l) => l.day));
  const loggedDays30 = [...logged].filter((d) => {
    const n = daysBetween(d, today);
    return n !== null && n >= 0 && n < 30;
  }).length;
  // 今日が無ければ昨日から数える (今日の記録はまだ書いていないことが多い)
  let cursor = logged.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (logged.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  const kgiItem = items.find((i) => i.level === "kgi");
  const kgi = kgiItem
    ? { title: kgiItem.title, dueDate: kgiItem.dueDate, daysLeft: kgiItem.dueDate ? daysBetween(today, kgiItem.dueDate) : null }
    : null;
  const kpis = kgiItem
    ? items.filter((i) => i.level === "kpi" && i.parentId === kgiItem.id).map((k) => ({ title: k.title, target: k.target, dueDate: k.dueDate }))
    : [];
  const recentJudged = todos
    .filter((t) => t.status === "succeeded" || t.status === "failed" || t.status === "adjusted")
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .slice(0, 5)
    .map((t) => ({ title: t.title, status: t.status, dueDate: t.dueDate }));
  const hypotheses = notes
    .filter((n) => n.kind === HYPOTHESIS_KIND)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, 3)
    .map((n) => ({ body: n.body, createdAt: n.createdAt }));
  return {
    totals: { succeeded: count("succeeded"), done: count("done"), failed: count("failed"), adjusted: count("adjusted"), shelved: count("shelved") },
    rate7: rate(items, today, 7),
    rate30: rate(items, today, 30),
    loggedDays30,
    streak,
    kgi,
    kpis,
    recentJudged,
    hypotheses,
  };
}

/** 期間の見出し: 日「10月2日 (木)」・週「9月28日〜10月4日」・月「2026年10月」。 */
export function periodLabel(mode: TechoMode, date: string): string {
  const md = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
  if (mode === "day") return `${md(date)} (${WEEKDAY_LABEL[weekdayIndex(date)]})`;
  if (mode === "week") {
    const w = weekDates(date);
    return `${md(w[0])}〜${md(w[6])}`;
  }
  return `${date.slice(0, 4)}年${Number(date.slice(5, 7))}月`;
}

/** 前 / 次へ動く: 日は 1 日・週は 7 日・月は 1 か月。 */
export function shiftDate(mode: TechoMode, date: string, dir: 1 | -1): string {
  if (mode === "day") return addDays(date, dir);
  if (mode === "week") return addDays(date, 7 * dir);
  return addMonths(date, dir);
}
