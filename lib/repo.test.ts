import { describe, expect, it } from "vitest";
import type { Sql } from "./db";
import { createNote, createProject, deleteNote, listNotes, listProjects } from "./repo";

const OWNER = "owner-canary-4c1a@example.com";
const PROJECT_ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b";
const NOTE_ID = "9d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6";
const T1 = "2026-09-30T01:02:03.000Z";
const T2 = "2026-09-29T01:02:03.000Z";

type Call = { strings: string[]; values: unknown[] };

// 偽の sql。tagged template の strings と values を記録し、決めた行を返す。
// 列名は snake_case と camelCase の両方を入れる (実装がどちらで読んでもよい)。
function fakeSql(rows: Record<string, unknown>[] | ((call: Call) => Record<string, unknown>[])) {
  const calls: Call[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call = { strings: [...strings], values };
    calls.push(call);
    return typeof rows === "function" ? rows(call) : rows;
  }) as Sql;
  return { sql, calls };
}

function projectRow(id: string, name: string, createdAt: string) {
  return { id, owner: OWNER, name, category: "habit", purpose: "毎日歩く", created_at: createdAt, createdAt };
}

function noteRow(id: string, body: string, createdAt: string) {
  return {
    id,
    owner: OWNER,
    project_id: PROJECT_ID,
    projectId: PROJECT_ID,
    kind: "fact",
    body,
    created_at: createdAt,
    createdAt,
  };
}

// すべての問い合わせで owner は値 (パラメータ) にあり、SQL の文字列には埋め込まれていない
function expectOwnerParameterized(calls: Call[]) {
  expect(calls.length).toBeGreaterThan(0);
  for (const c of calls) {
    expect(c.values).toContain(OWNER);
    expect(c.strings.join("")).not.toContain(OWNER);
  }
}

// owner の値の直前の文字列片が `owner =` で終わる = owner で絞っている (挿入する値としてだけ使っていない)
function ownerFilterSlots(call: Call): number[] {
  return call.values
    .map((v, i) => (v === OWNER && /owner\s*=\s*$/i.test(call.strings[i]) ? i : -1))
    .filter((i) => i >= 0);
}

// owner の絞り込みが `from projects` の問い合わせ (exists の副問い合わせ) の中にある
function ownerFilteredOnProjects(call: Call): boolean {
  return ownerFilterSlots(call).some((i) => {
    const prefix = call.strings.slice(0, i + 1).join("${}");
    const from = [...prefix.matchAll(/from\s+projects\b/gi)].pop();
    if (!from) return false;
    const segment = prefix.slice(from.index! + from[0].length);
    // 副問い合わせを閉じずに where … owner = に届いている
    return !segment.includes(")") && /\bwhere\b[\s\S]*owner\s*=\s*$/i.test(segment);
  });
}

describe("lib/repo — owner は絞り込みに使う (EXP-008 L2)", () => {
  const noteInput = { projectId: PROJECT_ID, kind: "fact" as const, body: "30 分歩いた" };

  it.each([
    ["listProjects", (sql: Sql) => listProjects(sql, OWNER)],
    ["listNotes", (sql: Sql) => listNotes(sql, OWNER, PROJECT_ID)],
    ["deleteNote", (sql: Sql) => deleteNote(sql, OWNER, NOTE_ID)],
    ["createNote", (sql: Sql) => createNote(sql, OWNER, noteInput)],
  ] as const)("%s: owner の値が `owner =` の直後に来る問い合わせがある (EXP-008 L2)", async (_name, run) => {
    const { sql, calls } = fakeSql([noteRow(NOTE_ID, noteInput.body, T1)]);
    await run(sql);
    expect(calls.some((c) => ownerFilterSlots(c).length > 0)).toBe(true);
  });

  it("createNote: owner の絞り込みは projects の副問い合わせの中にある (EXP-008 L2)", async () => {
    const { sql, calls } = fakeSql([noteRow(NOTE_ID, noteInput.body, T1)]);
    await createNote(sql, OWNER, noteInput);
    expect(calls.some(ownerFilteredOnProjects)).toBe(true);
  });

  it("検査自体の判別力: owner を挿入値にだけ使う問い合わせは絞り込みと見なさない (EXP-008 L2)", () => {
    const insertOnly: Call = {
      strings: ["insert into notes (owner, project_id) select ", ", ", " where exists (select 1 from projects where id = ", ")"],
      values: [OWNER, PROJECT_ID, PROJECT_ID],
    };
    const filtered: Call = {
      strings: ["insert into notes (owner) select ", " where exists (select 1 from projects\n where id = ", " and owner =\n ", ")"],
      values: [OWNER, PROJECT_ID, OWNER],
    };
    expect(ownerFilterSlots(insertOnly)).toEqual([]);
    expect(ownerFilteredOnProjects(insertOnly)).toBe(false);
    expect(ownerFilteredOnProjects(filtered)).toBe(true);
  });
});

describe("lib/repo — 持ち主 (EXP-008 L2)", () => {
  it("listProjects: owner がパラメータ・Project の形で返す (EXP-008 L2)", async () => {
    const { sql, calls } = fakeSql([projectRow("p1", "散歩", T1), projectRow("p2", "英語", T2)]);
    const projects = await listProjects(sql, OWNER);
    expectOwnerParameterized(calls);
    expect(projects).toEqual([
      { id: "p1", name: "散歩", category: "habit", purpose: "毎日歩く", createdAt: T1 },
      { id: "p2", name: "英語", category: "habit", purpose: "毎日歩く", createdAt: T2 },
    ]);
  });

  it("listProjects: 行が無ければ空の配列 (EXP-008 L2)", async () => {
    const { sql, calls } = fakeSql([]);
    expect(await listProjects(sql, OWNER)).toEqual([]);
    expectOwnerParameterized(calls);
  });

  it("createProject: owner と入力がパラメータ・作った Project を返す (EXP-008 L2)", async () => {
    const input = { name: "朝の散歩", category: "habit" as const, purpose: "毎日歩く" };
    const { sql, calls } = fakeSql([projectRow(PROJECT_ID, input.name, T1)]);
    const project = await createProject(sql, OWNER, input);
    expectOwnerParameterized(calls);
    const values = calls.flatMap((c) => c.values);
    expect(values).toEqual(expect.arrayContaining([input.name, input.category, input.purpose]));
    expect(calls.map((c) => c.strings.join("")).join("")).not.toContain(input.name);
    expect(project).toEqual({ ...input, id: PROJECT_ID, createdAt: T1 });
  });

  it("listNotes: owner と projectId がパラメータ・Note の形で返す (EXP-008 L2)", async () => {
    const { sql, calls } = fakeSql([noteRow("n1", "30 分歩いた", T1), noteRow("n2", "体重 60kg", T2)]);
    const notes = await listNotes(sql, OWNER, PROJECT_ID);
    expectOwnerParameterized(calls);
    expect(calls.flatMap((c) => c.values)).toContain(PROJECT_ID);
    expect(notes).toEqual([
      { id: "n1", projectId: PROJECT_ID, kind: "fact", body: "30 分歩いた", createdAt: T1 },
      { id: "n2", projectId: PROJECT_ID, kind: "fact", body: "体重 60kg", createdAt: T2 },
    ]);
  });

  it("createNote: 自分のプロジェクトなら Note を返す (EXP-008 L2)", async () => {
    const input = { projectId: PROJECT_ID, kind: "fact" as const, body: "30 分歩いた" };
    const { sql, calls } = fakeSql([noteRow(NOTE_ID, input.body, T1)]);
    const note = await createNote(sql, OWNER, input);
    expectOwnerParameterized(calls);
    expect(calls.flatMap((c) => c.values)).toEqual(expect.arrayContaining([PROJECT_ID, input.kind, input.body]));
    expect(calls.map((c) => c.strings.join("")).join("")).not.toContain(input.body);
    expect(note).toEqual({ ...input, id: NOTE_ID, createdAt: T1 });
  });

  it("createNote: 他人・無いプロジェクト (行が返らない) は null (EXP-008 L2)", async () => {
    const { sql, calls } = fakeSql([]);
    const note = await createNote(sql, OWNER, { projectId: PROJECT_ID, kind: "data", body: "x" });
    expect(note).toBeNull();
    expectOwnerParameterized(calls);
  });

  it("deleteNote: 自分のノートを消せたら true (EXP-008 L2)", async () => {
    const { sql, calls } = fakeSql([{ id: NOTE_ID }]);
    expect(await deleteNote(sql, OWNER, NOTE_ID)).toBe(true);
    expectOwnerParameterized(calls);
    expect(calls.flatMap((c) => c.values)).toContain(NOTE_ID);
  });

  it("deleteNote: 他人のノート (行が返らない) は false (EXP-008 L2)", async () => {
    const { sql, calls } = fakeSql([]);
    expect(await deleteNote(sql, OWNER, NOTE_ID)).toBe(false);
    expectOwnerParameterized(calls);
  });
});
