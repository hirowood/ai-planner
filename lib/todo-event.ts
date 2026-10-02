// --- ToDo を予定 (Google カレンダー) に入れる (EXP-030) ---
// 純粋な関数だけ。予定の件名と説明は、画面からではなくサーバが項目から作る。

import type { PlanItem } from "./plan-items";

export type TimeRange = { allDay: true } | { allDay: false; start: string; end: string };
export type ItemEvent = { itemId: string; start: string; end: string }; // 終日は start・end が ""
export type GoogleEventInput = {
  summary: string;
  description: string;
  start: { date: string } | { dateTime: string };
  end: { date: string } | { dateTime: string };
};

export const TODO_EVENT_DESCRIPTION = "ai-planner の ToDo";
export const UPCOMING_DAYS = 7;

const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const minutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** 時刻の入力。start・end が両方無ければ終日・両方 HH:MM で end > start なら時刻つき・それ以外は null。 */
export function parseTimeRange(x: unknown): TimeRange | null {
  if (x === undefined || x === null) return { allDay: true };
  if (typeof x !== "object" || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  const s = r.start === undefined || r.start === "" ? null : r.start;
  const e = r.end === undefined || r.end === "" ? null : r.end;
  if (s === null && e === null) return { allDay: true };
  if (typeof s !== "string" || typeof e !== "string" || !HM_RE.test(s) || !HM_RE.test(e)) return null;
  if (minutes(e) <= minutes(s)) return null;
  return { allDay: false, start: s, end: e };
}

function nextDay(ymd: string): string {
  const m = YMD_RE.exec(ymd);
  if (!m) return ymd;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
  return t.toISOString().slice(0, 10);
}

/** ToDo から Google の予定を作る。終日は期日〜翌日 (Google の終日の end は含まない日)。期日が無ければ null。 */
export function todoToEvent(item: Pick<PlanItem, "title" | "dueDate">, range: TimeRange): GoogleEventInput | null {
  if (!YMD_RE.test(item.dueDate)) return null;
  const summary = `✅ ${item.title}`;
  if (range.allDay) {
    return { summary, description: TODO_EVENT_DESCRIPTION, start: { date: item.dueDate }, end: { date: nextDay(item.dueDate) } };
  }
  return {
    summary,
    description: TODO_EVENT_DESCRIPTION,
    start: { dateTime: `${item.dueDate}T${range.start}:00+09:00` },
    end: { dateTime: `${item.dueDate}T${range.end}:00+09:00` },
  };
}

/** 期日が今日〜days 日先の ToDo (期日の早い順・同じ日は作った順)。 */
export function upcomingTodos(items: PlanItem[], today: string, days: number = UPCOMING_DAYS): PlanItem[] {
  const last = (() => {
    let d = today;
    for (let i = 0; i < days; i++) d = nextDay(d);
    return d;
  })();
  return items
    .filter((i) => i.level === "todo" && YMD_RE.test(i.dueDate) && i.dueDate >= today && i.dueDate <= last)
    .sort((a, b) => (a.dueDate !== b.dueDate ? (a.dueDate < b.dueDate ? -1 : 1) : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/** 予定の印の文。「📅 予定 09:00〜09:30」/「📅 予定 (終日)」。 */
export function eventLabel(e: ItemEvent): string {
  return e.start && e.end ? `📅 予定 ${e.start}〜${e.end}` : "📅 予定 (終日)";
}

/** 画面で使う: サーバの一覧の形を検査する。 */
export function parseItemEvents(x: unknown): ItemEvent[] {
  if (!Array.isArray(x)) return [];
  return x.flatMap((r) => {
    if (typeof r !== "object" || r === null) return [];
    const o = r as Record<string, unknown>;
    if (typeof o.itemId !== "string") return [];
    const start = typeof o.start === "string" && HM_RE.test(o.start) ? o.start : "";
    const end = typeof o.end === "string" && HM_RE.test(o.end) ? o.end : "";
    return [{ itemId: o.itemId, start, end }];
  });
}
