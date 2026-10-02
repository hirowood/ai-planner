import { describe, expect, it } from "vitest";
import type { Sql } from "./db";
import { getLatestCycle, saveCycle } from "./repo";

const OWNER = "owner-canary-7b3d@example.com";
const PROJECT_ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b";
const CYCLE_ID = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const PLAN_CANARY = "canary-cycle-purpose-8f1c";
const T1 = "2026-09-30T01:02:03.000Z";
const T2 = "2026-09-30T02:03:04.000Z";

const PLAN = {
  purpose: PLAN_CANARY,
  kgi: "10 月末に 5km 歩ける",
  kpis: [{ name: "歩いた日数", target: "週 5 日" }],
  kdis: [{ action: "朝の散歩", date: "2026-10-01", start: "07:00", end: "07:30" }],
  criteria: "3 週続けば成功",
  deliverable: "記録表",
};

type Call = { strings: string[]; values: unknown[] };

// 偽の sql。tagged template の strings と values を記録し、決めた行を返す。
function fakeSql(rows: Record<string, unknown>[]) {
  const calls: Call[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ strings: [...strings], values });
    return rows;
  }) as Sql;
  return { sql, calls };
}

// 列名は snake_case と camelCase の両方。plan は jsonb としてオブジェクトで届く (文字列でも受ける)
function cycleRow(plan: unknown = PLAN, phase = "plan") {
  return {
    id: CYCLE_ID,
    owner: OWNER,
    project_id: PROJECT_ID,
    projectId: PROJECT_ID,
    phase,
    plan,
    created_at: T1,
    createdAt: T1,
    updated_at: T2,
    updatedAt: T2,
  };
}

const EXPECTED = { id: CYCLE_ID, projectId: PROJECT_ID, phase: "plan", plan: PLAN, createdAt: T1, updatedAt: T2 };

// owner の値の直前の文字列片が `owner =` で終わる = owner で絞っている (EXP-008 L2 と同じ検査)
function ownerFilterSlots(call: Call): number[] {
  return call.values
    .map((v, i) => (v === OWNER && /owner\s*=\s*$/i.test(call.strings[i]) ? i : -1))
    .filter((i) => i >= 0);
}

// owner の絞り込みが `from projects` の問い合わせ (副問い合わせ・別の問い合わせのどちらでも) の中にある
function ownerFilteredOnProjects(call: Call): boolean {
  return ownerFilterSlots(call).some((i) => {
    const prefix = call.strings.slice(0, i + 1).join("${}");
    const from = [...prefix.matchAll(/from\s+projects\b/gi)].pop();
    if (!from) return false;
    const segment = prefix.slice(from.index! + from[0].length);
    return !segment.includes(")") && /\bwhere\b[\s\S]*owner\s*=\s*$/i.test(segment);
  });
}

// すべての問い合わせで owner はパラメータ (SQL の文字列に埋め込まない)・すべての問い合わせで絞り込みに使う
function expectOwnerFiltersEveryQuery(calls: Call[]) {
  expect(calls.length).toBeGreaterThan(0);
  for (const c of calls) {
    expect(c.values).toContain(OWNER);
    expect(c.strings.join("")).not.toContain(OWNER);
    expect(ownerFilterSlots(c).length, `owner で絞っていない問い合わせ: ${c.strings.join("${}")}`).toBeGreaterThan(0);
  }
}

function expectPlanNotInSqlText(calls: Call[]) {
  expect(calls.map((c) => c.strings.join("")).join("")).not.toContain(PLAN_CANARY);
}

describe("getLatestCycle (EXP-009 L5)", () => {
  it("owner と projectId がパラメータ・全問い合わせを owner で絞る (EXP-009 L5)", async () => {
    const { sql, calls } = fakeSql([cycleRow()]);
    await getLatestCycle(sql, OWNER, PROJECT_ID);
    expectOwnerFiltersEveryQuery(calls);
    expect(calls.flatMap((c) => c.values)).toContain(PROJECT_ID);
  });

  it("Cycle の形で返す (EXP-009 L5)", async () => {
    const { sql } = fakeSql([cycleRow()]);
    expect(await getLatestCycle(sql, OWNER, PROJECT_ID)).toEqual(EXPECTED);
  });

  it("plan が JSON の文字列で届いてもオブジェクトにする (EXP-009 L5)", async () => {
    const { sql } = fakeSql([cycleRow(JSON.stringify(PLAN))]);
    expect((await getLatestCycle(sql, OWNER, PROJECT_ID))?.plan).toEqual(PLAN);
  });

  it("行が無ければ null (EXP-009 L5)", async () => {
    const { sql, calls } = fakeSql([]);
    expect(await getLatestCycle(sql, OWNER, PROJECT_ID)).toBeNull();
    expectOwnerFiltersEveryQuery(calls);
  });
});

describe("saveCycle (EXP-009 L5)", () => {
  const create = { projectId: PROJECT_ID, plan: PLAN, phase: "plan" as const };
  const update = { ...create, cycleId: CYCLE_ID };

  it("作成: 全問い合わせを owner で絞り、projects の owner を確かめる (EXP-009 L5)", async () => {
    const { sql, calls } = fakeSql([cycleRow()]);
    await saveCycle(sql, OWNER, create);
    expectOwnerFiltersEveryQuery(calls);
    expect(calls.some(ownerFilteredOnProjects)).toBe(true);
    expect(calls.flatMap((c) => c.values)).toEqual(expect.arrayContaining([PROJECT_ID, "plan"]));
    expectPlanNotInSqlText(calls);
  });

  it("作成: 自分のプロジェクトなら Cycle を返す (EXP-009 L5)", async () => {
    const { sql } = fakeSql([cycleRow()]);
    expect(await saveCycle(sql, OWNER, create)).toEqual(EXPECTED);
  });

  it("更新: 全問い合わせを owner で絞り、cycleId がパラメータ (EXP-009 L5)", async () => {
    const { sql, calls } = fakeSql([cycleRow(PLAN, "do")]);
    const cycle = await saveCycle(sql, OWNER, { ...update, phase: "do" });
    expectOwnerFiltersEveryQuery(calls);
    expect(calls.flatMap((c) => c.values)).toEqual(expect.arrayContaining([CYCLE_ID, "do"]));
    expectPlanNotInSqlText(calls);
    expect(cycle).toEqual({ ...EXPECTED, phase: "do" });
  });

  it.each([
    ["他人・無いプロジェクトへの作成", create],
    ["他人・無い cycle の更新", update],
  ])("%s (行が返らない) は null (EXP-009 L5)", async (_label, input) => {
    const { sql, calls } = fakeSql([]);
    expect(await saveCycle(sql, OWNER, input)).toBeNull();
    expectOwnerFiltersEveryQuery(calls);
  });

  it("検査自体の判別力: owner を挿入値にだけ使う問い合わせは絞り込みと見なさない (EXP-009 L5)", () => {
    const insertOnly: Call = {
      strings: ["insert into cycles (owner, project_id, plan) values (", ", ", ", ", ")"],
      values: [OWNER, PROJECT_ID, JSON.stringify(PLAN)],
    };
    const filtered: Call = {
      strings: ["insert into cycles (owner, project_id) select ", ", id from projects where id = ", " and owner = ", ""],
      values: [OWNER, PROJECT_ID, OWNER],
    };
    expect(ownerFilterSlots(insertOnly)).toEqual([]);
    expect(ownerFilteredOnProjects(insertOnly)).toBe(false);
    expect(ownerFilteredOnProjects(filtered)).toBe(true);
  });
});
