// --- プロジェクトとノートの読み書き (EXP-008) ---
// すべての問い合わせは tagged template で、owner を必ずパラメータとして入れる (他人の行に触れない)。

import type { Sql } from "./db";
import type { Category, Note, NoteInput, NoteKind, Project, ProjectInput } from "./projects";
import { EMPTY_PLAN, parsePlanDraft, type PlanDraft } from "./pdca-plan";
import type { PastProject } from "./setup-start";
import type { ItemEvent } from "./todo-event";
import { DAILY_LIMIT, type DailyInput, type DailyLog, type DailyMark } from "./daily";
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
/** KGI はプロジェクトに 1 つ (EXP-026)。もう KGI があるところへ 2 つ目を作ろうとしたらこれを返す。 */
export const KGI_EXISTS = "kgi_exists" as const;

export async function createItem(sql: Sql, owner: string, input: ItemInput): Promise<PlanItem | null | typeof KGI_EXISTS> {
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
      and not exists (
        select 1 from plan_items
        where project_id = ${input.projectId} and owner = ${owner} and level = 'kgi'
      )
      returning id, project_id, parent_id, level, title, target, due_date, status, created_at, updated_at
    `;
    if (rows.length > 0) return toItem(rows[0]);
    // 作れなかった理由が「もう KGI がある」なら、無い・他人と区別して返す
    // プロジェクトが owner のもので、その中に KGI があるときだけ「もうある」とする (他人のプロジェクトは null のまま)
    const existing = await sql`
      select 1 from plan_items i
      join projects p on p.id = i.project_id
      where i.project_id = ${input.projectId} and i.owner = ${owner} and i.level = 'kgi'
        and p.owner = ${owner} and p.archived_at is null
    `;
    return existing.length > 0 ? KGI_EXISTS : null;
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

// --- 過去のプロジェクトの傾向 (EXP-027) ---

/** owner のプロジェクト (新しい順) と、その KGI の題と状態・階層の状態ごとの件数。すべて owner で絞る。 */
export async function listPastProjects(sql: Sql, owner: string, limit: number): Promise<PastProject[]> {
  const rows = await sql`
    select p.id, p.name, p.category, p.purpose,
      (select k.title from plan_items k where k.project_id = p.id and k.owner = ${owner} and k.level = 'kgi' limit 1) as kgi_title,
      (select k.status from plan_items k where k.project_id = p.id and k.owner = ${owner} and k.level = 'kgi' limit 1) as kgi_status,
      (select count(*) from plan_items i where i.project_id = p.id and i.owner = ${owner} and i.status = 'todo') as c_todo,
      (select count(*) from plan_items i where i.project_id = p.id and i.owner = ${owner} and i.status = 'done') as c_done,
      (select count(*) from plan_items i where i.project_id = p.id and i.owner = ${owner} and i.status = 'shelved') as c_shelved,
      (select count(*) from plan_items i where i.project_id = p.id and i.owner = ${owner} and i.status = 'failed') as c_failed,
      (select count(*) from plan_items i where i.project_id = p.id and i.owner = ${owner} and i.status = 'succeeded') as c_succeeded,
      (select count(*) from plan_items i where i.project_id = p.id and i.owner = ${owner} and i.status = 'adjusted') as c_adjusted
    from projects p
    where p.owner = ${owner} and p.archived_at is null
    order by p.created_at desc
    limit ${limit}
  `;
  const n = (v: unknown) => Number(v ?? 0) || 0;
  return rows.map((r) => ({
    name: String(r.name ?? ""),
    category: String(r.category ?? ""),
    purpose: String(r.purpose ?? ""),
    kgiTitle: r.kgi_title == null ? null : String(r.kgi_title),
    kgiStatus: r.kgi_status == null ? null : String(r.kgi_status),
    counts: {
      todo: n(r.c_todo), done: n(r.c_done), shelved: n(r.c_shelved),
      failed: n(r.c_failed), succeeded: n(r.c_succeeded), adjusted: n(r.c_adjusted),
    },
  }));
}


// --- 1 日の記録 (EXP-020) ---

function toGoods(v: unknown): string[] {
  let x: unknown = v;
  if (typeof v === "string") {
    try {
      x = JSON.parse(v);
    } catch {
      return [];
    }
  }
  return Array.isArray(x) ? x.filter((g): g is string => typeof g === "string") : [];
}

function toDailyLog(r: Row): DailyLog {
  return {
    projectId: String(r.project_id),
    day: toDateOnly(r.day),
    mark: String(r.mark) as DailyMark,
    goods: toGoods(r.goods),
    tomorrow: String(r.tomorrow ?? ""),
    updatedAt: toIso(r.updated_at),
  };
}

/** 持ち主のプロジェクトの最近の記録 (新しい日から limit 件)。 */
export async function listDailyLogs(sql: Sql, owner: string, projectId: string, limit: number = DAILY_LIMIT): Promise<DailyLog[]> {
  const rows = await sql`
    select project_id, day, mark, goods, tomorrow, updated_at from daily_logs
    where owner = ${owner} and project_id = ${projectId}
    order by day desc
    limit ${limit}
  `;
  return rows.map(toDailyLog);
}

/** 持ち主のプロジェクト (しまっていない) のときだけ、その日の記録を作るか上書きする。合わなければ null。 */
export async function upsertDailyLog(sql: Sql, owner: string, input: DailyInput): Promise<DailyLog | null> {
  const goodsJson = JSON.stringify(input.goods);
  const rows = await sql`
    insert into daily_logs (owner, project_id, day, mark, goods, tomorrow)
    select ${owner}, ${input.projectId}, ${input.day}::date, ${input.mark}, ${goodsJson}::jsonb, ${input.tomorrow}
    where exists (
      select 1 from projects
      where id = ${input.projectId} and owner = ${owner} and archived_at is null
    )
    on conflict (owner, project_id, day) do update
      set mark = excluded.mark, goods = excluded.goods, tomorrow = excluded.tomorrow, updated_at = now()
    returning project_id, day, mark, goods, tomorrow, updated_at
  `;
  return rows.length > 0 ? toDailyLog(rows[0]) : null;
}

// --- ToDo の予定 (EXP-030) ---

export const EVENT_PENDING = "pending";
/** 予定の枠を取れなかった理由。 */
export const SCHEDULE_NOT_TODO = "not_todo" as const;
export const SCHEDULE_EXISTS = "exists" as const;

/** 持ち主の項目を 1 つ読む (無い・他人は null)。 */
export async function getItem(sql: Sql, owner: string, id: string): Promise<PlanItem | null> {
  const rows = await sql`
    select id, project_id, parent_id, level, title, target, due_date, status, created_at, updated_at from plan_items
    where id = ${id} and owner = ${owner}
  `;
  return rows.length > 0 ? toItem(rows[0]) : null;
}

/**
 * 予定を作る前に枠を取る (同じ ToDo に 2 つ作らない)。持ち主の期日つき ToDo のときだけ取れる。
 * 取れたら true・もう予定がある → SCHEDULE_EXISTS・ToDo でない / 期日が無い → SCHEDULE_NOT_TODO・無い / 他人 → null。
 */
export async function claimItemEvent(
  sql: Sql,
  owner: string,
  itemId: string,
  start: string,
  end: string,
): Promise<true | null | typeof SCHEDULE_NOT_TODO | typeof SCHEDULE_EXISTS> {
  const rows = await sql`
    insert into item_events (item_id, owner, event_id, start_time, end_time)
    select ${itemId}, ${owner}, ${EVENT_PENDING}, ${start}, ${end}
    where exists (
      select 1 from plan_items
      where id = ${itemId} and owner = ${owner} and level = 'todo' and due_date is not null
    )
    on conflict (item_id) do update
      set start_time = excluded.start_time, end_time = excluded.end_time, created_at = now()
      -- 作る途中で止まった枠 (2 分より古い pending) だけは取り直せる。作り終えた予定は上書きしない
      where item_events.event_id = ${EVENT_PENDING} and item_events.created_at < now() - interval '2 minutes'
    returning item_id
  `;
  if (rows.length > 0) return true;
  const item = await getItem(sql, owner, itemId);
  if (!item) return null;
  if (item.level !== "todo" || item.dueDate === "") return SCHEDULE_NOT_TODO;
  return SCHEDULE_EXISTS;
}

/** Google に作れたら event_id を入れる。 */
export async function confirmItemEvent(sql: Sql, owner: string, itemId: string, eventId: string): Promise<void> {
  await sql`
    update item_events set event_id = ${eventId}
    where item_id = ${itemId} and owner = ${owner} and event_id = ${EVENT_PENDING}
  `;
}

/** Google で作れなかったら取った枠を返す。 */
export async function releaseItemEvent(sql: Sql, owner: string, itemId: string): Promise<void> {
  await sql`
    delete from item_events
    where item_id = ${itemId} and owner = ${owner} and event_id = ${EVENT_PENDING}
  `;
}

/** 持ち主のプロジェクトの予定の一覧 (作り終えたものだけ)。 */
export async function listItemEvents(sql: Sql, owner: string, projectId: string): Promise<ItemEvent[]> {
  const rows = await sql`
    select e.item_id, e.start_time, e.end_time from item_events e
    join plan_items i on i.id = e.item_id
    where e.owner = ${owner} and i.owner = ${owner} and i.project_id = ${projectId} and e.event_id <> ${EVENT_PENDING}
  `;
  return rows.map((r: Row) => ({ itemId: String(r.item_id), start: String(r.start_time ?? ""), end: String(r.end_time ?? "") }));
}
