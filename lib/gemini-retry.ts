// --- Gemini が混み合っている (503) ときに 1 回だけ送り直す (EXP-028) ---
// 429 (上限) やほかの失敗は送り直さない (枠を無駄にしない・同じ失敗を繰り返さない)。

export const OVERLOADED_MESSAGE = "AI が混み合っています。少し待ってから送り直してください";

/** Gemini の失敗が 503 (混雑) か。 */
export function isOverloaded(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 503) return true;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && message.includes("503");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 上位のモデルが無い (404) か枠切れ (429) なら、今のモデルで 1 回だけ送り直す (EXP-044)。ほかの失敗はそのまま投げる。 */
export async function withModelFallback<T>(
  run: (model: string) => Promise<T>,
  primary: string,
  fallback: string,
): Promise<{ result: T; fellBack: boolean }> {
  if (primary === fallback) return { result: await run(primary), fellBack: false };
  try {
    return { result: await run(primary), fellBack: false };
  } catch (error: unknown) {
    const status = (error as { status?: unknown } | null)?.status;
    const message = String((error as { message?: unknown } | null)?.message ?? "");
    const missingOrQuota = status === 404 || status === 429 || /\b(404|429)\b/.test(message);
    if (!missingOrQuota) throw error;
    return { result: await run(fallback), fellBack: true };
  }
}

/** fn が 503 で失敗したら wait ms 待って 1 回だけ送り直す。2 回目の失敗はそのまま投げる。 */
export async function withGeminiRetry<T>(fn: () => Promise<T>, wait = 800): Promise<T> {
  try {
    return await fn();
  } catch (error: unknown) {
    if (!isOverloaded(error)) throw error;
    await sleep(wait);
    return await fn();
  }
}
