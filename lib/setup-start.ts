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
export const DEFAULT_START_CHOICES = ["毎日の習慣を作りたい", "資格・試験に合格したい", "仕事の成果を上げたい", "まだ決めていない"];
export const PAST_LIMIT = 10;
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
