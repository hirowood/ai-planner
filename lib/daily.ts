// --- 1 日の記録 (EXP-020) ---
// 夜に その日の〇△×・良かったこと 3 つ・明日はこうする を書く (ほぼ日手帳の PDCA の使い方を参考)。
// 純粋な関数だけ (next や db に依存しない)。

import { neutralize } from "./coach-context";
import { isUuid } from "./projects";
import type { PlanItem } from "./plan-items";

export type DailyMark = "good" | "fair" | "bad";
export type DailyLog = {
  projectId: string;
  day: string; // YYYY-MM-DD (日本時間の日付)
  mark: DailyMark;
  goods: string[];
  tomorrow: string;
  updatedAt: string;
};
export type DailyInput = Omit<DailyLog, "updatedAt">;

export const MARKS: DailyMark[] = ["good", "fair", "bad"];
export const MARK_LABEL: Record<DailyMark, string> = { good: "〇 できた", fair: "△ 少し", bad: "× できなかった" };
export const MARK_SIGN: Record<DailyMark, string> = { good: "〇", fair: "△", bad: "×" };

export const GOODS_MAX = 3;
export const GOOD_CHARS = 100;
export const TOMORROW_CHARS = 200;
/** 書き足せるのは今日から何日前まで (書き忘れた日を後から埋める)。 */
export const BACKFILL_DAYS = 7;
/** 一覧と AI に渡す日数。 */
export const DAILY_LIMIT = 7;
/** 手帳の月の表のために読める最大の日数 (EXP-036)。 */
export const DAILY_DAYS_MAX = 62;
/** 今日の ToDo の目安 (KDI 3 つ × KDI ごとに 3 つ = 1 日 9 つほど・本人・EXP-031)。 */
export const TODAY_TODO_TARGET = 9;

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const len = (s: string) => [...s].length;

/** 実在する日付なら UTC の 0 時のミリ秒、違えば null。 */
function dayMs(s: string): number | null {
  const m = YMD_RE.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? t : null;
}

const isMark = (v: unknown): v is DailyMark => typeof v === "string" && (MARKS as string[]).includes(v);

/** 保存の入力。day は today から 7 日前まで (未来は不可)。通らなければ null (切り詰めずに弾く)。 */
export function parseDailyInput(x: unknown, today: string): DailyInput | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  if (!isUuid(r.projectId)) return null;
  if (typeof r.day !== "string") return null;
  const d = dayMs(r.day);
  const t = dayMs(today);
  if (d === null || t === null) return null;
  if (d > t || t - d > BACKFILL_DAYS * 86_400_000) return null;
  if (!isMark(r.mark)) return null;

  let goods: string[] = [];
  if (r.goods !== undefined) {
    if (!Array.isArray(r.goods)) return null;
    for (const g of r.goods) {
      if (typeof g !== "string") return null;
      const v = g.trim();
      if (v === "") continue;
      if (len(v) > GOOD_CHARS) return null;
      goods.push(v);
    }
    goods = goods.slice(0, GOODS_MAX);
  }

  let tomorrow = "";
  if (r.tomorrow !== undefined) {
    if (typeof r.tomorrow !== "string") return null;
    tomorrow = r.tomorrow.trim();
    if (len(tomorrow) > TOMORROW_CHARS) return null;
  }
  return { projectId: r.projectId, day: r.day, mark: r.mark, goods, tomorrow };
}

/** 埋まった項目の数 (mark 1 + goods の数 + tomorrow があれば 1・0〜5)。[perf] の fields_filled に使う。 */
export function dailyFilled(d: DailyInput): number {
  return 1 + d.goods.length + (d.tomorrow ? 1 : 0);
}

/** 期日が今日の ToDo (古い順)。 */
export function todayTodos(items: PlanItem[], today: string): PlanItem[] {
  return items
    .filter((i) => i.level === "todo" && i.dueDate === today)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

function cut(s: string, n: number): string {
  const a = [...s.trim().replace(/\s*\n\s*/g, " ")];
  return neutralize(a.length > n ? a.slice(0, n).join("") + "…" : a.join(""));
}

/** AI に渡す最近の記録 (新しい順 7 日まで)。無ければ「(まだ無し)」。 */
export function dailyText(logs: DailyLog[]): string {
  const sorted = [...logs].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0)).slice(0, DAILY_LIMIT);
  if (sorted.length === 0) return "(まだ無し)";
  return sorted
    .map((l) => {
      const parts = [`- ${l.day} ${MARK_SIGN[l.mark] ?? "?"}`];
      if (l.goods.length > 0) parts.push(`良かったこと: ${l.goods.map((g) => cut(g, GOOD_CHARS)).join(" / ")}`);
      if (l.tomorrow) parts.push(`明日は: ${cut(l.tomorrow, GOOD_CHARS)}`);
      return parts.join(" / ");
    })
    .join("\n");
}

/** 画面で使う: サーバの記録の形を検査する。形が違えば null。 */
export function parseDailyLog(x: unknown): DailyLog | null {
  if (typeof x !== "object" || x === null) return null;
  const r = x as Record<string, unknown>;
  if (typeof r.projectId !== "string" || typeof r.day !== "string" || dayMs(r.day) === null || !isMark(r.mark)) return null;
  const goods = Array.isArray(r.goods) ? r.goods.filter((g): g is string => typeof g === "string").slice(0, GOODS_MAX) : [];
  return {
    projectId: r.projectId,
    day: r.day,
    mark: r.mark,
    goods,
    tomorrow: typeof r.tomorrow === "string" ? r.tomorrow : "",
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
  };
}
