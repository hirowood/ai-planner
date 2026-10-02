// --- 時間の入力画面 (EXP-006) ---
// AI が時間を聞く返答の最後に付ける目印と、入力画面の値から送る文を作る関数。

export const TIME_MARKER = "[[time]]";
const MARKER_RE = /\s*\[\[time\]\]\s*/g;

/** 返答に目印があるか (返答の全文で判定する)。 */
export function hasTimeMarker(text: string): boolean {
  return text.includes(TIME_MARKER);
}

/** 画面と履歴に出す文から目印を取り除く。ストリームの途中で目印が割れていても、末尾の書きかけ `[[t` などは隠す。 */
export function stripTimeMarker(text: string): string {
  const removed = text.replace(MARKER_RE, "");
  return removed.replace(/\[(\[(t(i(m(e(\](\])?)?)?)?)?)?)?$/, "").trimEnd();
}

/** 所要時間の選択肢 (分)。 */
export const DURATION_OPTIONS: number[] = [30, 60, 90, 120, 150, 180, 240, 300, 360, 480];

export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}分`;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

/** 「何時間」で送る文。 */
export function durationMessage(minutes: number): string {
  return `時間: ${durationLabel(minutes)}`;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 「何時から何時まで」で送る文。date は "YYYY-MM-DD"、start/end は "HH:MM"。
 * 形が正しくない・終了が開始より後でないときは null (送信できない)。
 */
export function rangeMessage(date: string, start: string, end: string): string | null {
  const d = YMD.exec(date);
  const s = HHMM.exec(start);
  const e = HHMM.exec(end);
  if (!d || !s || !e) return null;
  const startMin = Number(s[1]) * 60 + Number(s[2]);
  const endMin = Number(e[1]) * 60 + Number(e[2]);
  if (endMin <= startMin) return null;
  const mmdd = `${Number(d[2])}/${Number(d[3])}`;
  return `時間: ${d[1]}/${mmdd} ${start}〜${end} (${durationLabel(endMin - startMin)})`;
}
