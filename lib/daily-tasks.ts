// --- 日常のタスク (EXP-040) ---
// プロジェクトに属さない ToDo (買い物・通院など)。手帳の日のページと時間割に出す。純粋な関数だけ。

import { daysBetween } from "./progress";
import { parseSlot } from "./slots";

export type TaskStatus = "todo" | "doing" | "done";
export const TASK_STATUSES: TaskStatus[] = ["todo", "doing", "done"];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = { todo: "未実行", doing: "実行中", done: "完了" };
export type DailyTask = { id: string; day: string; title: string; start: string; end: string; status: TaskStatus; createdAt: string };
export type TaskInput = { day: string; title: string; start: string; end: string; status: TaskStatus };
export type TaskPatch = Partial<Pick<TaskInput, "title" | "start" | "end" | "status">>;

export const TASK_TITLE_MAX = 100;
/** 作れる日: 過去 7 日〜未来 62 日。 */
export const TASK_PAST_DAYS = 7;
export const TASK_FUTURE_DAYS = 62;

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CONTROL_RE = /\p{Cc}/u;

function isRealDate(s: string): boolean {
  const m = YMD_RE.exec(s);
  if (!m) return false;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return t.getUTCFullYear() === Number(m[1]) && t.getUTCMonth() === Number(m[2]) - 1 && t.getUTCDate() === Number(m[3]);
}

function title(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  const n = [...t].length;
  return n >= 1 && n <= TASK_TITLE_MAX && !CONTROL_RE.test(t) ? t : null;
}

const isStatus = (v: unknown): v is TaskStatus => typeof v === "string" && (TASK_STATUSES as string[]).includes(v);

/** 日常のタスクを作る入力。通らなければ null。 */
export function parseTaskInput(x: unknown, today: string): TaskInput | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  if (typeof r.day !== "string" || !isRealDate(r.day)) return null;
  const ago = daysBetween(r.day, today);
  if (ago === null || ago > TASK_PAST_DAYS || -ago > TASK_FUTURE_DAYS) return null;
  const t = title(r.title);
  if (!t) return null;
  const slot = parseSlot({ start: r.start ?? "", end: r.end ?? "" });
  if (slot === null) return null;
  let status: TaskStatus = "todo";
  if (r.status !== undefined) {
    if (!isStatus(r.status)) return null;
    status = r.status;
  }
  return { day: r.day, title: t, start: slot === "clear" ? "" : slot.start, end: slot === "clear" ? "" : slot.end, status };
}

/** 変える入力: title / status / 時刻 (start と end の組) のどれか 1 つ以上。 */
export function parseTaskPatch(x: unknown): TaskPatch | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  const out: TaskPatch = {};
  if (r.title !== undefined) {
    const t = title(r.title);
    if (!t) return null;
    out.title = t;
  }
  if (r.status !== undefined) {
    if (!isStatus(r.status)) return null;
    out.status = r.status;
  }
  if (r.start !== undefined || r.end !== undefined) {
    const slot = parseSlot({ start: r.start ?? "", end: r.end ?? "" });
    if (slot === null) return null;
    out.start = slot === "clear" ? "" : slot.start;
    out.end = slot === "clear" ? "" : slot.end;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** 画面で使う: サーバの一覧の形を検査する。 */
export function parseTaskList(x: unknown): DailyTask[] {
  if (!Array.isArray(x)) return [];
  return x.flatMap((r) => {
    if (typeof r !== "object" || r === null) return [];
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.day !== "string" || typeof o.title !== "string" || !isStatus(o.status)) return [];
    return [{
      id: o.id, day: o.day, title: o.title,
      start: typeof o.start === "string" ? o.start : "", end: typeof o.end === "string" ? o.end : "",
      status: o.status, createdAt: typeof o.createdAt === "string" ? o.createdAt : "",
    }];
  });
}

/** AI に渡す今日の日常の予定 (時刻順)。無ければ「(まだ無し)」。 */
export function tasksText(tasks: DailyTask[], neutralize: (s: string) => string): string {
  if (tasks.length === 0) return "(まだ無し)";
  return [...tasks]
    .sort((a, b) => (a.start || "99") < (b.start || "99") ? -1 : (a.start || "99") > (b.start || "99") ? 1 : 0)
    .map((t) => `- ${t.start && t.end ? `${t.start}〜${t.end}` : "時刻なし"} ${neutralize([...t.title].slice(0, 60).join(""))} [${TASK_STATUS_LABEL[t.status]}]`)
    .join("\n");
}
