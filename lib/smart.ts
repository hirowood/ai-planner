// --- 会話で SMART を決めて新しいプロジェクトを作る (EXP-018) ---
// SMART の下書きの形・検査・重ね合わせ・KGI への変換 (純粋な関数だけ・next や db に依存しない)。

import { CATEGORY_LABEL, CUSTOM_KIND_MAX } from "./projects";

export type SmartField = "name" | "category" | "specific" | "measurable" | "achievable" | "relevant" | "timeBound";
// timeBound は "YYYY-MM-DD" か ""
export type SmartDraft = Record<SmartField, string>;

/** 聞く順: ゴールの中身 (S → M → T → R → A) を先に決め、名前と種類は最後に聞く。 */
export const SMART_FIELDS: SmartField[] = [
  "specific",
  "measurable",
  "timeBound",
  "relevant",
  "achievable",
  "name",
  "category",
];

export const SMART_LABEL: Record<SmartField, string> = {
  specific: "具体的に何を (S)",
  measurable: "どう測るか (M)",
  timeBound: "いつまでに (T)",
  relevant: "なぜやるか (R)",
  achievable: "達成できるか (A)",
  name: "プロジェクトの名前",
  category: "種類",
};

export const EMPTY_SMART: SmartDraft = {
  name: "",
  category: "",
  specific: "",
  measurable: "",
  achievable: "",
  relevant: "",
  timeBound: "",
};

const NAME_MAX = 60;
const TEXT_MAX = 300;
const KGI_MAX = 200;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// 改行・タブなどの制御文字 (lib/projects.ts と同じ規則・一覧の表示を崩すので受け付けない)
const CONTROL_RE = /\p{Cc}/u;

function asRecord(x: unknown): Record<string, unknown> | null {
  return typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

// 字数は [...s] で数える (絵文字などのサロゲートペアを 1 字とする)
function charCount(s: string): number {
  return [...s].length;
}

// 形だけでなく実在する日付か (2026-02-30 などを期限にしない)。Date.UTC で往復して確かめる
function isRealDate(s: string): boolean {
  const m = YMD_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** 1 つの欄の値を検査する。空は "" (未入力として許す)・規則から外れたら null。 */
function fieldValue(f: SmartField, v: unknown): string | null {
  // 無いキー (undefined / null) は未入力。文字列以外の値は受け付けない
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t === "") return "";
  switch (f) {
    case "timeBound":
      return isRealDate(t) ? t : null;
    case "category":
      // 既定の 3 つはそのまま、自由入力は 1〜20 字で制御文字なし (lib/projects.ts と同じ)
      if (Object.hasOwn(CATEGORY_LABEL, t)) return t;
      return charCount(t) <= CUSTOM_KIND_MAX && !CONTROL_RE.test(t) ? t : null;
    case "name":
      return charCount(t) <= NAME_MAX ? t : null;
    default:
      return charCount(t) <= TEXT_MAX ? t : null;
  }
}

/** 受け取った値を SMART の下書きにする。オブジェクトでない・どれか 1 つでも規則外なら null。無いキーは ""。 */
export function parseSmartDraft(x: unknown): SmartDraft | null {
  const r = asRecord(x);
  if (!r) return null;
  const out: SmartDraft = { ...EMPTY_SMART };
  for (const f of SMART_FIELDS) {
    const v = fieldValue(f, r[f]);
    if (v === null) return null;
    out[f] = v;
  }
  return out;
}

/** 埋まった欄だけ上書きする。欄ごとに検査し、規則外の欄は無視・空では上書きしない (AI の返答 1 つの誤りで全体を捨てない)。 */
export function mergeSmart(base: SmartDraft, patch: unknown): SmartDraft {
  const r = asRecord(patch);
  const out: SmartDraft = { ...base };
  if (!r) return out;
  for (const f of SMART_FIELDS) {
    const v = fieldValue(f, r[f]);
    if (v) out[f] = v;
  }
  return out;
}

/** 聞く順で最初の空の欄 (全部埋まれば null)。 */
export function nextSmartField(d: SmartDraft): SmartField | null {
  return SMART_FIELDS.find((f) => d[f].trim() === "") ?? null;
}

/** 全部の欄が規則どおりに埋まり、期限が today (YYYY-MM-DD) 以降なら true。 */
export function isSmartReady(d: SmartDraft, today: string): boolean {
  // 作成 API の最後の関門になるので、手で組んだ下書きも欄ごとに検査し直す
  for (const f of SMART_FIELDS) {
    const v = fieldValue(f, d[f]);
    if (!v) return false;
  }
  if (!isRealDate(today)) return false;
  // 実在する YYYY-MM-DD 同士なので文字列の比較で日付の前後が分かる
  return d.timeBound.trim() >= today;
}

function cut(s: string, max: number): string {
  const chars = [...s.trim()];
  return chars.length > max ? chars.slice(0, max).join("") : chars.join("");
}

/** 下書きを階層の KGI にする。title = specific・target = measurable (各 200 字まで)・dueDate = timeBound。 */
export function smartToKgi(d: SmartDraft): { title: string; target: string; dueDate: string } {
  return { title: cut(d.specific, KGI_MAX), target: cut(d.measurable, KGI_MAX), dueDate: d.timeBound.trim() };
}
