// --- AI の質問への答えの候補 (EXP-023) ---
// モデルが返した choices は信用せず、画面のボタンにしてよい形だけを残す。

export const CHOICES_MAX = 4;
export const CHOICE_CHARS = 20;

// 改行・タブなどの制御文字 (ボタンの表示を崩すので受け付けない)
const CONTROL_RE = /\p{Cc}/u;

/** 配列でなければ []。文字列だけ・trim・1〜20 字・制御文字なし・重複なし・最大 4 個。 */
export function parseChoices(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  const out: string[] = [];
  for (const v of x) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    const n = [...t].length;
    if (n < 1 || n > CHOICE_CHARS || CONTROL_RE.test(t) || out.includes(t)) continue;
    out.push(t);
    if (out.length === CHOICES_MAX) break;
  }
  return out;
}
