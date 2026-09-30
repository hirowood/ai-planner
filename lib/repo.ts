// --- プロジェクトとノートの読み書き (EXP-008) ---
// すべての問い合わせは tagged template で、owner を必ずパラメータとして入れる (他人の行に触れない)。

import type { Sql } from "./db";
import type { Category, Note, NoteInput, NoteKind, Project, ProjectInput } from "./projects";

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
    category: r.category as Category, // schema の check 制約で 3 つのどれかに限られる
    purpose: String(r.purpose ?? ""),
    createdAt: toIso(r.created_at),
  };
}

function toNote(r: Row): Note {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    kind: r.kind as NoteKind, // schema の check 制約で 3 つのどれかに限られる
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
