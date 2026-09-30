// --- Gemini の利用上限 (429) の扱い (EXP-005) ---
// サーバ: 429 の種類 (1 日の上限か、それ以外か) と、1 日の上限が戻る時刻を決める。
// 画面: サーバの返した種類から、エラーではなく「上限」のお知らせの文を作る。

export type QuotaKind = "quota_daily" | "quota_rate";

type QuotaViolation = { quotaId?: unknown };

/** Gemini の 429 が「1 日の上限」かどうか。errorDetails の quotaId を見て、無ければ文言を見る。 */
export function quotaKind(error: { errorDetails?: unknown; message?: string }): QuotaKind {
  const details = Array.isArray(error.errorDetails) ? error.errorDetails : [];
  for (const d of details) {
    const violations: unknown = (d as { violations?: unknown })?.violations;
    if (!Array.isArray(violations)) continue;
    if (violations.some((v: QuotaViolation) => typeof v.quotaId === "string" && v.quotaId.includes("PerDay"))) {
      return "quota_daily";
    }
  }
  return error.message?.includes("PerDay") ? "quota_daily" : "quota_rate";
}

/**
 * 1 日の上限が戻る時刻 (日本時間の "HH:MM")。Gemini の 1 日の枠は太平洋時間の 0 時に戻る。
 * 夏時間の切り替わる日は 1 時間ずれうる (年 2 回・表示は「ごろ」とする)。
 */
export function quotaResetLabel(now: Date = new Date()): string {
  const la = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => Number(la.find((p) => p.type === type)?.value ?? 0);
  const sinceMidnight = (part("hour") * 3600 + part("minute") * 60 + part("second")) * 1000;
  const reset = new Date(now.getTime() + 24 * 3600 * 1000 - sinceMidnight);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(reset);
}

/** サーバが 429 と一緒に返す本文。 */
export function quotaBody(kind: QuotaKind, now: Date = new Date()): { error: string; kind: QuotaKind; reset_at?: string } {
  if (kind === "quota_daily") {
    const resetAt = quotaResetLabel(now);
    return { error: `本日の AI 利用上限に達しました。${resetAt} ごろに戻ります。`, kind, reset_at: resetAt };
  }
  return { error: "利用が集中しています。1 分ほど待ってから送り直してください。", kind };
}

/** 画面に出すお知らせの文。上限 (429) でなければ null (今までどおりのエラー処理に回す)。 */
export function quotaNotice(status: number, body: unknown): string | null {
  if (status !== 429) return null;
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (b.kind === "quota_daily" && typeof b.reset_at === "string") {
    return `本日の AI 利用上限に達しました。${b.reset_at} ごろに戻ります。送れなかった文は入力欄に戻しました。`;
  }
  return "利用が集中しています。1 分ほど待ってから送り直してください。送れなかった文は入力欄に戻しました。";
}
