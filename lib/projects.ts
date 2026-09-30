// --- 目的別プロジェクトとノート (EXP-008) ---
// API が受け取った値を、データベースへ渡す前に検査する (純粋な関数だけ・next や db に依存しない)。

// 種類は既定の値か、本人が入れた名前 (EXP-012)。既定の値はこれまでどおり英字で保存する
export type PresetCategory = "habit" | "learning" | "work";
export type Category = string;
export const CATEGORY_LABEL: Record<PresetCategory, string> = { habit: "習慣", learning: "学習", work: "仕事" };

export type PresetNoteKind = "fact" | "data" | "thought";
export type NoteKind = string;
export const NOTE_KIND_LABEL: Record<PresetNoteKind, string> = { fact: "事実", data: "データ", thought: "考え" };

/** 自由入力の種類の字数の上限。 */
export const CUSTOM_KIND_MAX = 20;

/** 表示の名前: 既定の値は日本語、自由入力はそのまま。 */
export function categoryLabel(c: Category): string {
  return Object.hasOwn(CATEGORY_LABEL, c) ? CATEGORY_LABEL[c as PresetCategory] : c;
}
export function noteKindLabel(k: NoteKind): string {
  return Object.hasOwn(NOTE_KIND_LABEL, k) ? NOTE_KIND_LABEL[k as PresetNoteKind] : k;
}

export type ProjectInput = { name: string; category: Category; purpose: string };
export type NoteInput = { projectId: string; kind: NoteKind; body: string };
export type Project = ProjectInput & { id: string; createdAt: string };
export type Note = NoteInput & { id: string; createdAt: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 字数は見た目の 1 文字で数える (絵文字を 2 と数えない)。 */
function charCount(s: string): number {
  return [...s].length;
}

function asRecord(x: unknown): Record<string, unknown> | null {
  return typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

/** trim して min〜max 字なら返す。文字列でない・字数が外れるなら null。 */
function trimmedText(v: unknown, min: number, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  const n = charCount(t);
  return n >= min && n <= max ? t : null;
}

// 改行・タブなどの制御文字 (一覧の表示を崩すので受け付けない)
const CONTROL_RE = /\p{Cc}/u;

/** 既定の値ならそのまま、そうでなければ trim して 1〜20 字の名前 (制御文字なし)。外れたら null。 */
function kindValue(v: unknown, presets: Record<string, string>): string | null {
  if (typeof v !== "string") return null;
  if (Object.hasOwn(presets, v)) return v;
  const t = trimmedText(v, 1, CUSTOM_KIND_MAX);
  return t !== null && !CONTROL_RE.test(t) ? t : null;
}

/** 正しい形の UUID (8-4-4-4-12 の 16 進・大文字小文字は問わない) か。問い合わせの前に弾くため。 */
export function isUuid(x: unknown): x is string {
  return typeof x === "string" && UUID_RE.test(x);
}

/** プロジェクトの入力。name 1〜60 字・purpose 0〜500 字 (無ければ "")・category は既定の 3 つか自由入力 1〜20 字。余計な項目は落とす。 */
export function parseProjectInput(x: unknown): ProjectInput | null {
  const r = asRecord(x);
  if (!r) return null;
  const name = trimmedText(r.name, 1, 60);
  const purpose = r.purpose === undefined ? "" : trimmedText(r.purpose, 0, 500);
  const category = kindValue(r.category, CATEGORY_LABEL);
  if (name === null || purpose === null || category === null) return null;
  return { name, category, purpose };
}

/** ノートの入力。projectId は UUID・kind は既定の 3 つか自由入力 1〜20 字・body 1〜2000 字。余計な項目は落とす。 */
export function parseNoteInput(x: unknown): NoteInput | null {
  const r = asRecord(x);
  if (!r) return null;
  const body = trimmedText(r.body, 1, 2000);
  const kind = kindValue(r.kind, NOTE_KIND_LABEL);
  if (!isUuid(r.projectId) || kind === null || body === null) return null;
  return { projectId: r.projectId, kind, body };
}
