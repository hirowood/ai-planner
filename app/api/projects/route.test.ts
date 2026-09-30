import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authState } from "../../../test/mocks/next-auth";
import { capturePerf } from "../../../test/mocks/fetch";

// lib/db の差し替え: getSql は偽の sql を返す。configured=false で DbNotConfigured を投げる
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

const ALLOWED = [
  "calendar_ms", "first_chunk_ms", "gemini_ms", "history_len", "plan_proposed", "question_count", "route", "status",
  "time_dialog_used", "time_prompted", "total_ms", "db_ms", "row_count",
];
const EMAIL = "canary-user-3b9e@example.com";
const NAME_CANARY = "canary-project-name-a71c";
const PURPOSE_CANARY = "canary-project-purpose-e02d";
const T1 = "2026-09-30T01:02:03.000Z";

function signedInWithEmail() {
  authState.session = { user: { name: "test user", email: EMAIL }, accessToken: "fake-token" } as typeof authState.session;
}

function projectRow(id: string, name: string, purpose: string) {
  return { id, owner: EMAIL, name, category: "work", purpose, created_at: T1, createdAt: T1 };
}

function get(): Request {
  return new Request("http://localhost/api/projects", { method: "GET" });
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const validBody = { name: NAME_CANARY, category: "work", purpose: PURPOSE_CANARY };

describe("/api/projects (EXP-008 L3)", () => {
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
    expect(line).toMatchObject({ route: "api/projects", status });
    return line;
  }

  function expectNoCanaryInLogs() {
    const everything = perf.all.join("\n");
    for (const canary of [EMAIL, NAME_CANARY, PURPOSE_CANARY]) {
      expect(everything).not.toContain(canary);
    }
  }

  it("GET: セッション無しは 401 (EXP-008 L3)", async () => {
    const res = await GET(get());
    expect(res.status).toBe(401);
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine(401);
  });

  it("GET: メールの無いセッションは 401 (EXP-008 L3)", async () => {
    authState.session = { user: { name: "test user" }, accessToken: "fake-token" };
    const res = await GET(get());
    expect(res.status).toBe(401);
    expect(db.state.calls).toHaveLength(0);
  });

  it("POST: セッション無しは 401 (EXP-008 L3)", async () => {
    const res = await POST(post(validBody));
    expect(res.status).toBe(401);
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine(401);
  });

  it("GET: 200 { projects }・owner はメール・row_count は行の数 (EXP-008 L3)", async () => {
    signedInWithEmail();
    db.state.rows = [projectRow("p1", NAME_CANARY, PURPOSE_CANARY), projectRow("p2", `${NAME_CANARY}-2`, "")];
    const res = await GET(get());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toHaveLength(2);
    expect(body.projects[0]).toMatchObject({ id: "p1", name: NAME_CANARY, category: "work", createdAt: T1 });
    expect(db.state.calls.every((c) => c.values.includes(EMAIL))).toBe(true);
    const line = expectOnePerfLine(200);
    expect(line).toMatchObject({ row_count: 2 });
    expect(typeof line.db_ms).toBe("number");
    expectNoCanaryInLogs();
  });

  it("POST: 201 { project }・owner はメール (EXP-008 L3)", async () => {
    signedInWithEmail();
    db.state.rows = [projectRow("p9", NAME_CANARY, PURPOSE_CANARY)];
    const res = await POST(post(validBody));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.project).toMatchObject({ id: "p9", name: NAME_CANARY, category: "work", purpose: PURPOSE_CANARY });
    expect(db.state.calls.length).toBeGreaterThan(0);
    expect(db.state.calls.every((c) => c.values.includes(EMAIL))).toBe(true);
    expectOnePerfLine(201);
    expectNoCanaryInLogs();
  });

  it.each([
    ["壊れた JSON", "{not json"],
    ["空の名前", { ...validBody, name: "" }],
    ["61 字の名前", { ...validBody, name: "a".repeat(61) }],
    ["21 字の種類", { ...validBody, category: "a".repeat(21) }],
  ])("POST: %s は 400 で DB を呼ばない (EXP-008 L3)", async (_label, body) => {
    signedInWithEmail();
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine(400);
    expectNoCanaryInLogs();
  });

  it("GET: データベース未設定は 503 (EXP-008 L3)", async () => {
    signedInWithEmail();
    db.state.configured = false;
    const res = await GET(get());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "データベースが未設定です" });
    expectOnePerfLine(503);
    expectNoCanaryInLogs();
  });

  it("POST: データベース未設定は 503 (EXP-008 L3)", async () => {
    signedInWithEmail();
    db.state.configured = false;
    const res = await POST(post(validBody));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "データベースが未設定です" });
    expectOnePerfLine(503);
    expectNoCanaryInLogs();
  });
});
