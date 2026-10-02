import { describe, expect, it } from "vitest";
import type { Sql } from "./db";
import type { MessagesInput } from "./messages";
import { appendMessages, listMessages } from "./repo";

const OWNER = "owner-canary-4c9e@example.com";
const PROJECT_ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b";
const M1 = "1a2b3c4d-0000-4a6b-8c7d-000000000001";
const M2 = "1a2b3c4d-0000-4a6b-8c7d-000000000002";
const M3 = "1a2b3c4d-0000-4a6b-8c7d-000000000003";
const T1 = "2026-09-30T01:00:00.000Z";
const T2 = "2026-09-30T02:00:00.000Z";
const T3 = "2026-09-30T03:00:00.000Z";
const CONTENT_CANARY = "canary-message-content-6d1a";

type Call = { strings: string[]; values: unknown[] };

function fakeSql(rows: Record<string, unknown>[]) {
  const calls: Call[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ strings: [...strings], values });
    return rows;
  }) as Sql;
  return { sql, calls };
}

// 追加用の偽の sql。insert には、その問い合わせの値に含まれる発言の数だけ行を返す
// (1 件ずつ入れても、まとめて入れても、返った行の数が入れた件数と一致する)。それ以外には rows を返す
function fakeAppendSql(rows: Record<string, unknown>[], contents: string[]) {
  const calls: Call[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ strings: [...strings], values });
    if (rows.length === 0) return [];
    if (!/\binsert\b/i.test(strings.join(""))) return rows;
    const text = JSON.stringify(values);
    return contents.filter((c) => text.includes(c)).map((_, i) => ({ id: `inserted-${i}` }));
  }) as Sql;
  return { sql, calls };
}

// 列名は snake_case と camelCase の両方 (実装がどちらで読んでもよい)
function messageRow(id: string, role: string, content: string, createdAt: unknown) {
  return {
    id,
    owner: OWNER,
    project_id: PROJECT_ID,
    projectId: PROJECT_ID,
    thread: "plan",
    role,
    content,
    created_at: createdAt,
    createdAt,
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

const INPUT: MessagesInput = {
  projectId: PROJECT_ID,
  thread: "plan",
  messages: [
    { role: "user", content: CONTENT_CANARY },
    { role: "assistant", content: "では目標は？" },
  ],
};

describe("listMessages (EXP-010 L2)", () => {
  // 新しい順に届いた行 (order by created_at desc limit 100 を想定)
  const newestFirst = [
    messageRow(M3, "user", "三つ目", T3),
    messageRow(M2, "assistant", "では目標は？", T2),
    messageRow(M1, "user", "目的は健康のため", T1),
  ];

  it("全問い合わせを owner で絞り、projectId と thread がパラメータ (EXP-010 L2)", async () => {
    const { sql, calls } = fakeSql(newestFirst);
    await listMessages(sql, OWNER, PROJECT_ID, "plan");
    expectOwnerFiltersEveryQuery(calls);
    const values = calls.flatMap((c) => c.values);
    expect(values).toEqual(expect.arrayContaining([PROJECT_ID, "plan"]));
    expect(calls.map((c) => c.strings.join("")).join("")).not.toContain(PROJECT_ID);
  });

  it("新しい順の行を古い順の StoredMessage で返す (EXP-010 L2)", async () => {
    const { sql } = fakeSql(newestFirst);
    expect(await listMessages(sql, OWNER, PROJECT_ID, "plan")).toEqual([
      { id: M1, role: "user", content: "目的は健康のため", createdAt: T1 },
      { id: M2, role: "assistant", content: "では目標は？", createdAt: T2 },
      { id: M3, role: "user", content: "三つ目", createdAt: T3 },
    ]);
  });

  it("created_at が Date で届いても createdAt は ISO 文字列 (EXP-010 L2)", async () => {
    const { sql } = fakeSql([messageRow(M2, "assistant", "b", new Date(T2)), messageRow(M1, "user", "a", new Date(T1))]);
    const got = await listMessages(sql, OWNER, PROJECT_ID, "chat");
    expect(got.map((m) => m.createdAt)).toEqual([T1, T2]);
  });

  it("行が無ければ空の配列 (EXP-010 L2)", async () => {
    const { sql, calls } = fakeSql([]);
    expect(await listMessages(sql, OWNER, PROJECT_ID, "plan")).toEqual([]);
    expectOwnerFiltersEveryQuery(calls);
  });
});

describe("appendMessages (EXP-010 L2)", () => {
  const owned = [{ id: PROJECT_ID }];
  const contents = INPUT.messages.map((m) => m.content);

  it("全問い合わせを owner で絞り、中身はパラメータ (SQL の文字列に埋め込まない) (EXP-010 L2)", async () => {
    const { sql, calls } = fakeAppendSql(owned, contents);
    await appendMessages(sql, OWNER, INPUT);
    expectOwnerFiltersEveryQuery(calls);
    expect(calls.flatMap((c) => c.values)).toContain(PROJECT_ID);
    expect(calls.map((c) => c.strings.join("")).join("")).not.toContain(CONTENT_CANARY);
  });

  it("自分のプロジェクトなら入れた件数を返す (EXP-010 L2)", async () => {
    const { sql } = fakeAppendSql(owned, contents);
    expect(await appendMessages(sql, OWNER, INPUT)).toBe(2);
  });

  it("他人・無いプロジェクト (所有確認で行が返らない) は null (EXP-010 L2)", async () => {
    const { sql, calls } = fakeAppendSql([], contents);
    expect(await appendMessages(sql, OWNER, INPUT)).toBeNull();
    expectOwnerFiltersEveryQuery(calls);
  });

  it("検査自体の判別力: owner を挿入値にだけ使う問い合わせは絞り込みと見なさない (EXP-010 L2)", () => {
    const insertOnly: Call = {
      strings: ["insert into messages (owner, project_id, content) values (", ", ", ", ", ")"],
      values: [OWNER, PROJECT_ID, CONTENT_CANARY],
    };
    const filtered: Call = {
      strings: ["insert into messages (owner, project_id) select ", ", id from projects where id = ", " and owner = ", ""],
      values: [OWNER, PROJECT_ID, OWNER],
    };
    expect(ownerFilterSlots(insertOnly)).toEqual([]);
    expect(ownerFilterSlots(filtered)).toEqual([2]);
  });
});
