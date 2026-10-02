// --- 使う Gemini のモデル (EXP-015) ---
// 1 日の無料枠 (gemini-2.5-flash は 20 回) に当たって利用が止まったため、軽いモデルに替えた。
// EXP-014 の gemini-2.5-flash-lite は一覧に載っているのに 404 (新しい利用者には提供終了) だった。
// 替えるときは一覧ではなく、実際に 1 回呼んで 200 になることを確かめてから (evidence/EXP-014/result.md)。
// 中身が替わる別名 (-latest) は使わない (前後で比べられなくなる)。
// /api/chat と /api/plan/chat の両方がここを読む (モデルを替えるときは 1 か所だけ直す)。
export const GEMINI_MODEL = "gemini-3.5-flash-lite";

// --- チャットによってモデルを分ける (EXP-044) ---
// 考えを深める会話 (壁打ち・KGI・KPI・作成) は上位のモデル、回数の多い KDI・ToDo は今のモデル。
// 上位のモデルは実際に 1 回呼んで 200 を確かめてから使う (scripts/probe-model.mjs)。確かめるまでは false のまま。
export const GEMINI_MODEL_DEEP = "gemini-3.5-flash";
export const DEEP_MODEL_VERIFIED = false;

export type ModelUse = "chat" | "kgi" | "kpi" | "kdi" | "todo" | "setup";
const DEEP_USES: ModelUse[] = ["chat", "kgi", "kpi", "setup"];

/** その会話で使うモデル。上位を確かめていなければ全部 今のモデル。 */
export function modelFor(use: ModelUse, verified: boolean = DEEP_MODEL_VERIFIED): string {
  return verified && DEEP_USES.includes(use) ? GEMINI_MODEL_DEEP : GEMINI_MODEL;
}
