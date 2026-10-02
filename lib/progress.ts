// --- 進み具合と期限の要約 (EXP-032) ---
// 判定 (Check) と調整 (Action) を AI と壁打ちするときに渡す。純粋な関数だけ。

import { neutralize } from "./coach-context";
import { STATUS_LABEL, STATUS_ORDER, type ItemStatus, type PlanItem } from "./plan-items";

export const PROGRESS_DAYS = 7;
const TITLE_CHARS = 60;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function dayMs(s: string): number | null {
  const m = YMD_RE.exec(s);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** b - a の日数。どちらかが日付でなければ null。 */
export function daysBetween(a: string, b: string): number | null {
  const x = dayMs(a);
  const y = dayMs(b);
  return x === null || y === null ? null : Math.round((y - x) / 86_400_000);
}

function cut(s: string): string {
  const a = [...s.trim().replace(/\s*\n\s*/g, " ")];
  return neutralize(a.length > TITLE_CHARS ? a.slice(0, TITLE_CHARS).join("") + "…" : a.join(""));
}

function deadline(due: string, today: string): string {
  if (!due) return "期日なし";
  const d = daysBetween(today, due);
  if (d === null) return "期日なし";
  return d >= 0 ? `期日 ${due} (あと ${d} 日)` : `期日 ${due} (${-d} 日過ぎ)`;
}

function byCreated(a: PlanItem, b: PlanItem): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/** AI に渡す進み具合と期限。KGI・KPI の期限、KDI ごとの最近 7 日の ToDo の内訳とできた割合。 */
export function progressText(items: PlanItem[], today: string): string {
  const sorted = [...items].sort(byCreated);
  const kgi = sorted.find((i) => i.level === "kgi");
  if (!kgi) return "(まだ無し)";
  const lines: string[] = [`- KGI: ${cut(kgi.title)} / ${deadline(kgi.dueDate, today)}`];
  const childrenOf = (p: PlanItem) => sorted.filter((i) => i.parentId === p.id);
  for (const kpi of childrenOf(kgi).filter((i) => i.level === "kpi")) {
    const target = kpi.target ? ` / 判定基準 ${cut(kpi.target)}` : "";
    lines.push(`  - KPI: ${cut(kpi.title)}${target} / ${deadline(kpi.dueDate, today)}`);
    for (const kdi of childrenOf(kpi).filter((i) => i.level === "kdi" && i.status !== "shelved")) {
      const recent = childrenOf(kdi).filter((t) => {
        if (t.level !== "todo") return false;
        const d = daysBetween(t.dueDate, today);
        return d !== null && d >= 0 && d < PROGRESS_DAYS;
      });
      const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<ItemStatus, number>;
      for (const t of recent) counts[t.status] += 1;
      const judged = recent.length - counts.todo;
      const doneLike = counts.done + counts.succeeded;
      const rate = judged > 0 ? `できた割合 ${Math.round((doneLike / judged) * 100)}% (${doneLike}/${judged})` : "できた割合 まだ無し";
      const detail = STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => `${STATUS_LABEL[s]} ${counts[s]}`).join("・");
      const crit = kdi.target ? ` / 判定基準 ${cut(kdi.target)}` : "";
      lines.push(`    - KDI: ${cut(kdi.title)}${crit} / 最近 ${PROGRESS_DAYS} 日の ToDo ${recent.length} つ${detail ? ` (${detail})` : ""} / ${rate}`);
    }
  }
  return lines.join("\n");
}

/** 仮説の検査 (EXP-032)。文字列で前後の空白を除いて 1〜300 字なら返す。違えば null。 */
export const HYPOTHESIS_MAX = 300;
export function parseHypothesis(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const t = x.trim();
  const n = [...t].length;
  return n >= 1 && n <= HYPOTHESIS_MAX ? t : null;
}

/** 画面のお知らせ (EXP-032)。 */
export function hypothesisNotice(saved: unknown): string | null {
  return saved === true ? "仮説をノートに残しました" : null;
}

export const HYPOTHESIS_KIND = "仮説";
