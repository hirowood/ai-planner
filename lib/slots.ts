// --- 時間割 (EXP-039・040) ---
// ToDo と日常のタスクの時刻 (開始・終了 "HH:MM")。アプリの中の予定表で使う (Google カレンダーは後で)。純粋な関数だけ。

export type Slot = { start: string; end: string };
export type ItemSlot = { itemId: string; start: string; end: string };

const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** 時刻の入力。両方 HH:MM で end > start → 時刻・両方 "" (か無い) → "clear" (外す)・それ以外 → null。 */
export function parseSlot(x: unknown): Slot | "clear" | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  const s = r.start === undefined || r.start === null ? "" : r.start;
  const e = r.end === undefined || r.end === null ? "" : r.end;
  if (typeof s !== "string" || typeof e !== "string") return null;
  if (s === "" && e === "") return "clear";
  if (!HM_RE.test(s) || !HM_RE.test(e) || minutes(e) <= minutes(s)) return null;
  return { start: s, end: e };
}

/** 「09:00〜09:30」。 */
export function slotLabel(start: string, end: string): string {
  return `${start}〜${end}`;
}

export type TimetableEntry<T> = { key: string; start: string; end: string; value: T };

/** 時刻のあるものを開始の早い順 (同じなら終了の早い順)・時刻の無いものは別に (元の順のまま)。 */
export function timetable<T>(entries: TimetableEntry<T>[]): { timed: TimetableEntry<T>[]; untimed: TimetableEntry<T>[] } {
  const timed = entries
    .filter((e) => HM_RE.test(e.start) && HM_RE.test(e.end))
    .sort((a, b) => (a.start !== b.start ? (a.start < b.start ? -1 : 1) : a.end < b.end ? -1 : a.end > b.end ? 1 : 0));
  const untimed = entries.filter((e) => !(HM_RE.test(e.start) && HM_RE.test(e.end)));
  return { timed, untimed };
}

/** 画面で使う: サーバの一覧の形を検査する。 */
export function parseItemSlots(x: unknown): ItemSlot[] {
  if (!Array.isArray(x)) return [];
  return x.flatMap((r) => {
    if (typeof r !== "object" || r === null) return [];
    const o = r as Record<string, unknown>;
    if (typeof o.itemId !== "string" || typeof o.start !== "string" || typeof o.end !== "string") return [];
    if (!HM_RE.test(o.start) || !HM_RE.test(o.end)) return [];
    return [{ itemId: o.itemId, start: o.start, end: o.end }];
  });
}
