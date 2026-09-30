import { describe, expect, it } from "vitest";
import type { Sql } from "./db";
import type { ItemInput, ItemLevel, PlanItem } from "./plan-items";
import { createItem, deleteItem, listItems, updateItem } from "./repo";

const OWNER = "owner-canary-7d2f@example.com";
const PROJECT_ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b";
const OTHER_PROJECT_ID = "8e7d6c5b-4a39-4281-9f0e-1d2c3b4a5f6e";
const PARENT_ID = "5b6c7d8e-1f2a-4b3c-8d4e-5f6a7b8c9d0e";
const ITEM_ID = "1a2b3c4d-0000-4a6b-8c7d-000000000011";
const ITEM2_ID = "1a2b3c4d-0000-4a6b-8c7d-000000000012";
const T1 = "2026-09-30T01:00:00.000Z";
const T2 = "2026-09-30T02:00:00.000Z";
const TITLE_CANARY = "canary-item-title-2b7e";
const TARGET_CANARY = "canary-item-target-9c1d";

type Call = { strings: string[]; values: unknown[] };
type Row = Record<string, unknown>;

function fakeSql(rows: Row[]) {
  const calls: Call[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ strings: [...strings], values });
    return rows;
  }) as Sql;
  return { sql, calls };
}

// 列名は snake_case と camelCase の両方 (実装がどちらで読んでもよい)
function itemRow(o: {
  id: string;
  level: ItemLevel;
  parentId?: string | null;
  projectId?: string;
  title?: string;
  target?: string;
  dueDate?: string | null;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}): Row {
  const projectId = o.projectId ?? PROJECT_ID;
  const parentId = o.parentId ?? null;
  const dueDate = o.dueDate === undefined ? "2026-10-31" : o.dueDate;
  const createdAt = o.createdAt ?? T1;
  const updatedAt = o.updatedAt ?? createdAt;
  return {
    id: o.id,
    owner: OWNER,
    project_id: projectId,
    projectId,
    parent_id: parentId,
    parentId,
    level: o.level,
    title: o.title ?? "t",
    target: o.target ?? "",
    due_date: dueDate,
    dueDate,
    status: o.status ?? "todo",
    created_at: createdAt,
    createdAt,
    updated_at: updatedAt,
    updatedAt,
  };
}

// owner の値の直前の文字列片が `owner =` で終わる = owner で絞っている
function ownerFilterSlots(call: Call): number[] {
  return call.values
    .map((v, i) => (v === OWNER && /owner\s*=\s*$/i.test(call.strings[i]) ? i : -1))
    .filter((i) => i >= 0);
}

function expectOwnerFiltersEveryQuery(calls: Call[]) {
  expect(calls.length).toBeGreaterThan(0);
  for (const c of calls) {
    expect(c.strings.join("")).not.toContain(OWNER);
    expect(ownerFilterSlots(c).length, `owner で絞っていない問い合わせ: ${c.strings.join("${}")}`).toBeGreaterThan(0);
  }
}

function expectNoCanaryInSqlText(calls: Call[], canaries: string[]) {
  const text = calls.map((c) => c.strings.join("")).join("");
  for (const canary of canaries) expect(text).not.toContain(canary);
}

// その段を子に持つ段 (CHILD_LEVEL の逆)
const PARENT_LEVEL_OF: Record<ItemLevel, ItemLevel | null> = { kgi: null, kpi: "kgi", kdi: "kpi", todo: "kdi" };

type Scenario =
  | { kind: "ok" }
  | { kind: "foreignProject" }
  | { kind: "foreignParent" }
  | { kind: "parentOtherProject" }
  | { kind: "levelMismatch"; actualParentLevel: ItemLevel };

/**
 * createItem 用の偽の sql。確認を 1 つの insert ... where exists にまとめても、別々の select で確かめてもよいように、
 * 問い合わせの中身で返す行を決める:
 * - projects を参照する問い合わせ: foreignProject なら行なし
 * - 親の id を値に含む問い合わせ: foreignParent なら行なし。parentOtherProject なら (プロジェクトでも絞っていれば行なし・
 *   そうでなければ別プロジェクトの親の行)。levelMismatch なら (必要な親の段で SQL の中で絞っていれば行なし・
 *   そうでなければ実際の段の親の行 = JS で比べる実装向け)
 * - insert: 作った行
 * 制約: 親の段の比較を SQL の CASE で input.level から導く実装は想定しない
 */
function fakeCreateSql(scenario: Scenario, input: ItemInput, created: Row) {
  const calls: Call[] = [];
  const requiredParentLevel = PARENT_LEVEL_OF[input.level];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ strings: [...strings], values });
    const text = strings.join(" ");
    const isInsert = /\binsert\b/i.test(text);
    const touchesProject = /\bprojects\b/i.test(text);
    const touchesParent = input.parentId !== null && values.includes(input.parentId);

    if (scenario.kind === "foreignProject" && touchesProject) return [];
    if (touchesParent) {
      if (scenario.kind === "foreignParent") return [];
      if (scenario.kind === "parentOtherProject") {
        if (values.includes(PROJECT_ID)) return [];
        if (!isInsert) return [itemRow({ id: PARENT_ID, level: requiredParentLevel ?? "kgi", projectId: OTHER_PROJECT_ID })];
      }
      if (scenario.kind === "levelMismatch") {
        if (requiredParentLevel !== null && values.includes(requiredParentLevel) && requiredParentLevel !== scenario.actualParentLevel) {
          return [];
        }
        if (!isInsert) return [itemRow({ id: PARENT_ID, level: scenario.actualParentLevel })];
      }
      if (scenario.kind === "ok" && !isInsert) return [itemRow({ id: PARENT_ID, level: requiredParentLevel ?? "kgi" })];
    }
    if (!isInsert && touchesProject) return [{ id: PROJECT_ID }];
    return [created];
  }) as Sql;
  return { sql, calls };
}

const kgiInput: ItemInput = {
  projectId: PROJECT_ID,
  parentId: null,
  level: "kgi",
  title: TITLE_CANARY,
  target: TARGET_CANARY,
  dueDate: "2026-10-31",
  status: "todo",
};
const kdiInput: ItemInput = { ...kgiInput, parentId: PARENT_ID, level: "kdi", dueDate: "" };

function expected(input: ItemInput, id = ITEM_ID): PlanItem {
  return {
    id,
    projectId: input.projectId,
    parentId: input.parentId,
    level: input.level,
    title: input.title,
    target: input.target,
    dueDate: input.dueDate,
    status: input.status,
    createdAt: T1,
    updatedAt: T1,
  };
}

function createdRow(input: ItemInput): Row {
  return itemRow({
    id: ITEM_ID,
    level: input.level,
    parentId: input.parentId,
    title: input.title,
    target: input.target,
    dueDate: input.dueDate === "" ? null : input.dueDate,
    status: input.status,
  });
}

describe("listItems (EXP-017 L3)", () => {
  const rows = [
    itemRow({ id: ITEM_ID, level: "kgi", title: TITLE_CANARY, target: TARGET_CANARY }),
    itemRow({ id: ITEM2_ID, level: "kpi", parentId: ITEM_ID, dueDate: null, status: "done", createdAt: T2 }),
  ];

  it("全問い合わせを owner で絞り、projectId はパラメータ (EXP-017 L3)", async () => {
    const { sql, calls } = fakeSql(rows);
    await listItems(sql, OWNER, PROJECT_ID);
    expectOwnerFiltersEveryQuery(calls);
    expect(calls.flatMap((c) => c.values)).toContain(PROJECT_ID);
    expectNoCanaryInSqlText(calls, [PROJECT_ID]);
  });

  it("行を PlanItem に変える (期日なしは \"\") (EXP-017 L3)", async () => {
    const { sql } = fakeSql(rows);
    const got = await listItems(sql, OWNER, PROJECT_ID);
    expect(got).toHaveLength(2);
    expect(got).toEqual(
      expect.arrayContaining([
        { ...expected(kgiInput), dueDate: "2026-10-31" },
        {
          id: ITEM2_ID, projectId: PROJECT_ID, parentId: ITEM_ID, level: "kpi", title: "t", target: "",
          dueDate: "", status: "done", createdAt: T2, updatedAt: T2,
        },
      ]),
    );
  });

  it("行が無ければ空の配列 (EXP-017 L3)", async () => {
    const { sql, calls } = fakeSql([]);
    expect(await listItems(sql, OWNER, PROJECT_ID)).toEqual([]);
    expectOwnerFiltersEveryQuery(calls);
  });
});

describe("createItem (EXP-017 L3)", () => {
  it.each([
    ["KGI (親なし)", kgiInput],
    ["KDI (KPI の親)", kdiInput],
  ])("自分のプロジェクトに作れる: %s・全問い合わせを owner で絞り・中身はパラメータ (EXP-017 L3)", async (_label, input) => {
    const { sql, calls } = fakeCreateSql({ kind: "ok" }, input, createdRow(input));
    expect(await createItem(sql, OWNER, input)).toEqual(expected(input));
    expectOwnerFiltersEveryQuery(calls);
    const values = calls.flatMap((c) => c.values);
    expect(values).toEqual(expect.arrayContaining([PROJECT_ID, TITLE_CANARY, TARGET_CANARY]));
    expectNoCanaryInSqlText(calls, [TITLE_CANARY, TARGET_CANARY, PROJECT_ID]);
  });

  it.each([
    ["KGI", kgiInput],
    ["KDI", kdiInput],
  ])("他人・無いプロジェクトは null: %s (EXP-017 L3)", async (_label, input) => {
    const { sql, calls } = fakeCreateSql({ kind: "foreignProject" }, input, createdRow(input));
    expect(await createItem(sql, OWNER, input)).toBeNull();
    expectOwnerFiltersEveryQuery(calls);
  });

  it("他人・無い親は null (EXP-017 L3)", async () => {
    const { sql, calls } = fakeCreateSql({ kind: "foreignParent" }, kdiInput, createdRow(kdiInput));
    expect(await createItem(sql, OWNER, kdiInput)).toBeNull();
    expectOwnerFiltersEveryQuery(calls);
  });

  it("別のプロジェクトの親は null (EXP-017 L3)", async () => {
    const { sql } = fakeCreateSql({ kind: "parentOtherProject" }, kdiInput, createdRow(kdiInput));
    expect(await createItem(sql, OWNER, kdiInput)).toBeNull();
  });

  it.each([
    { actual: "kgi" as const, level: "kdi" as const },
    { actual: "kdi" as const, level: "kdi" as const },
    { actual: "kpi" as const, level: "todo" as const },
    { actual: "todo" as const, level: "todo" as const },
  ])("親の段 $actual の CHILD_LEVEL が $level でなければ null (EXP-017 L3)", async ({ actual, level }) => {
    const input: ItemInput = { ...kdiInput, level };
    const { sql, calls } = fakeCreateSql({ kind: "levelMismatch", actualParentLevel: actual }, input, createdRow(input));
    expect(await createItem(sql, OWNER, input)).toBeNull();
    expectOwnerFiltersEveryQuery(calls);
  });

  it("偽の sql 自体の判別力: 確認をしない実装なら作った行が返る (EXP-017 L3)", async () => {
    const { sql } = fakeCreateSql({ kind: "levelMismatch", actualParentLevel: "kgi" }, kdiInput, createdRow(kdiInput));
    // 親を見ずに insert だけする問い合わせ
    const rows = await sql`insert into plan_items (owner, level) values (${OWNER}, ${"kdi"}) returning *`;
    expect(rows).toHaveLength(1);
  });
});

describe("updateItem (EXP-017 L3)", () => {
  it("owner で絞り・変える値はパラメータ・updated_at を更新する (EXP-017 L3)", async () => {
    const row = itemRow({ id: ITEM_ID, level: "kgi", title: TITLE_CANARY, status: "done", updatedAt: T2 });
    const { sql, calls } = fakeSql([row]);
    const got = await updateItem(sql, OWNER, ITEM_ID, { title: TITLE_CANARY, status: "done" });
    expect(got).toMatchObject({ id: ITEM_ID, title: TITLE_CANARY, status: "done", updatedAt: T2 });
    expectOwnerFiltersEveryQuery(calls);
    const values = calls.flatMap((c) => c.values);
    expect(values).toEqual(expect.arrayContaining([ITEM_ID, TITLE_CANARY, "done"]));
    expectNoCanaryInSqlText(calls, [TITLE_CANARY, ITEM_ID]);
    expect(calls.map((c) => c.strings.join("")).join("")).toMatch(/updated_at/i);
  });

  it("他人・無い項目 (行が返らない) は null (EXP-017 L3)", async () => {
    const { sql, calls } = fakeSql([]);
    expect(await updateItem(sql, OWNER, ITEM_ID, { status: "failed" })).toBeNull();
    expectOwnerFiltersEveryQuery(calls);
  });
});

describe("deleteItem (EXP-017 L3)", () => {
  it("owner の項目を消せたら true (EXP-017 L3)", async () => {
    const { sql, calls } = fakeSql([{ id: ITEM_ID }]);
    expect(await deleteItem(sql, OWNER, ITEM_ID)).toBe(true);
    expectOwnerFiltersEveryQuery(calls);
    expect(calls.flatMap((c) => c.values)).toContain(ITEM_ID);
  });

  it("他人・無い項目 (行が返らない) は false (EXP-017 L3)", async () => {
    const { sql, calls } = fakeSql([]);
    expect(await deleteItem(sql, OWNER, ITEM_ID)).toBe(false);
    expectOwnerFiltersEveryQuery(calls);
  });
});
