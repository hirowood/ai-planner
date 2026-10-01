// --- 新しいプロジェクトの最初の一言と候補 (EXP-027) ---
// 過去のプロジェクトの記録を、AI に渡す要約の文にする (純粋な関数だけ)。

import { STATUS_LABEL, STATUS_ORDER, type ItemStatus } from "./plan-items";
import { categoryLabel } from "./projects";
import { neutralize } from "./coach-context";

export type PastProject = {
  name: string;
  category: string;
  purpose: string;
  kgiTitle: string | null;
  kgiStatus: string | null;
  counts: Record<ItemStatus, number>;
};

export const OPENING = "新しい目標を一緒に決めましょう。まず、具体的に何をしたいですか？";
// 候補は KGI (成果・なりたい状態) の言い方にする。「毎日〜する」などの行動は KDI なので候補にしない (EXP-029)
export const DEFAULT_START_CHOICES = ["健康的な生活習慣を身につける", "資格・試験に合格する", "仕事で成果を出す", "まだ決めていない"];
export const PAST_LIMIT = 10;

/** プロジェクトを作った直後の一言 (画面で作る・EXP-029)。次は KPI へ進む。 */
export function afterCreateMessage(name: string): string {
  return `『${name}』の KGI ができました (固定)。次は、期限までに KGI を達成できているかを途中で測る KPI を決めましょう。何で進み具合を測りますか？`;
}
const TEXT_CHARS = 60;

function cut(s: string): string {
  const chars = [...neutralize(s.replace(/\s+/g, " ").trim())];
  return chars.length > TEXT_CHARS ? `${chars.slice(0, TEXT_CHARS).join("")}…` : chars.join("");
}

/** 1 件 1 行の要約 (新しい 10 件まで)。本人の書いた文は neutralize して 60 字で切る。 */
export function summarizePast(projects: PastProject[]): string {
  return projects
    .slice(0, PAST_LIMIT)
    .map((p) => {
      const kgi = p.kgiTitle
        ? `KGI「${cut(p.kgiTitle)}」は${STATUS_LABEL[(p.kgiStatus ?? "todo") as ItemStatus] ?? "未実行"}`
        : "KGI はまだ無い";
      const counts = STATUS_ORDER.map((s) => `${STATUS_LABEL[s]} ${p.counts[s] ?? 0}`).join(" / ");
      const purpose = p.purpose.trim() ? `目的「${cut(p.purpose)}」・` : "";
      return `- ${cut(p.name)} (${cut(categoryLabel(p.category))}): ${purpose}${kgi}・${counts}`;
    })
    .join("\n");
}
