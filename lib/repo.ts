// --- プロジェクトとノートの読み書き (EXP-008) ---
// すべての問い合わせは tagged template で、owner を必ずパラメータとして入れる (他人の行に触れない)。

import type { Sql } from "./db";
import type { Category, Note, NoteInput, NoteKind, Project, ProjectInput } from "./projects";
import { EMPTY_PLAN, parsePlanDraft, type PlanDraft } from "./pdca-plan";
import { HISTORY_LIMIT, type MessagesInput, type StoredMessage, type Thread } from "./messages";
import {
  CHILD_LEVEL,
  type ItemInput,
  type ItemLevel,
  type ItemPatch,
  type ItemStatus,
  type PlanItem,
} from "./plan-items";

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

/** 持ち主の (しまっていない) プロジェクトを 1 件返す。他人・無い・しまったものは null (EXP-016)。 */
export async function getProject(sql: Sql, owner: string, projectId: string): Promise<Project | null> {
  const rows = await sql`
    select id, name, category, purpose, created_at from projects
    where id = ${projectId} and owner = ${owner} and archived_at is null
    limit 1
  `;
  return rows.length > 0 ? toProject(rows[0]) : null;
}

/** 持ち主のプロジェクトのノートを新しい順に返す。limit を渡すとその件数まで (既定は上限なし)。 */
export async function listNotes(sql: Sql, owner: string, projectId: string, limit?: number): Promise<Note[]> {
  if (limit === undefined) {
    const rows = await sql`
      select id, project_id, kind, body, created_at from notes
      where owner = ${owner} and project_id = ${projectId}
      order by created_at desc
    `;
    return rows.map(toNote);
  }
  const n = Math.max(0, Math.floor(limit));
  if (n === 0) return [];
  const rows = await sql`
    select id, project_id, kind, body, created_at from notes
    where owner = ${owner} and project_id = ${projectId}
    order by created_at desc
    limit ${n}
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
 * 持ち主のプロジェクトの過去の cycle を新しい順 (updated_at) に limit 件返す (EXP-016)。
 * excludeId (今の周) は除く。null なら除かない。
 */
export async function listPastCycles(
  sql: Sql,
  owner: string,
  projectId: string,
  excludeId: string | null,
  limit: number,
): Promise<Cycle[]> {
  const n = Math.max(0, Math.floor(limit));
  if (n === 0) return [];
  const rows =
    excludeId === null
      ? await sql`
          select id, project_id, phase, plan, created_at, updated_at from cycles
          where owner = ${owner} and project_id = ${projectId}
          order by updated_at desc
          limit ${n}
        `
      : await sql`
          select id, project_id, phase, plan, created_at, updated_at from cycles
          where owner = ${owner} and project_id = ${projectId} and id <> ${excludeId}
          order by updated_at desc
          limit ${n}
        `;
  return rows.map(toCycle);
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

// --- 会話の保存と続きから (EXP-010) ---

function toMessage(r: Row): StoredMessage {
  return {
    id: String(r.id),
    role: r.role === "assistant" ? "assistant" : "user",
    content: String(r.content),
    createdAt: toIso(r.created_at),
  };
}

/** 持ち主のプロジェクトの thread の会話。新しい HISTORY_LIMIT 件を古い順に返す。 */
export async function listMessages(sql: Sql, owner: string, projectId: string, thread: Thread): Promise<StoredMessage[]> {
  const rows = await sql`
    select id, role, content, created_at from messages
    where owner = ${owner} and project_id = ${projectId} and thread = ${thread}
    order by created_at desc, id desc
    limit ${HISTORY_LIMIT}
  `;
  return rows.map(toMessage).reverse();
}

/** プロジェクトが owner のもの (しまっていない) のときだけ会話を足す。入れた件数を返し、対象が無ければ null。 */
export async function appendMessages(sql: Sql, owner: string, input: MessagesInput): Promise<number | null> {
  const owned = await sql`
    select 1 from projects
    where id = ${input.projectId} and owner = ${owner} and archived_at is null
  `;
  if (owned.length === 0) return null;
  let count = 0;
  for (const [i, m] of input.messages.entries()) {
    // 同じ回の発言の順序を保つため、created_at を 1 ミリ秒ずつずらす
    const rows = await sql`
      insert into messages (owner, project_id, thread, role, content, created_at)
      select ${owner}, ${input.projectId}, ${input.thread}, ${m.role}, ${m.content}, now() + (${i}::int * interval '1 millisecond')
      where exists (
        select 1 from projects
        where id = ${input.projectId} and owner = ${owner} and archived_at is null
      )
      returning id
    `;
    count += rows.length;
  }
  // 途中でプロジェクトが他人のもの・しまわれた状態になった場合も対象なしとして扱う
  return count > 0 ? count : null;
}

// --- プロジェクトの中の階層 (EXP-017) ---

const pad2 = (n: number) => String(n).padStart(2, "0");

/** date 列は driver により "YYYY-MM-DD" の文字列か Date で届く。どちらでも "YYYY-MM-DD" に、null は "" にする。 */
function toDateOnly(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    // pg の date は端末の時刻の 0 時として Date になるので、端末の年月日で読む
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  }
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  return m ? m[1] : "";
}

function toItem(r: Row): PlanItem {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    parentId: r.parent_id === null || r.parent_id === undefined ? null : String(r.parent_id),
    level: String(r.level) as ItemLevel,
    title: String(r.title),
    target: String(r.target ?? ""),
    dueDate: toDateOnly(r.due_date),
    status: String(r.status) as ItemStatus,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

/** CHILD_LEVEL[親の段] が level になる段 (= 親に置ける段)。kgi は親を持たないので null。 */
function parentLevelOf(level: ItemLevel): ItemLevel | null {
  const found = (Object.keys(CHILD_LEVEL) as ItemLevel[]).find((l) => CHILD_LEVEL[l] === level);
  return found ?? null;
}

/** 持ち主のプロジェクトの階層の項目を古い順に返す。 */
export async function listItems(sql: Sql, owner: string, projectId: string): Promise<PlanItem[]> {
  const rows = await sql`
    select id, project_id, parent_id, level, title, target, due_date, status, created_at, updated_at from plan_items
    where owner = ${owner} and project_id = ${projectId}
    order by created_at asc, id asc
  `;
  return rows.map(toItem);
}

/**
 * プロジェクトが owner のもの (しまっていない) で、親があれば同じプロジェクトの owner の項目で
 * 親の段の子が input.level のときだけ作る。どれかが合わなければ null。
 */
export async function createItem(sql: Sql, owner: string, input: ItemInput): Promise<PlanItem | null> {
  const dueDate = input.dueDate === "" ? null : input.dueDate;
  const expectedParentLevel = parentLevelOf(input.level);
  if (input.parentId === null) {
    // 親なしで置けるのは kgi だけ
    if (expectedParentLevel !== null) return null;
    const rows = await sql`
      insert into plan_items (owner, project_id, parent_id, level, title, target, due_date, status)
      select ${owner}, ${input.projectId}, null, ${input.level}, ${input.title}, ${input.target}, ${dueDate}::date, ${input.status}
      where exists (
        select 1 from projects
        where id = ${input.projectId} and owner = ${owner} and archived_at is null
      )
      returning id, project_id, parent_id, level, title, target, due_date, status, created_at, updated_at
    `;
    return rows.length > 0 ? toItem(rows[0]) : null;
  }
  // kgi は親を持たない
  if (expectedParentLevel === null) return null;
  const rows = await sql`
    insert into plan_items (owner, project_id, parent_id, level, title, target, due_date, status)
    select ${owner}, ${input.projectId}, ${input.parentId}::uuid, ${input.level}, ${input.title}, ${input.target}, ${dueDate}::date, ${input.status}
    where exists (
      select 1 from projects
      where id = ${input.projectId} and owner = ${owner} and archived_at is null
    )
    and exists (
      select 1 from plan_items
      where id = ${input.parentId} and project_id = ${input.projectId} and owner = ${owner} and level = ${expectedParentLevel}
    )
    returning id, project_id, parent_id, level, title, target, due_date, status, created_at, updated_at
  `;
  return rows.length > 0 ? toItem(rows[0]) : null;
}

/** owner の項目の、patch にある項目だけを変えて updated_at を今にする。他人・無い項目は null。 */
/** KGI は決まったら動かさない (EXP-024)。KGI の title・target・dueDate の更新と、KGI の削除はこれを返す。 */
export const KGI_LOCKED = "kgi_locked" as const;

/** 持ち主の KGI か (固定で断った理由を、無い・他人と区別して返すため)。 */
async function isOwnedKgi(sql: Sql, owner: string, id: string): Promise<boolean> {
  const rows = await sql`
    select 1 from plan_items where id = ${id} and owner = ${owner} and level = 'kgi'
  `;
  return rows.length > 0;
}

export async function updateItem(
  sql: Sql,
  owner: string,
  id: string,
  patch: ItemPatch,
): Promise<PlanItem | null | typeof KGI_LOCKED> {
  // KGI で変えてよいのは status だけ (最後に成功 / 失敗を付けるため)
  const touchesLocked = patch.title !== undefined || patch.target !== undefined || patch.dueDate !== undefined;
  const hasDue = patch.dueDate !== undefined;
  const dueDate = patch.dueDate === undefined || patch.dueDate === "" ? null : patch.dueDate;
  const rows = await sql`
    update plan_items set
      title = coalesce(${patch.title ?? null}, title),
      target = coalesce(${patch.target ?? null}, target),
      status = coalesce(${patch.status ?? null}, status),
      due_date = case when ${hasDue}::boolean then ${dueDate}::date else due_date end,
      updated_at = now()
    where id = ${id} and owner = ${owner} and (level <> 'kgi' or not ${touchesLocked}::boolean)
    returning id, project_id, parent_id, level, title, target, due_date, status, created_at, updated_at
  `;
  if (rows.length > 0) return toItem(rows[0]);
  if (touchesLocked && (await isOwnedKgi(sql, owner, id))) return KGI_LOCKED;
  return null;
}

/** owner の項目を消せたら true (子も on delete cascade で消える)。他人・無い項目は false。 */
export async function deleteItem(sql: Sql, owner: string, id: string): Promise<boolean | typeof KGI_LOCKED> {
  const rows = await sql`
    delete from plan_items where id = ${id} and owner = ${owner} and level <> 'kgi'
    returning id
  `;
  if (rows.length > 0) return true;
  if (await isOwnedKgi(sql, owner, id)) return KGI_LOCKED;
  return false;
}
