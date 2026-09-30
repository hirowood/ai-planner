// --- 会話 1 本でプロジェクトの記録を見て話す (EXP-016) ---
// AI に渡す記録の文を作る (純粋な関数だけ・next や db に依存しない)。

import { PLAN_FIELDS, PLAN_FIELD_LABEL, type PlanDraft, type PlanField } from "./pdca-plan";
import { categoryLabel, noteKindLabel } from "./projects";

export type CoachRecords = {
  project: { name: string; category: string; purpose: string };
  plan: PlanDraft; // 今の周の Plan (無ければ EMPTY_PLAN)
  notes: { kind: string; body: string; createdAt: string }[]; // 新しい順
  pastCycles: { plan: PlanDraft; phase: string; updatedAt: string }[]; // 今の周を除く・新しい順
};

/** 渡すノートの件数。 */
export const NOTES_LIMIT = 20;
/** ノート 1 件あたりの字数 ([...s])。 */
export const NOTE_CHARS = 300;
export const PAST_CYCLES_LIMIT = 3;
/** 過去の周の各欄の字数。 */
export const CYCLE_FIELD_CHARS = 200;

const NONE = "(まだ無し)";

/** < > を ＜ ＞ に。本人の書いた文で <Records> の枠を閉じたりタグを差し込んだりさせない。 */
export function neutralize(s: string): string {
  return s.replace(/</g, "＜").replace(/>/g, "＞");
}

// 字数は [...s] で数える (絵文字などのサロゲートペアを 1 字とする)
function cut(s: string, max: number): string {
  const chars = [...s.trim()];
  return chars.length > max ? chars.slice(0, max).join("") : chars.join("");
}

// 本人の書いた文は必ずここを通す。切ってから置き換える (＜ ＞ も 1 字なので字数は変わらない)
function user(s: string, max?: number): string {
  const t = max === undefined ? s.trim() : cut(s, max);
  return neutralize(t.replace(/\s*\n\s*/g, " "));
}

function orNone(s: string): string {
  return s === "" ? NONE : s;
}

// 画面と予定は +09:00 で扱うので、日付も日本時間で出す。読めない値は先頭 10 字をそのまま使う
function ymd(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return neutralize(iso.slice(0, 10));
  return new Date(t + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function fieldText(p: PlanDraft, f: PlanField, max?: number): string {
  switch (f) {
    case "kpis": {
      const items = p.kpis
        .filter((k) => k.name.trim() !== "")
        .map((k) => (k.target.trim() ? `${user(k.name, max)} (${user(k.target, max)})` : user(k.name, max)));
      return items.join(" / ");
    }
    case "kdis": {
      const items = p.kdis
        .filter((k) => k.action.trim() !== "")
        .map((k) => {
          const when = [k.date, k.start && k.end ? `${k.start}〜${k.end}` : k.start].filter(Boolean).join(" ");
          return when ? `${user(k.action, max)} (${neutralize(when)})` : user(k.action, max);
        });
      return items.join(" / ");
    }
    default:
      return user(p[f], max);
  }
}

// 過去の周は長くなりやすいので、文で書く 4 欄だけを短く渡す
const CYCLE_FIELDS: PlanField[] = ["purpose", "kgi", "criteria", "deliverable"];

/** AI に渡す記録の文。件数と字数の上限で切り、本人の書いた文は neutralize する。 */
export function buildRecordsText(r: CoachRecords): string {
  const out: string[] = [];

  out.push("## プロジェクト");
  out.push(`- 名前: ${orNone(user(r.project.name))}`);
  out.push(`- 種類: ${orNone(user(categoryLabel(r.project.category)))}`);
  out.push(`- 目的: ${orNone(user(r.project.purpose))}`);

  out.push("", "## 今の Plan");
  for (const f of PLAN_FIELDS) out.push(`- ${PLAN_FIELD_LABEL[f]}: ${orNone(fieldText(r.plan, f))}`);

  out.push("", "## ノート (新しい順)");
  const notes = r.notes.slice(0, NOTES_LIMIT);
  if (notes.length === 0) out.push(NONE);
  for (const n of notes) {
    out.push(`- (${ymd(n.createdAt)}・${user(noteKindLabel(n.kind))}) ${orNone(user(n.body, NOTE_CHARS))}`);
  }

  out.push("", "## 過去の周 (新しい順)");
  const cycles = r.pastCycles.slice(0, PAST_CYCLES_LIMIT);
  if (cycles.length === 0) out.push(NONE);
  for (const c of cycles) {
    out.push(`- ${ymd(c.updatedAt)} 更新・段階: ${orNone(user(c.phase))}`);
    for (const f of CYCLE_FIELDS) {
      out.push(`  - ${PLAN_FIELD_LABEL[f]}: ${orNone(fieldText(c.plan, f, CYCLE_FIELD_CHARS))}`);
    }
  }

  return out.join("\n");
}

/** 実際に渡した件数 (上限で切った後)。[perf] の context_notes / context_cycles に使う。 */
export function recordCounts(r: CoachRecords): { notes: number; pastCycles: number } {
  return {
    notes: Math.min(r.notes.length, NOTES_LIMIT),
    pastCycles: Math.min(r.pastCycles.length, PAST_CYCLES_LIMIT),
  };
}
