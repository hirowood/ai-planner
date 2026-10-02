// --- 階層の「次に決める段」(EXP-019・EXP-031) ---
// KGI → KPI → KDI (3 つほど) → 毎日の ToDo (KDI ごとに 3 つほど) を 1 段ずつ決める。AI が決まった項目を足すとき、段と親はここで決める (AI の言う親は使わない)。

import { neutralize } from "./coach-context";
import { STATUS_LABEL, parseItemInput, type ItemInput, type ItemLevel, type PlanItem } from "./plan-items";
import { parseSlot, type Slot } from "./slots";

export type HierarchyStep =
  | { level: "kgi" }
  | { level: "kpi"; parent: PlanItem }
  // KDI (安全レビュー W5): have = 今ある KDI の数 (棚上げは数えない)。足せるのは KDI_TARGET - have まで
  | { level: "kdi"; parent: PlanItem; have: number }
  // 今日の ToDo (EXP-031): today = 期日にする日・have = その KDI の今日の ToDo の数
  | { level: "todo"; parent: PlanItem; today: string; have: number };

export const PROPOSED_MAX = 3;
export const SHORT_LABEL: Record<ItemLevel, string> = { kgi: "KGI", kpi: "KPI", kdi: "KDI", todo: "ToDo" };
export const HIERARCHY_LINES_MAX = 40;
export const HIERARCHY_TITLE_CHARS = 60;
/** プロジェクトの KDI の目安 (棚上げは数えない・EXP-031)。 */
export const KDI_TARGET = 3;
/** KDI ごとの今日の ToDo の目安 (1 日 9 つほど・EXP-031)。 */
export const TODO_PER_KDI = 3;

function byCreated(a: PlanItem, b: PlanItem): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 次に決める段 (EXP-035 が EXP-031 の順を置き換え: すぐに ToDo へ)。
 * KGI が無い → kgi・KPI が無い → kpi・KDI が 0 → kdi・
 * 今日の ToDo が 3 つ未満の KDI (古い順・3 つまで) → todo・KDI が 3 つ未満 → kdi (KDI の少ない KPI の下)・
 * 全部そろっている → null。棚上げの KDI は数えない。
 */
export function nextHierarchyStep(items: PlanItem[], today: string): HierarchyStep | null {
  const sorted = [...items].sort(byCreated);
  const kgi = sorted.find((i) => i.level === "kgi");
  if (!kgi) return { level: "kgi" };
  const childrenOf = (p: PlanItem) => sorted.filter((i) => i.parentId === p.id);
  const kpis = childrenOf(kgi).filter((i) => i.level === "kpi");
  if (kpis.length === 0) return { level: "kpi", parent: kgi };
  const activeKdis = (kpi: PlanItem) => childrenOf(kpi).filter((i) => i.level === "kdi" && i.status !== "shelved");
  const kdis = kpis.flatMap(activeKdis).sort(byCreated);
  // KDI の一番少ない KPI の下に足す (同じなら古い KPI)
  const kdiStep = (): HierarchyStep => {
    let parent = kpis[0];
    for (const kpi of kpis) if (activeKdis(kpi).length < activeKdis(parent).length) parent = kpi;
    return { level: "kdi", parent, have: kdis.length };
  };
  if (kdis.length === 0) return kdiStep();
  // KDI が 1 つでもあれば、まず今日の ToDo (鬼速PDCA: 小さな PDCA を毎日回す)
  for (const kdi of kdis.slice(0, KDI_TARGET)) {
    const have = childrenOf(kdi).filter((i) => i.level === "todo" && i.dueDate === today).length;
    if (have < TODO_PER_KDI) return { level: "todo", parent: kdi, today, have };
  }
  if (kdis.length < KDI_TARGET) return kdiStep();
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
      if (i.target) parts.push(`判定基準 ${neutralize(cut(i.target, HIERARCHY_TITLE_CHARS))}`);
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

/** AI が返した items を検査する。段と親は step から・通らないものは捨てる。
 * 今日の ToDo は期日が空なら今日にし、今日でないものは捨てる・数は TODO_PER_KDI - have まで (EXP-031)。 */
export function parseProposedItems(x: unknown, step: HierarchyStep | null, projectId: string): ItemInput[] {
  if (!step || step.level === "kgi" || !Array.isArray(x)) return [];
  const max =
    step.level === "todo"
      ? Math.max(0, TODO_PER_KDI - step.have)
      : step.level === "kdi"
        ? Math.max(0, KDI_TARGET - step.have)
        : PROPOSED_MAX;
  const out: ItemInput[] = [];
  for (const raw of x) {
    if (out.length >= max) break;
    const r = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    if (!r) continue;
    let dueDate = r.dueDate;
    if (step.level === "todo") {
      if (dueDate === undefined || dueDate === null || dueDate === "") dueDate = step.today;
      if (dueDate !== step.today) continue;
    }
    const input = parseItemInput({
      projectId,
      parentId: step.parent.id,
      level: step.level,
      title: r.title,
      target: r.target,
      dueDate,
    });
    if (input) out.push(input);
  }
  return out;
}

/** 候補 (EXP-035): AI の candidates を今の段として検査し、題と判定基準だけを返す (3 つまで)。 */
// start / end は今日の ToDo の時刻 (EXP-039・無ければ "")
export type Candidate = { title: string; target: string; start?: string; end?: string };
export function parseCandidates(x: unknown, step: HierarchyStep | null, projectId: string): Candidate[] {
  const slots = slotsByTitle(x);
  return parseProposedItems(x, step, projectId)
    .slice(0, PROPOSED_MAX)
    .map((i) => {
      const s = step && step.level === "todo" ? slots.get(i.title) : undefined;
      return s ? { title: i.title, target: i.target, start: s.start, end: s.end } : { title: i.title, target: i.target };
    });
}

/** AI の items / candidates の題 → 時刻 (正しいものだけ・EXP-039)。 */
export function slotsByTitle(x: unknown): Map<string, Slot> {
  const out = new Map<string, Slot>();
  if (!Array.isArray(x)) return out;
  for (const r of x) {
    if (typeof r !== "object" || r === null) continue;
    const o = r as Record<string, unknown>;
    if (typeof o.title !== "string") continue;
    const s = parseSlot({ start: o.start ?? "", end: o.end ?? "" });
    if (s && s !== "clear") out.set(o.title.trim(), s);
  }
  return out;
}

/** 画面で使う: サーバの candidates の形を検査する。 */
export function parseCandidateList(x: unknown): Candidate[] {
  if (!Array.isArray(x)) return [];
  const out: Candidate[] = [];
  for (const r of x.slice(0, PROPOSED_MAX)) {
    if (typeof r !== "object" || r === null) continue;
    const o = r as Record<string, unknown>;
    if (typeof o.title !== "string" || !o.title.trim()) continue;
    const slot = parseSlot({ start: o.start ?? "", end: o.end ?? "" });
    out.push({
      title: o.title.trim(),
      target: typeof o.target === "string" ? o.target : "",
      ...(slot && slot !== "clear" ? { start: slot.start, end: slot.end } : {}),
    });
  }
  return out;
}

/** 候補のボタンを押したときに送る本文 (EXP-035)。 */
export function pickBody(projectId: string, c: Candidate): { projectId: string; message: string; pick: Candidate } {
  return { projectId, message: `『${c.title}』にします`, pick: { title: c.title, target: c.target, ...(c.start && c.end ? { start: c.start, end: c.end } : {}) } };
}

/** 答えの候補のボタン: 次の段の候補の題を先に、ほかの候補を後に (同じ文は 1 つ・EXP-035)。 */
export function choiceButtons(candidates: Candidate[], choices: string[]): string[] {
  const titles = candidates.map((c) => c.title);
  return [...titles, ...choices.filter((c) => !titles.includes(c))];
}
