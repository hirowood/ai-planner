// --- 目的ごとのチャット (EXP-043) ---
// プロジェクトごとに 5 つの会話 (壁打ち・相談 / KGI / KPI / KDI / ToDo)。それぞれが自分の段だけを扱う。純粋な関数だけ。

import { KDI_TARGET, TODO_PER_KDI, type HierarchyStep } from "./hierarchy-step";
import type { PlanItem } from "./plan-items";

export type CoachThread = "chat" | "kgi" | "kpi" | "kdi" | "todo";
export const COACH_THREADS: CoachThread[] = ["chat", "kgi", "kpi", "kdi", "todo"];
export const THREAD_LABEL: Record<CoachThread, { icon: string; label: string }> = {
  chat: { icon: "💬", label: "壁打ち・相談" },
  kgi: { icon: "🎯", label: "KGI" },
  kpi: { icon: "📈", label: "KPI" },
  kdi: { icon: "🧭", label: "KDI" },
  todo: { icon: "✅", label: "ToDo" },
};

/** 会話ごとの役割の文 (プロンプト)。 */
export const THREAD_ROLE: Record<CoachThread, string> = {
  chat: "この会話は「壁打ち・相談」です。何でも相談できる相手として、悩みや考えを一緒に整理してください。階層 (KGI / KPI / KDI / ToDo) には足しません。決める段の話になったら、どのチャット (🎯 KGI・📈 KPI・🧭 KDI・✅ ToDo) で決めるとよいかを案内してください。",
  kgi: "この会話は「KGI」です。KGI (固定) の意味・進み具合・期限までの見通しを一緒に確かめてください。KGI は変えません。階層には足しません。KPI や KDI の話になったら、そのチャットを案内してください。",
  kpi: "この会話は「KPI」です。KGI を期限までに達成できているかを途中で測る KPI を決める・変えることだけを扱ってください。KDI や ToDo の話になったら、そのチャットを案内してください。",
  kdi: "この会話は「KDI」です。KPI を達成するための KDI (行動の量・頻度) を決める・都度変えることだけを扱ってください。今日の ToDo の話になったら ✅ ToDo のチャットを案内してください。",
  todo: "この会話は「ToDo」です。KDI をどう達成するかの今日の ToDo (時刻つき) を決める・完了したら判定する・振り返ることを扱ってください。",
};

export function isCoachThread(x: unknown): x is CoachThread {
  return typeof x === "string" && (COACH_THREADS as string[]).includes(x);
}

const byCreated = (a: PlanItem, b: PlanItem) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1);

/** その会話で決める段。chat・kgi は null (足さない)。 */
export function threadStep(thread: CoachThread, items: PlanItem[], today: string): HierarchyStep | null {
  if (thread === "chat" || thread === "kgi") return null;
  const sorted = [...items].sort(byCreated);
  const kgi = sorted.find((i) => i.level === "kgi");
  if (!kgi) return { level: "kgi" };
  const kpis = sorted.filter((i) => i.level === "kpi" && i.parentId === kgi.id);
  if (thread === "kpi") return { level: "kpi", parent: kgi };
  const activeKdis = (kpi: PlanItem) => sorted.filter((i) => i.level === "kdi" && i.parentId === kpi.id && i.status !== "shelved");
  const kdis = kpis.flatMap(activeKdis).sort(byCreated);
  if (thread === "kdi") {
    if (kpis.length === 0) return null;
    let parent = kpis[0];
    for (const kpi of kpis) if (activeKdis(kpi).length < activeKdis(parent).length) parent = kpi;
    // 目安 (3 つ) を超えて足さない (変えるのはいつでも)
    return kdis.length < KDI_TARGET ? { level: "kdi", parent, have: kdis.length } : null;
  }
  // todo
  for (const kdi of kdis.slice(0, KDI_TARGET)) {
    const have = sorted.filter((i) => i.level === "todo" && i.parentId === kdi.id && i.dueDate === today).length;
    if (have < TODO_PER_KDI) return { level: "todo", parent: kdi, today, have };
  }
  return null;
}

/** その会話で変えてよい番号か (kpi は K・kdi は D・ほかは変えない)。 */
export function threadAllowsChange(thread: CoachThread, ref: string): boolean {
  if (thread === "kpi") return /^K\d+$/.test(ref);
  if (thread === "kdi") return /^D\d+$/.test(ref);
  return false;
}
