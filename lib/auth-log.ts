// --- ログインの更新の失敗をログに出すときの語 (安全レビュー W3) ---
// Google の応答の本文や説明 (error_description) は出さない。

/** Error なら名前、Google の応答なら error の種類 (英小文字と _ だけ・例 invalid_grant)、それ以外は "unknown"。 */
export function refreshErrorKind(error: unknown): string {
  if (error instanceof Error) return error.name;
  const kind = (error as { error?: unknown } | null)?.error;
  return typeof kind === "string" && /^[a-z_]{1,40}$/.test(kind) ? kind : "unknown";
}
