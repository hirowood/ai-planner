// --- 使う Gemini のモデル (EXP-014) ---
// 1 日の無料枠 (gemini-2.5-flash は 20 回) に当たって利用が止まったため、軽いモデルに替えた。
// /api/chat と /api/plan/chat の両方がここを読む (モデルを替えるときは 1 か所だけ直す)。
export const GEMINI_MODEL = "gemini-2.5-flash-lite";
