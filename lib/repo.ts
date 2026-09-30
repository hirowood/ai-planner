// --- プロジェクトとノートの読み書き (EXP-008) ---
// すべての問い合わせは tagged template で、owner を必ずパラメータとして入れる (他人の行に触れない)。

import type { Sql } from "./db";
import type { Category, Note, NoteInput, NoteKind, Project, ProjectInput } from "./projects";
import { EMPTY_PLAN, parsePlanDraft, type PlanDraft } from "./pdca-plan";

type Row = Record<string, unknown>;

/** timestamptz は driver の設定で Date か文字列で届く。どちらでも ISO 文字列にする。 */
function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return new Date(String(v)).toISOString();
}

function toProject(r: Row): Project {
  return {
    id: String(r.id),
    name: String(r.name),
    category: String(r.category) as Category, // 既定の値か自由入力の名前 (EXP-012・字数は API の検査で守る)
    purpose: String(r.purpose ?? ""),
    createdAt: toIso(r.created_at),
  };
}

function toNote(r: Row): Note {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    kind: String(r.kind) as NoteKind, // 既定の値か自由入力の名前 (EXP-012)
    body: String(r.body),
    createdAt: toIso(r.created_at),
  };
}

/** 持ち主の (しまっていない) プロジェクトを新しい順に返す。 */
export async function listProjects(sql: Sql, owner: string): Promise<Project[]> {
  const rows = await sql`
    select id, name, category, purpose, created_at from projects
    where owner = ${owner} and archived_at is null
    order by created_at desc
  `;
  return rows.map(toProject);
}

export async function createProject(sql: Sql, owner: string, input: ProjectInput): Promise<Project> {
  const rows = await sql`
    insert into projects (owner, name, category, purpose)
    values (${owner}, ${input.name}, ${input.category}, ${input.purpose})
    returning id, name, category, purpose, created_at
  `;
  if (rows.length === 0) throw new Error("insert into projects returned no row");
  return toProject(rows[0]);
}

/** 持ち主のプロジェクトのノートを新しい順に返す。 */
export async function listNotes(sql: Sql, owner: string, projectId: string): Promise<Note[]> {
  const rows = await sql`
    select id, project_id, kind, body, created_at from notes
    where owner = ${owner} and project_id = ${projectId}
    order by created_at desc
  `;
  return rows.map(toNote);
}

/** プロジェクトが owner のもの (しまっていない) のときだけ作る。そうでなければ null。 */
export async function createNote(sql: Sql, owner: string, input: NoteInput): Promise<Note | null> {
  const rows = await sql`
    insert into notes (owner, project_id, kind, body)
    select ${owner}, ${input.projectId}, ${input.kind}, ${input.body}
    where exists (
      select 1 from projects
      where id = ${input.projectId} and owner = ${owner} and archived_at is null
    )
    returning id, project_id, kind, body, created_at
  `;
  return rows.length > 0 ? toNote(rows[0]) : null;
}

/** owner のノートを消せたら true。他人・無いノートは false。 */
export async function deleteNote(sql: Sql, owner: string, id: string): Promise<boolean> {
  const rows = await sql`
    delete from notes where id = ${id} and owner = ${owner}
    returning id
  `;
  return rows.length > 0;
}

// --- PDCA の cycle (EXP-009) ---

export type Cycle = {
  id: string;
  projectId: string;
  phase: "plan" | "do";
  plan: PlanDraft;
  createdAt: string;
  updatedAt: string;
};

export type CycleInput = {
  projectId: string;
  cycleId?: string;
  plan: PlanDraft;
  phase: "plan" | "do";
};

function emptyPlan(): PlanDraft {
  return { ...EMPTY_PLAN, kpis: [], kdis: [] };
}

/** jsonb は driver により object か JSON 文字列で届く。どちらでも PlanDraft にする (読めなければ空)。 */
function toPlan(v: unknown): PlanDraft {
  let raw: unknown = v;
  if (typeof v === "string") {
    try {
      raw = JSON.parse(v);
    } catch {
      raw = null;
    }
  }
  return parsePlanDraft(raw) ?? emptyPlan();
}

function toCycle(r: Row): Cycle {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    phase: r.phase === "do" ? "do" : "plan",
    plan: toPlan(r.plan),
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

/** 持ち主のプロジェクトの最新の cycle (updated_at が新しい 1 件)。無ければ null。 */
export async function getLatestCycle(sql: Sql, owner: string, projectId: string): Promise<Cycle | null> {
  const rows = await sql`
    select id, project_id, phase, plan, created_at, updated_at from cycles
    where owner = ${owner} and project_id = ${projectId}
    order by updated_at desc
    limit 1
  `;
  return rows.length > 0 ? toCycle(rows[0]) : null;
}

/**
 * cycleId が無ければ作る (プロジェクトが owner のものの時だけ)。あれば owner・プロジェクトの一致する cycle を更新する。
 * どちらも対象が無ければ null (他人・無い)。
 */
export async function saveCycle(sql: Sql, owner: string, input: CycleInput): Promise<Cycle | null> {
  const planJson = JSON.stringify(input.plan);
  if (input.cycleId === undefined) {
    const rows = await sql`
      insert into cycles (owner, project_id, phase, plan)
      select ${owner}, ${input.projectId}, ${input.phase}, ${planJson}::jsonb
      where exists (
        select 1 from projects
        where id = ${input.projectId} and owner = ${owner} and archived_at is null
      )
      returning id, project_id, phase, plan, created_at, updated_at
    `;
    return rows.length > 0 ? toCycle(rows[0]) : null;
  }
  const rows = await sql`
    update cycles set plan = ${planJson}::jsonb, phase = ${input.phase}, updated_at = now()
    where id = ${input.cycleId} and owner = ${owner} and project_id = ${input.projectId}
    returning id, project_id, phase, plan, created_at, updated_at
  `;
  return rows.length > 0 ? toCycle(rows[0]) : null;
}
