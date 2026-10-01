// --- 階層の「次に決める段」(EXP-019) ---
// KGI → KPI → KDI → ToDo を 1 段ずつ決める。AI が決まった項目を足すとき、段と親はここで決める (AI の言う親は使わない)。

import { neutralize } from "./coach-context";
import { STATUS_LABEL, parseItemInput, type ItemInput, type ItemLevel, type PlanItem } from "./plan-items";

export type HierarchyStep = { level: "kgi" } | { level: Exclude<ItemLevel, "kgi">; parent: PlanItem };

export const PROPOSED_MAX = 3;
export const SHORT_LABEL: Record<ItemLevel, string> = { kgi: "KGI", kpi: "KPI", kdi: "KDI", todo: "ToDo" };
export const HIERARCHY_LINES_MAX = 40;
export const HIERARCHY_TITLE_CHARS = 60;

function byCreated(a: PlanItem, b: PlanItem): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 次に決める段。KGI が無い → kgi・子の無い一番古い項目を上から順に探す・全部ある → null。 */
export function nextHierarchyStep(items: PlanItem[]): HierarchyStep | null {
  const sorted = [...items].sort(byCreated);
  const kgi = sorted.find((i) => i.level === "kgi");
  if (!kgi) return { level: "kgi" };
  const childrenOf = (p: PlanItem) => sorted.filter((i) => i.parentId === p.id);
  const kpis = childrenOf(kgi).filter((i) => i.level === "kpi");
  if (kpis.length === 0) return { level: "kpi", parent: kgi };
  for (const kpi of kpis) {
    if (!childrenOf(kpi).some((i) => i.level === "kdi")) return { level: "kdi", parent: kpi };
  }
  for (const kpi of kpis) {
    for (const kdi of childrenOf(kpi).filter((i) => i.level === "kdi")) {
      if (!childrenOf(kdi).some((i) => i.level === "todo")) return { level: "todo", parent: kdi };
    }
  }
  return null;
}

function cut(s: string, n: number): string {
  const a = [...s];
  return a.length > n ? a.slice(0, n).join("") + "…" : s;
}

/** AI に渡す階層の要約。字下げした 1 行ずつ・40 行まで・無ければ「(まだ無し)」。 */
export function hierarchyText(items: PlanItem[]): string {
  if (items.length === 0) return "(まだ無し)";
  const sorted = [...items].sort(byCreated);
  const lines: string[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const i of sorted.filter((x) => x.parentId === parentId)) {
      if (lines.length >= HIERARCHY_LINES_MAX) return;
      const parts = [`${"  ".repeat(depth)}- ${SHORT_LABEL[i.level]}: ${neutralize(cut(i.title, HIERARCHY_TITLE_CHARS))}`];
      if (i.target) parts.push(`目標値 ${neutralize(cut(i.target, HIERARCHY_TITLE_CHARS))}`);
      if (i.dueDate) parts.push(`期日 ${i.dueDate}`);
      parts.push(STATUS_LABEL[i.status]);
      lines.push(parts.join(" / "));
      walk(i.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines.join("\n");
}

/** サーバの itemsAdded から画面のお知らせを作る。無い・形が違えば null。例「階層に KPI『…』を足しました」。 */
export function itemsAddedNotice(x: unknown): string | null {
  if (!Array.isArray(x)) return null;
  const parts: string[] = [];
  for (const raw of x.slice(0, PROPOSED_MAX)) {
    const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
    if (!r || typeof r.title !== "string" || !r.title.trim()) continue;
    if (r.level !== "kpi" && r.level !== "kdi" && r.level !== "todo") continue;
    parts.push(`${SHORT_LABEL[r.level]}『${cut(r.title.trim(), HIERARCHY_TITLE_CHARS)}』`);
  }
  return parts.length > 0 ? `階層に ${parts.join("・")}を足しました` : null;
}

/** AI が返した items を検査する。段と親は step から・3 件まで・通らないものは捨てる。 */
export function parseProposedItems(x: unknown, step: HierarchyStep | null, projectId: string): ItemInput[] {
  if (!step || step.level === "kgi" || !Array.isArray(x)) return [];
  const out: ItemInput[] = [];
  for (const raw of x.slice(0, PROPOSED_MAX)) {
    const r = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    if (!r) continue;
    const input = parseItemInput({
      projectId,
      parentId: step.parent.id,
      level: step.level,
      title: r.title,
      target: r.target,
      dueDate: r.dueDate,
    });
    if (input) out.push(input);
  }
  return out;
}
