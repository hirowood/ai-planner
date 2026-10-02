// --- 同じ質問の繰り返しを測る (EXP-044) ---
// 返答の最後の質問が、直前の自分の返答の質問と同じかを見る。中身はログに出さず、真偽だけ。

/** 文の最後の質問 (「？」か「?」で終わる文)。無ければ null。 */
export function lastQuestion(text: string): string | null {
  const parts = text.split(/(?<=[？?])/);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i].trim();
    if (/[？?]$/.test(p)) {
      // その質問の文だけ (前の句点・改行の後ろ)
      const seg = p.split(/[。\n！!]/).pop() ?? p;
      return seg.trim() || null;
    }
  }
  return null;
}

const normalize = (s: string) => s.replace(/[\s、。，．,.!！?？「」『』（）()・…〜~\-ー]/g, "");

/** 返答の質問が直前の自分の質問と同じなら true (空白と記号の違いは同じとみなす)。 */
export function isRepeatQuestion(reply: string, previousAssistant: string | null | undefined): boolean {
  if (!previousAssistant) return false;
  const a = lastQuestion(reply);
  const b = lastQuestion(previousAssistant);
  if (!a || !b) return false;
  const na = normalize(a);
  return na.length > 0 && na === normalize(b);
}
