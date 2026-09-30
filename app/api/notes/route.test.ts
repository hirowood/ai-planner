import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authState } from "../../../test/mocks/next-auth";
import { capturePerf } from "../../../test/mocks/fetch";

// lib/db の差し替え (notes/route.ts と notes/[id]/route.ts の両方が同じ lib/db を import する)
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

import { GET, POST } from "./route";
import { DELETE } from "./[id]/route";

const ALLOWED = [
  "calendar_ms", "first_chunk_ms", "gemini_ms", "history_len", "plan_proposed", "question_count", "route", "status",
  "time_dialog_used", "time_prompted", "total_ms", "db_ms", "row_count",
];
const EMAIL = "canary-user-3b9e@example.com";
const BODY_CANARY = "canary-note-body-5e8f";
const PROJECT_ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b";
const NOTE_ID = "9d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6";
const T1 = "2026-09-30T01:02:03.000Z";

function signedInWithEmail() {
  authState.session = { user: { name: "test user", email: EMAIL }, accessToken: "fake-token" } as typeof authState.session;
}

function noteRow(id: string, body: string) {
  return {
    id,
    owner: EMAIL,
    project_id: PROJECT_ID,
    projectId: PROJECT_ID,
    kind: "thought",
    body,
    created_at: T1,
    createdAt: T1,
  };
}

function get(projectId?: string): Request {
  const qs = projectId === undefined ? "" : `?projectId=${encodeURIComponent(projectId)}`;
  return new Request(`http://localhost/api/notes${qs}`, { method: "GET" });
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function del(id: string) {
  const req = new Request(`http://localhost/api/notes/${encodeURIComponent(id)}`, { method: "DELETE" });
  return DELETE(req, { params: Promise.resolve({ id }) });
}

const validBody = { projectId: PROJECT_ID, kind: "thought", body: BODY_CANARY };

let perf: ReturnType<typeof capturePerf>;
beforeEach(() => {
  perf = capturePerf();
  authState.session = null;
  db.state.configured = true;
  db.state.rows = [];
  db.state.calls = [];
});
afterEach(() => perf.restore());

function expectOnePerfLine(route: string, status: number) {
  expect(perf.lines).toHaveLength(1);
  const [line] = perf.parsed();
  expect(Object.keys(line).filter((k) => !ALLOWED.includes(k))).toEqual([]);
  expect(line).toMatchObject({ route, status });
  return line;
}

function expectNoCanaryInLogs() {
  const everything = perf.all.join("\n");
  for (const canary of [EMAIL, BODY_CANARY]) {
    expect(everything).not.toContain(canary);
  }
}

function expectOwnerInEveryQuery() {
  expect(db.state.calls.length).toBeGreaterThan(0);
  expect(db.state.calls.every((c) => c.values.includes(EMAIL))).toBe(true);
}

describe("GET /api/notes (EXP-008 L3)", () => {
  it("セッション無しは 401 (EXP-008 L3)", async () => {
    const res = await GET(get(PROJECT_ID));
    expect(res.status).toBe(401);
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine("api/notes", 401);
  });

  it("メールの無いセッションは 401 (EXP-008 L3)", async () => {
    authState.session = { user: { name: "test user" }, accessToken: "fake-token" };
    const res = await GET(get(PROJECT_ID));
    expect(res.status).toBe(401);
    expect(db.state.calls).toHaveLength(0);
  });

  it.each([
    ["projectId が無い", undefined],
    ["UUID でない projectId", "not-a-uuid"],
  ])("%s は 400 で DB を呼ばない (EXP-008 L3)", async (_label, projectId) => {
    signedInWithEmail();
    const res = await GET(get(projectId));
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine("api/notes", 400);
  });

  it("200 { notes }・owner はメール・row_count は行の数 (EXP-008 L3)", async () => {
    signedInWithEmail();
    db.state.rows = [noteRow("n1", BODY_CANARY), noteRow("n2", `${BODY_CANARY}-2`), noteRow("n3", "x")];
    const res = await GET(get(PROJECT_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notes).toHaveLength(3);
    expect(body.notes[0]).toMatchObject({ id: "n1", projectId: PROJECT_ID, kind: "thought", body: BODY_CANARY });
    expectOwnerInEveryQuery();
    const line = expectOnePerfLine("api/notes", 200);
    expect(line).toMatchObject({ row_count: 3 });
    expect(typeof line.db_ms).toBe("number");
    expectNoCanaryInLogs();
  });

  it("データベース未設定は 503 (EXP-008 L3)", async () => {
    signedInWithEmail();
    db.state.configured = false;
    const res = await GET(get(PROJECT_ID));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "データベースが未設定です" });
    expectOnePerfLine("api/notes", 503);
  });
});

describe("POST /api/notes (EXP-008 L3)", () => {
  it("セッション無しは 401 (EXP-008 L3)", async () => {
    const res = await POST(post(validBody));
    expect(res.status).toBe(401);
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine("api/notes", 401);
    expectNoCanaryInLogs();
  });

  it.each([
    ["壊れた JSON", "{not json"],
    ["空の本文", { ...validBody, body: "" }],
    ["2001 字の本文", { ...validBody, body: "a".repeat(2001) }],
    ["21 字の種類", { ...validBody, kind: "a".repeat(21) }],
    ["UUID でない projectId", { ...validBody, projectId: "p1" }],
  ])("%s は 400 で DB を呼ばない (EXP-008 L3)", async (_label, body) => {
    signedInWithEmail();
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine("api/notes", 400);
    expectNoCanaryInLogs();
  });

  it("201 { note }・owner はメール (EXP-008 L3)", async () => {
    signedInWithEmail();
    db.state.rows = [noteRow(NOTE_ID, BODY_CANARY)];
    const res = await POST(post(validBody));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.note).toMatchObject({ id: NOTE_ID, projectId: PROJECT_ID, kind: "thought", body: BODY_CANARY });
    expectOwnerInEveryQuery();
    expectOnePerfLine("api/notes", 201);
    expectNoCanaryInLogs();
  });

  it("他人・無いプロジェクト (行が返らない) は 404 (EXP-008 L3)", async () => {
    signedInWithEmail();
    db.state.rows = [];
    const res = await POST(post(validBody));
    expect(res.status).toBe(404);
    expect(await res.json()).toHaveProperty("error");
    expectOwnerInEveryQuery();
    expectOnePerfLine("api/notes", 404);
    expectNoCanaryInLogs();
  });

  it("データベース未設定は 503 (EXP-008 L3)", async () => {
    signedInWithEmail();
    db.state.configured = false;
    const res = await POST(post(validBody));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "データベースが未設定です" });
    expectOnePerfLine("api/notes", 503);
    expectNoCanaryInLogs();
  });
});

describe("DELETE /api/notes/[id] (EXP-008 L3)", () => {
  it("セッション無しは 401 (EXP-008 L3)", async () => {
    const res = await del(NOTE_ID);
    expect(res.status).toBe(401);
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine("api/notes/[id]", 401);
  });

  it("UUID でない id は 400 で DB を呼ばない (EXP-008 L3)", async () => {
    signedInWithEmail();
    const res = await del("not-a-uuid");
    expect(res.status).toBe(400);
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine("api/notes/[id]", 400);
  });

  it("自分のノートを消せたら 204 (本文なし)・owner はメール (EXP-008 L3)", async () => {
    signedInWithEmail();
    db.state.rows = [{ id: NOTE_ID }];
    const res = await del(NOTE_ID);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expectOwnerInEveryQuery();
    expect(db.state.calls.some((c) => c.values.includes(NOTE_ID))).toBe(true);
    expectOnePerfLine("api/notes/[id]", 204);
    expectNoCanaryInLogs();
  });

  it("他人・無いノート (行が返らない) は 404 (EXP-008 L3)", async () => {
    signedInWithEmail();
    db.state.rows = [];
    const res = await del(NOTE_ID);
    expect(res.status).toBe(404);
    expectOwnerInEveryQuery();
    expectOnePerfLine("api/notes/[id]", 404);
    expectNoCanaryInLogs();
  });

  it("データベース未設定は 503 (EXP-008 L3)", async () => {
    signedInWithEmail();
    db.state.configured = false;
    const res = await del(NOTE_ID);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "データベースが未設定です" });
    expectOnePerfLine("api/notes/[id]", 503);
  });
});
