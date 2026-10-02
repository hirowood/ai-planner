// --- 新しいプロジェクトを作るときの KPI (仮置き) (EXP-037) ---
// KGI (SMART) に続けて KPI を 1〜3 個決める。作った後も AI と話しながら変えられる (EXP-038)。純粋な関数だけ。

export type KpiDraft = { title: string; target: string; dueDate: string };
export const SETUP_KPI_MAX = 3;
const TITLE_MAX = 200;
const TARGET_MAX = 200;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CONTROL_RE = /\p{Cc}/u;

function isRealDate(s: string): boolean {
  const m = YMD_RE.exec(s);
  if (!m) return false;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return t.getUTCFullYear() === Number(m[1]) && t.getUTCMonth() === Number(m[2]) - 1 && t.getUTCDate() === Number(m[3]);
}
const len = (s: string) => [...s].length;

/** KPI の下書き 1 つ。期日は "" か、今日以上・KGI の期限以下 (KGI の期限が無ければ今日以上)。通らなければ null。 */
function parseOne(x: unknown, kgiDue: string, today: string): KpiDraft | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  if (typeof r.title !== "string") return null;
  const title = r.title.trim();
  if (len(title) < 1 || len(title) > TITLE_MAX || CONTROL_RE.test(title)) return null;
  const target = typeof r.target === "string" ? r.target.trim() : "";
  if (len(target) > TARGET_MAX || CONTROL_RE.test(target)) return null;
  const dueDate = typeof r.dueDate === "string" ? r.dueDate.trim() : "";
  if (dueDate !== "") {
    if (!isRealDate(dueDate) || dueDate < today) return null;
    if (kgiDue && dueDate > kgiDue) return null;
  }
  return { title, target, dueDate };
}

/** KPI の下書きの一覧 (3 個まで・通らないものは捨てる)。 */
export function parseKpiDrafts(x: unknown, kgiDue: string, today: string): KpiDraft[] {
  if (!Array.isArray(x)) return [];
  const out: KpiDraft[] = [];
  for (const v of x) {
    if (out.length >= SETUP_KPI_MAX) break;
    const k = parseOne(v, kgiDue, today);
    if (k && !out.some((o) => o.title === k.title)) out.push(k);
  }
  return out;
}

/** AI の返した kpis があれば置き換える (検査を通った分だけ・何も通らなければ base のまま)。 */
export function mergeKpiDrafts(base: KpiDraft[], patch: unknown, kgiDue: string, today: string): KpiDraft[] {
  const next = parseKpiDrafts(patch, kgiDue, today);
  return next.length > 0 ? next : base;
}

/** 作れるか: 題のある KPI が 1 つ以上で、題のある KPI がすべて検査を通る (画面の作るボタン・EXP-037)。 */
export function setupKpisReady(kpis: KpiDraft[], kgiDue: string, today: string = todayYmd()): boolean {
  const filled = kpis.filter((k) => k.title.trim() !== "");
  return filled.length > 0 && parseKpiDrafts(filled, kgiDue, today).length === filled.length;
}

function todayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
