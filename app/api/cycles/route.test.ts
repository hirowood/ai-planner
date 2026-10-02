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
  };
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    state.calls.push({ strings: [...strings], values });
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

import { GET, PUT } from "./route";

const ALLOWED = [
  "calendar_ms", "first_chunk_ms", "gemini_ms", "history_len", "plan_proposed", "question_count", "route", "status",
  "time_dialog_used", "time_prompted", "total_ms", "db_ms", "row_count",
];
const ROUTE = "api/cycles";
const EMAIL = "canary-user-5f7a@example.com";
const PLAN_CANARY = "canary-cycle-purpose-2e9b";
const PROJECT_ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b";
const CYCLE_ID = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const T1 = "2026-09-30T01:02:03.000Z";

const PLAN = {
  purpose: PLAN_CANARY,
  kgi: "10 月末に 5km 歩ける",
  kpis: [{ name: "歩いた日数", target: "週 5 日" }],
  kdis: [{ action: "朝の散歩", date: "2026-10-01", start: "07:00", end: "07:30" }],
  criteria: "3 週続けば成功",
  deliverable: "記録表",
};

function signedInWithEmail() {
  authState.session = { user: { name: "test user", email: EMAIL }, accessToken: "fake-token" } as typeof authState.session;
}

// 列名は snake_case と camelCase の両方 (実装がどちらで読んでもよい)
function cycleRow(id = CYCLE_ID, phase = "plan") {
  return {
    id,
    owner: EMAIL,
    project_id: PROJECT_ID,
    projectId: PROJECT_ID,
    phase,
    plan: PLAN,
    created_at: T1,
    createdAt: T1,
    updated_at: T1,
    updatedAt: T1,
  };
}

function get(projectId?: string): Request {
  const qs = projectId === undefined ? "" : `?projectId=${encodeURIComponent(projectId)}`;
  return new Request(`http://localhost/api/cycles${qs}`, { method: "GET" });
}

function put(body: unknown): Request {
  return new Request("http://localhost/api/cycles", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const createBody = { projectId: PROJECT_ID, plan: PLAN, phase: "plan" };
const updateBody = { ...createBody, cycleId: CYCLE_ID, phase: "do" };

let perf: ReturnType<typeof capturePerf>;
beforeEach(() => {
  perf = capturePerf();
  authState.session = null;
  db.state.configured = true;
  db.state.rows = [];
  db.state.calls = [];
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
  for (const canary of [EMAIL, PLAN_CANARY]) expect(everything).not.toContain(canary);
}

function expectOwnerInEveryQuery() {
  expect(db.state.calls.length).toBeGreaterThan(0);
  expect(db.state.calls.every((c) => c.values.includes(EMAIL))).toBe(true);
}

function expectDbPerf(line: Record<string, unknown>) {
  expect(typeof line.db_ms).toBe("number");
  expect(typeof line.row_count).toBe("number");
}

describe("GET /api/cycles (EXP-009 L5)", () => {
  it("セッション無しは 401 で DB を呼ばない (EXP-009 L5)", async () => {
    const res = await GET(get(PROJECT_ID));
    expect(res.status).toBe(401);
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine(401);
  });

  it("メールの無いセッションは 401 (EXP-009 L5)", async () => {
    authState.session = { user: { name: "test user" }, accessToken: "fake-token" };
    const res = await GET(get(PROJECT_ID));
    expect(res.status).toBe(401);
    expect(db.state.calls).toHaveLength(0);
  });

  it.each([
    ["projectId が無い", undefined],
    ["UUID でない projectId", "not-a-uuid"],
  ])("%s は 400 で DB を呼ばない (EXP-009 L5)", async (_label, projectId) => {
    signedInWithEmail();
    const res = await GET(get(projectId));
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine(400);
  });

  it("200 { cycle }・owner はメール・db_ms と row_count (EXP-009 L5)", async () => {
    signedInWithEmail();
    db.state.rows = [cycleRow()];
    const res = await GET(get(PROJECT_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cycle).toMatchObject({ id: CYCLE_ID, projectId: PROJECT_ID, phase: "plan", plan: PLAN });
    expectOwnerInEveryQuery();
    expect(db.state.calls.some((c) => c.values.includes(PROJECT_ID))).toBe(true);
    const line = expectOnePerfLine(200);
    expectDbPerf(line);
    expect(line.row_count).toBe(1);
    expectNoCanaryInLogs();
  });

  it("まだ無い (行が返らない) は 200 { cycle: null } (EXP-009 L5)", async () => {
    signedInWithEmail();
    db.state.rows = [];
    const res = await GET(get(PROJECT_ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cycle: null });
    expectOwnerInEveryQuery();
    expectOnePerfLine(200);
  });

  it("データベース未設定は 503 (EXP-009 L5)", async () => {
    signedInWithEmail();
    db.state.configured = false;
    const res = await GET(get(PROJECT_ID));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "データベースが未設定です" });
    expectOnePerfLine(503);
  });
});

describe("PUT /api/cycles (EXP-009 L5)", () => {
  it("セッション無しは 401 で DB を呼ばない (EXP-009 L5)", async () => {
    const res = await PUT(put(createBody));
    expect(res.status).toBe(401);
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine(401);
    expectNoCanaryInLogs();
  });

  it.each([
    ["壊れた JSON", "{not json"],
    ["UUID でない projectId", { ...createBody, projectId: "p1" }],
    ["UUID でない cycleId", { ...createBody, cycleId: "c1" }],
    ["決まっていない phase", { ...createBody, phase: "check" }],
    ["Plan が無い", { projectId: PROJECT_ID, phase: "plan" }],
    ["Plan がオブジェクトでない", { ...createBody, plan: "x" }],
  ])("%s は 400 で DB を呼ばない (EXP-009 L5)", async (_label, body) => {
    signedInWithEmail();
    const res = await PUT(put(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine(400);
    expectNoCanaryInLogs();
  });

  it("cycleId が無ければ作る: 200 { cycle }・owner はメール (EXP-009 L5)", async () => {
    signedInWithEmail();
    db.state.rows = [cycleRow()];
    const res = await PUT(put(createBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cycle).toMatchObject({ id: CYCLE_ID, projectId: PROJECT_ID, phase: "plan", plan: PLAN });
    expectOwnerInEveryQuery();
    expect(db.state.calls.some((c) => c.values.includes(PROJECT_ID))).toBe(true);
    expectDbPerf(expectOnePerfLine(200));
    expectNoCanaryInLogs();
  });

  it("cycleId があれば更新: 200 { cycle }・cycleId が問い合わせに入る (EXP-009 L5)", async () => {
    signedInWithEmail();
    db.state.rows = [cycleRow(CYCLE_ID, "do")];
    const res = await PUT(put(updateBody));
    expect(res.status).toBe(200);
    expect((await res.json()).cycle).toMatchObject({ id: CYCLE_ID, phase: "do" });
    expectOwnerInEveryQuery();
    expect(db.state.calls.some((c) => c.values.includes(CYCLE_ID))).toBe(true);
    expectDbPerf(expectOnePerfLine(200));
    expectNoCanaryInLogs();
  });

  it.each([
    ["他人・無いプロジェクトへの作成", createBody],
    ["他人・無い cycle の更新", updateBody],
  ])("%s (行が返らない) は 404 (EXP-009 L5)", async (_label, body) => {
    signedInWithEmail();
    db.state.rows = [];
    const res = await PUT(put(body));
    expect(res.status).toBe(404);
    expect(await res.json()).toHaveProperty("error");
    expectOwnerInEveryQuery();
    expectOnePerfLine(404);
    expectNoCanaryInLogs();
  });

  it("データベース未設定は 503 (EXP-009 L5)", async () => {
    signedInWithEmail();
    db.state.configured = false;
    const res = await PUT(put(createBody));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "データベースが未設定です" });
    expectOnePerfLine(503);
    expectNoCanaryInLogs();
  });
});
