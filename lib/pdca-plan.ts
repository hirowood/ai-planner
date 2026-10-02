// --- AI が誘導して決める Plan (EXP-009) ---
// Plan の欄の形・検査・重ね合わせ・最初の一言・カレンダーの予定を作る (純粋な関数だけ・next や db に依存しない)。

export type Kpi = { name: string; target: string };
// "YYYY-MM-DD" / "HH:MM" (時刻は空でもよい)
export type Kdi = { action: string; date: string; start: string; end: string };
export type PlanDraft = { purpose: string; kgi: string; kpis: Kpi[]; kdis: Kdi[]; criteria: string; deliverable: string };
export type PlanField = "purpose" | "kgi" | "kpis" | "kdis" | "criteria" | "deliverable";
export type CalendarEventInput = {
  summary: string;
  description: string;
  start: { dateTime: string };
  end: { dateTime: string };
};

/** 聞く順: 目的 → 目標 → KPI → 行動 → 判定基準 → 成果物。 */
export const PLAN_FIELDS: PlanField[] = ["purpose", "kgi", "kpis", "kdis", "criteria", "deliverable"];

export const PLAN_FIELD_LABEL: Record<PlanField, string> = {
  purpose: "目的",
  kgi: "目標 (KGI)",
  kpis: "途中の指標 (KPI)",
  kdis: "行動 (KDI)",
  criteria: "判定基準",
  deliverable: "成果物",
};

export const EMPTY_PLAN: PlanDraft = { purpose: "", kgi: "", kpis: [], kdis: [], criteria: "", deliverable: "" };

const TEXT_MAX = 500;
const KPI_MAX = 3;
const KDI_MAX = 5;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// 形だけでなく実在する日付か (2026-99-99 や閏年でない 2/29 を予定にしない)。Date.UTC で往復して確かめる
const YMD = {
  test(s: string): boolean {
    const m = YMD_RE.exec(s);
    if (!m) return false;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const t = new Date(Date.UTC(y, mo - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
  },
};

function asRecord(x: unknown): Record<string, unknown> | null {
  return typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

// 字数は [...s] で数える (絵文字などのサロゲートペアを 1 字とする)
function cut(s: string): string {
  const t = s.trim();
  const chars = [...t];
  return chars.length > TEXT_MAX ? chars.slice(0, TEXT_MAX).join("") : t;
}

function text(v: unknown): string {
  return typeof v === "string" ? cut(v) : "";
}

function parseKpi(x: unknown): Kpi | null {
  const r = asRecord(x);
  if (!r || typeof r.name !== "string") return null;
  return { name: cut(r.name), target: text(r.target) };
}

// 日付・時刻は空か、正しい形のどちらか。形が違う要素は捨てる (でっち上げた時刻を予定にしない)
function slot(v: unknown, re: { test(s: string): boolean }): string | null {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" || re.test(t) ? t : null;
}

function parseKdi(x: unknown): Kdi | null {
  const r = asRecord(x);
  if (!r || typeof r.action !== "string") return null;
  const date = slot(r.date, YMD);
  const start = slot(r.start, HHMM);
  const end = slot(r.end, HHMM);
  if (date === null || start === null || end === null) return null;
  return { action: cut(r.action), date, start, end };
}

function parseList<T>(v: unknown, item: (x: unknown) => T | null, max: number): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const x of v) {
    const p = item(x);
    if (p) out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

/** 受け取った値を Plan の形にする。オブジェクトでなければ null。無い欄は空。 */
export function parsePlanDraft(x: unknown): PlanDraft | null {
  const r = asRecord(x);
  if (!r) return null;
  return {
    purpose: text(r.purpose),
    kgi: text(r.kgi),
    kpis: parseList(r.kpis, parseKpi, KPI_MAX),
    kdis: parseList(r.kdis, parseKdi, KDI_MAX),
    criteria: text(r.criteria),
    deliverable: text(r.deliverable),
  };
}

function isFilled(d: PlanDraft, f: PlanField): boolean {
  switch (f) {
    case "kpis":
      return d.kpis.some((k) => k.name.trim() !== "");
    case "kdis":
      return d.kdis.some((k) => k.action.trim() !== "");
    default:
      return d[f].trim() !== "";
  }
}

/** AI の返した欄だけを上書きする。空の値では上書きしない (欄を消さない)。 */
export function mergePlan(base: PlanDraft, patch: unknown): PlanDraft {
  const r = asRecord(patch);
  if (!r) return base;
  // 無いキーは「変えない」。parsePlanDraft で形をそろえてから、埋まった欄だけを採る
  const p = parsePlanDraft(r) as PlanDraft;
  const out: PlanDraft = { ...base };
  for (const f of PLAN_FIELDS) {
    if (!(f in r) || !isFilled(p, f)) continue;
    if (f === "kpis") out.kpis = p.kpis;
    else if (f === "kdis") out.kdis = p.kdis;
    else out[f] = p[f];
  }
  return out;
}

/** まだ空の最初の欄 (全部埋まれば null)。 */
export function nextField(d: PlanDraft): PlanField | null {
  return PLAN_FIELDS.find((f) => !isFilled(d, f)) ?? null;
}

/** 埋まっている欄の数 (0〜6)。 */
export function filledCount(d: PlanDraft): number {
  return PLAN_FIELDS.filter((f) => isFilled(d, f)).length;
}

// 次の欄を聞くときの短い手がかり。質問は 1 つだけにするため、ここには「？」を入れない
const FIELD_HINT: Record<PlanField, string> = {
  purpose: "なぜこれに取り組むのか",
  kgi: "最後にどうなっていれば成功か (例: 3 か月で 5kg 減らす)",
  kpis: "途中で確かめる数字 (例: 週 3 回の運動)",
  kdis: "いつ・何をするか (例: 毎朝 7:00〜7:30 に散歩)",
  criteria: "うまくいったと判断する線 (例: KPI を 8 割達成)",
  deliverable: "終わったときに手元に残るもの (例: 記録ノート)",
};

// 本人の入れた名前や目的に疑問符があると質問が 2 つに見えるので取り除く
function noQuestion(s: string): string {
  return s.replace(/[?？]/g, "").trim();
}

/** AI の最初の一言 (画面で作る・Gemini を使わない)。質問は必ず 1 つ (「？」は 1 つだけ)。 */
export function openingMessage(p: { name: string; purpose: string }, d: PlanDraft): string {
  const name = noQuestion(p.name) || "このプロジェクト";
  const next = nextField(d);
  if (filledCount(d) === 0) {
    const purpose = noQuestion(p.purpose);
    const about = purpose ? `目的は『${purpose}』と書かれていますね。` : "";
    return `「${name}」の Plan を一緒に決めましょう。${about}まず、${FIELD_HINT.purpose}、あなたの言葉で目的を教えてもらえますか？`;
  }
  if (next === null) {
    return `「${name}」の Plan の欄がすべて埋まりました。この内容で保存しますか？`;
  }
  return `「${name}」の Plan の続きです。次は${PLAN_FIELD_LABEL[next]}を決めましょう。${FIELD_HINT[next]}を教えてもらえますか？`;
}

function minutes(hhmm: string): number {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

function planDescription(d: PlanDraft, cycleId: string): string {
  const kpi = d.kpis
    .filter((k) => k.name.trim() !== "")
    .map((k) => (k.target ? `${k.name} (${k.target})` : k.name))
    .join(" / ");
  const lines: string[] = [];
  if (d.purpose) lines.push(`目的: ${d.purpose}`);
  if (d.kgi) lines.push(`目標: ${d.kgi}`);
  if (kpi) lines.push(`KPI: ${kpi}`);
  if (d.criteria) lines.push(`判定基準: ${d.criteria}`);
  if (d.deliverable) lines.push(`成果物: ${d.deliverable}`);
  // 最終行の目印で、カレンダーの予定からどの cycle の行動かを辿る
  lines.push(`PDCA-CYCLE:${cycleId}`);
  return lines.join("\n");
}

/** 日付と開始・終了がそろい、終了が開始より後の行動だけを予定にする (+09:00)。 */
export function planToEvents(d: PlanDraft, cycleId: string): CalendarEventInput[] {
  const description = planDescription(d, cycleId);
  return d.kdis
    .filter((k) => k.action.trim() !== "" && YMD.test(k.date) && minutes(k.end) > minutes(k.start))
    .map((k) => ({
      summary: `🎯 ${k.action}`,
      description,
      start: { dateTime: `${k.date}T${k.start}:00+09:00` },
      end: { dateTime: `${k.date}T${k.end}:00+09:00` },
    }));
}
