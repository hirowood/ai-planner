// --- 使う Gemini のモデル (EXP-015) ---
// 1 日の無料枠 (gemini-2.5-flash は 20 回) に当たって利用が止まったため、軽いモデルに替えた。
// EXP-014 の gemini-2.5-flash-lite は一覧に載っているのに 404 (新しい利用者には提供終了) だった。
// 替えるときは一覧ではなく、実際に 1 回呼んで 200 になることを確かめてから (evidence/EXP-014/result.md)。
// 中身が替わる別名 (-latest) は使わない (前後で比べられなくなる)。
// /api/chat と /api/plan/chat の両方がここを読む (モデルを替えるときは 1 か所だけ直す)。
export const GEMINI_MODEL = "gemini-3.5-flash-lite";
