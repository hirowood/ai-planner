import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authState } from "../../../test/mocks/next-auth";
import { capturePerf } from "../../../test/mocks/fetch";

// lib/db の差し替え (偽の tagged-template sql。問い合わせを記録し、決めた行を返す)
const db = vi.hoisted(() => {
  class DbNotConfigured extends Error {}
  type Call = { strings: string[]; values: unknown[] };
  const state = {
    configured: true,
    rows: [] as Record<string, unknown>[],
    calls: [] as Call[],
    // 空でなければ、insert にはその問い合わせの値に含まれる発言の数だけ行を返す
    // (1 件ずつ入れても、まとめて入れても、返った行の数が入れた件数と一致する)
    insertContents: [] as string[],
  };
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    state.calls.push({ strings: [...strings], values });
    if (state.rows.length > 0 && state.insertContents.length > 0 && /\binsert\b/i.test(strings.join(""))) {
      const text = JSON.stringify(values);
      return state.insertContents.filter((c) => text.includes(c)).map((_, i) => ({ id: `inserted-${i}` }));
    }
    return state.rows;
  };
  return { DbNotConfigured, state, sql };
});

vi.mock("next-auth", async () => (await import("../../../test/mocks/next-auth")).nextAuthMock);
vi.mock("../auth/[...nextauth]/route", async () => (await import("../../../test/mocks/next-auth")).authRouteMock);
vi.mock("../../../lib/db", () => ({
  DbNotConfigured: db.DbNotConfigured,
  getSql: () => {
    if (!db.state.configured) throw new db.DbNotConfigured("DATABASE_URL is not set");
    return db.sql;
  },
}));

import { GET, POST } from "./route";

const ALLOWED = [
  "calendar_ms", "first_chunk_ms", "gemini_ms", "history_len", "plan_proposed", "question_count", "route", "status",
  "time_dialog_used", "time_prompted", "total_ms", "db_ms", "row_count",
];
const ROUTE = "api/messages";
const EMAIL = "canary-user-8e2c@example.com";
const USER_CANARY = "canary-user-said-3a7f";
const AI_CANARY = "canary-ai-replied-9b4d";
const PROJECT_ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b";
const M1 = "1a2b3c4d-0000-4a6b-8c7d-000000000001";
const M2 = "1a2b3c4d-0000-4a6b-8c7d-000000000002";
const T1 = "2026-09-30T01:00:00.000Z";
const T2 = "2026-09-30T02:00:00.000Z";

function signedInWithEmail() {
  authState.session = { user: { name: "test user", email: EMAIL }, accessToken: "fake-token" } as typeof authState.session;
}

// 列名は snake_case と camelCase の両方 (実装がどちらで読んでもよい)
function messageRow(id: string, role: string, content: string, createdAt: string) {
  return {
    id,
    owner: EMAIL,
    project_id: PROJECT_ID,
    projectId: PROJECT_ID,
    thread: "plan",
    role,
    content,
    created_at: createdAt,
    createdAt,
  };
}

// 新しい順に届く 2 行
const ROWS = [messageRow(M2, "assistant", AI_CANARY, T2), messageRow(M1, "user", USER_CANARY, T1)];

function get(params: Record<string, string | undefined>): Request {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, v);
  const s = qs.toString();
  return new Request(`http://localhost/api/messages${s ? `?${s}` : ""}`, { method: "GET" });
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const postBody = {
  projectId: PROJECT_ID,
  thread: "plan",
  messages: [
    { role: "user", content: USER_CANARY },
    { role: "assistant", content: AI_CANARY },
  ],
};

let perf: ReturnType<typeof capturePerf>;
beforeEach(() => {
  perf = capturePerf();
  authState.session = null;
  db.state.configured = true;
  db.state.rows = [];
  db.state.calls = [];
  db.state.insertContents = [];
});
afterEach(() => perf.restore());

function expectOnePerfLine(status: number) {
  expect(perf.lines).toHaveLength(1);
  const [line] = perf.parsed();
  expect(Object.keys(line).filter((k) => !ALLOWED.includes(k))).toEqual([]);
  expect(line).toMatchObject({ route: ROUTE, status });
  return line;
}

function expectNoCanaryInLogs() {
  const everything = perf.all.join("\n");
  for (const canary of [EMAIL, USER_CANARY, AI_CANARY]) expect(everything).not.toContain(canary);
}

function expectOwnerInEveryQuery() {
  expect(db.state.calls.length).toBeGreaterThan(0);
  expect(db.state.calls.every((c) => c.values.includes(EMAIL))).toBe(true);
}

function expectDbPerf(line: Record<string, unknown>) {
  expect(typeof line.db_ms).toBe("number");
  expect(typeof line.row_count).toBe("number");
}

describe("GET /api/messages (EXP-010 L3)", () => {
  it("セッション無しは 401 で DB を呼ばない (EXP-010 L3)", async () => {
    const res = await GET(get({ projectId: PROJECT_ID, thread: "plan" }));
    expect(res.status).toBe(401);
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine(401);
  });

  it("メールの無いセッションは 401 (EXP-010 L3)", async () => {
    authState.session = { user: { name: "test user" }, accessToken: "fake-token" };
    const res = await GET(get({ projectId: PROJECT_ID, thread: "plan" }));
    expect(res.status).toBe(401);
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine(401);
  });

  it.each([
    ["projectId が無い", { thread: "plan" }],
    ["UUID でない projectId", { projectId: "not-a-uuid", thread: "plan" }],
    ["thread が無い", { projectId: PROJECT_ID }],
    ["知らない thread", { projectId: PROJECT_ID, thread: "do" }],
  ])("%s は 400 で DB を呼ばない (EXP-010 L3)", async (_label, params) => {
    signedInWithEmail();
    const res = await GET(get(params));
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine(400);
  });

  it("200 { messages } を古い順・owner はメール・db_ms と row_count (EXP-010 L3)", async () => {
    signedInWithEmail();
    db.state.rows = ROWS;
    const res = await GET(get({ projectId: PROJECT_ID, thread: "plan" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      messages: [
        { id: M1, role: "user", content: USER_CANARY, createdAt: T1 },
        { id: M2, role: "assistant", content: AI_CANARY, createdAt: T2 },
      ],
    });
    expectOwnerInEveryQuery();
    expect(db.state.calls.some((c) => c.values.includes(PROJECT_ID))).toBe(true);
    const line = expectOnePerfLine(200);
    expectDbPerf(line);
    expect(line.row_count).toBe(2);
    expectNoCanaryInLogs();
  });

  it("まだ無い (行が返らない) は 200 { messages: [] } (EXP-010 L3)", async () => {
    signedInWithEmail();
    const res = await GET(get({ projectId: PROJECT_ID, thread: "chat" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ messages: [] });
    expectOwnerInEveryQuery();
    expectOnePerfLine(200);
  });

  it("データベース未設定は 503 (EXP-010 L3)", async () => {
    signedInWithEmail();
    db.state.configured = false;
    const res = await GET(get({ projectId: PROJECT_ID, thread: "plan" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toHaveProperty("error");
    expectOnePerfLine(503);
  });
});

describe("POST /api/messages (EXP-010 L3)", () => {
  it("セッション無しは 401 で DB を呼ばない (EXP-010 L3)", async () => {
    const res = await POST(post(postBody));
    expect(res.status).toBe(401);
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine(401);
    expectNoCanaryInLogs();
  });

  it.each([
    ["壊れた JSON", "{not json"],
    ["UUID でない projectId", { ...postBody, projectId: "p1" }],
    ["知らない thread", { ...postBody, thread: "do" }],
    ["0 件", { ...postBody, messages: [] }],
    ["21 件", { ...postBody, messages: Array.from({ length: 21 }, () => ({ role: "user", content: USER_CANARY })) }],
    ["空の content", { ...postBody, messages: [{ role: "user", content: "" }] }],
    ["8001 字の content", { ...postBody, messages: [{ role: "user", content: USER_CANARY + "a".repeat(8001) }] }],
    ["知らない role", { ...postBody, messages: [{ role: "system", content: USER_CANARY }] }],
    ["オブジェクトでない", [postBody]],
  ])("%s は 400 で DB を呼ばない (EXP-010 L3)", async (_label, body) => {
    signedInWithEmail();
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine(400);
    expectNoCanaryInLogs();
  });

  it("201 { count }・owner はメール・db_ms と row_count (EXP-010 L3)", async () => {
    signedInWithEmail();
    // 所有確認には行が返り、insert には入れた発言の数だけ行が返る
    db.state.rows = [{ id: PROJECT_ID }];
    db.state.insertContents = [USER_CANARY, AI_CANARY];
    const res = await POST(post(postBody));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ count: 2 });
    expectOwnerInEveryQuery();
    expect(db.state.calls.some((c) => c.values.includes(PROJECT_ID))).toBe(true);
    expectDbPerf(expectOnePerfLine(201));
    expectNoCanaryInLogs();
  });

  it("他人・無いプロジェクト (行が返らない) は 404 (EXP-010 L3)", async () => {
    signedInWithEmail();
    db.state.rows = [];
    const res = await POST(post(postBody));
    expect(res.status).toBe(404);
    expect(await res.json()).toHaveProperty("error");
    expectOwnerInEveryQuery();
    expectOnePerfLine(404);
    expectNoCanaryInLogs();
  });

  it("データベース未設定は 503 (EXP-010 L3)", async () => {
    signedInWithEmail();
    db.state.configured = false;
    const res = await POST(post(postBody));
    expect(res.status).toBe(503);
    expect(await res.json()).toHaveProperty("error");
    expectOnePerfLine(503);
    expectNoCanaryInLogs();
  });
});
