// --- 目的別プロジェクトとノート (EXP-008) ---
// API が受け取った値を、データベースへ渡す前に検査する (純粋な関数だけ・next や db に依存しない)。

export type Category = "habit" | "learning" | "work";
export const CATEGORY_LABEL: Record<Category, string> = { habit: "習慣", learning: "学習", work: "仕事" };

export type NoteKind = "fact" | "data" | "thought";
export const NOTE_KIND_LABEL: Record<NoteKind, string> = { fact: "事実", data: "データ", thought: "考え" };

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

function isCategory(v: unknown): v is Category {
  return typeof v === "string" && Object.hasOwn(CATEGORY_LABEL, v);
}

function isNoteKind(v: unknown): v is NoteKind {
  return typeof v === "string" && Object.hasOwn(NOTE_KIND_LABEL, v);
}

/** 正しい形の UUID (8-4-4-4-12 の 16 進・大文字小文字は問わない) か。問い合わせの前に弾くため。 */
export function isUuid(x: unknown): x is string {
  return typeof x === "string" && UUID_RE.test(x);
}

/** プロジェクトの入力。name 1〜60 字・purpose 0〜500 字 (無ければ "")・category は 3 つのどれか。余計な項目は落とす。 */
export function parseProjectInput(x: unknown): ProjectInput | null {
  const r = asRecord(x);
  if (!r) return null;
  const name = trimmedText(r.name, 1, 60);
  const purpose = r.purpose === undefined ? "" : trimmedText(r.purpose, 0, 500);
  if (name === null || purpose === null || !isCategory(r.category)) return null;
  return { name, category: r.category, purpose };
}

/** ノートの入力。projectId は UUID・kind は 3 つのどれか・body 1〜2000 字。余計な項目は落とす。 */
export function parseNoteInput(x: unknown): NoteInput | null {
  const r = asRecord(x);
  if (!r) return null;
  const body = trimmedText(r.body, 1, 2000);
  if (!isUuid(r.projectId) || !isNoteKind(r.kind) || body === null) return null;
  return { projectId: r.projectId, kind: r.kind, body };
}
