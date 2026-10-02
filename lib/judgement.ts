// --- ToDo の判定 (EXP-034) ---
// 「✓ 完了」を押した ToDo (状態「実行」= 完了・まだ判定していない) を AI と一緒に判定する。純粋な関数だけ。

import { daysBetween } from "./progress";
import type { PlanItem } from "./plan-items";

export type Judgement = "succeeded" | "failed" | "adjusted";
export const JUDGEMENTS: Judgement[] = ["succeeded", "failed", "adjusted"];
/** 判定の答えの候補 (この順に choices へ)。 */
export const JUDGEMENT_CHOICES = ["判定基準を満たした", "一部できた", "できなかった"] as const;
/** 判定を待つ ToDo を探す日数 (今日を含む)。 */
export const PENDING_DAYS = 7;

/** 判定を待っている ToDo: 状態が「実行」で、期日が今日から 6 日前までのうち一番新しく更新されたもの。 */
export function pendingJudgement(items: PlanItem[], today: string): PlanItem | null {
  const candidates = items.filter((i) => {
    if (i.level !== "todo" || i.status !== "done") return false;
    const d = daysBetween(i.dueDate, today);
    return d !== null && d >= 0 && d < PENDING_DAYS;
  });
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))[0];
}

/** AI の返した判定。succeeded / failed / adjusted のどれかなら返す。 */
export function parseJudgement(x: unknown): Judgement | null {
  return typeof x === "string" && (JUDGEMENTS as string[]).includes(x) ? (x as Judgement) : null;
}

/** 「✓ 完了」で会話に送る文。 */
export function completeMessage(title: string): string {
  return `『${title}』を完了しました。判定をお願いします`;
}

const JUDGED_LABEL: Record<Judgement, string> = { succeeded: "成功", failed: "失敗", adjusted: "調整" };

/** 画面のお知らせ: サーバの judged から。形が違えば null。 */
export function judgedNotice(x: unknown): string | null {
  if (typeof x !== "object" || x === null) return null;
  const r = x as Record<string, unknown>;
  const status = parseJudgement(r.status);
  if (!status || typeof r.title !== "string" || !r.title.trim()) return null;
  return `『${r.title.trim()}』を${JUDGED_LABEL[status]}と判定しました`;
}
