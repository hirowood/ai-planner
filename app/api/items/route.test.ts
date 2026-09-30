import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authState } from "../../../test/mocks/next-auth";
import { capturePerf } from "../../../test/mocks/fetch";

// lib/db の差し替え (items/route.ts と items/[id]/route.ts の両方が同じ lib/db を import する)
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
import { DELETE, PATCH } from "./[id]/route";

const ALLOWED = [
  "calendar_ms", "first_chunk_ms", "gemini_ms", "history_len", "plan_proposed", "question_count", "route", "status",
  "time_dialog_used", "time_prompted", "total_ms", "db_ms", "row_count",
];
const EMAIL = "canary-user-5f3a@example.com";
const TITLE_CANARY = "canary-item-title-4e8b";
const TARGET_CANARY = "canary-item-target-7a2c";
const PROJECT_ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b";
const PARENT_ID = "5b6c7d8e-1f2a-4b3c-8d4e-5f6a7b8c9d0e";
const ITEM_ID = "9d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6";
const ITEM2_ID = "9d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d7";
const T1 = "2026-09-30T01:02:03.000Z";

function signedInWithEmail() {
  authState.session = { user: { name: "test user", email: EMAIL }, accessToken: "fake-token" } as typeof authState.session;
}

// 列名は snake_case と camelCase の両方 (実装がどちらで読んでもよい)
function itemRow(id: string, o: { level?: string; parentId?: string | null; status?: string } = {}) {
  const parentId = o.parentId ?? null;
  return {
    id,
    owner: EMAIL,
    project_id: PROJECT_ID,
    projectId: PROJECT_ID,
    parent_id: parentId,
    parentId,
    level: o.level ?? "kgi",
    title: TITLE_CANARY,
    target: TARGET_CANARY,
    due_date: "2026-10-31",
    dueDate: "2026-10-31",
    status: o.status ?? "todo",
    created_at: T1,
    createdAt: T1,
    updated_at: T1,
    updatedAt: T1,
  };
}

function itemJson(id: string, o: { level?: string; parentId?: string | null; status?: string } = {}) {
  return {
    id,
    projectId: PROJECT_ID,
    parentId: o.parentId ?? null,
    level: o.level ?? "kgi",
    title: TITLE_CANARY,
    target: TARGET_CANARY,
    dueDate: "2026-10-31",
    status: o.status ?? "todo",
    createdAt: T1,
    updatedAt: T1,
  };
}

function get(params: Record<string, string | undefined>): Request {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, v);
  const s = qs.toString();
  return new Request(`http://localhost/api/items${s ? `?${s}` : ""}`, { method: "GET" });
}

function withBody(method: string, url: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const post = (body: unknown) => withBody("POST", "http://localhost/api/items", body);
const patch = (id: string, body: unknown) => withBody("PATCH", `http://localhost/api/items/${id}`, body);
const del = (id: string) => new Request(`http://localhost/api/items/${id}`, { method: "DELETE" });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const postBody = {
  projectId: PROJECT_ID,
  parentId: null,
  level: "kgi",
  title: TITLE_CANARY,
  target: TARGET_CANARY,
  dueDate: "2026-10-31",
  status: "todo",
};

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
  expect(line).toMatchObject({ status });
  expect(String(line.route)).toMatch(/^api\/items/);
  return line;
}

function expectNoCanaryInLogs() {
  const everything = perf.all.join("\n");
  for (const canary of [EMAIL, TITLE_CANARY, TARGET_CANARY]) expect(everything).not.toContain(canary);
}

function expectOwnerInEveryQuery() {
  expect(db.state.calls.length).toBeGreaterThan(0);
  expect(db.state.calls.every((c) => c.values.includes(EMAIL))).toBe(true);
}

function expectDbPerf(line: Record<string, unknown>) {
  expect(typeof line.db_ms).toBe("number");
  expect(typeof line.row_count).toBe("number");
}

describe("GET /api/items (EXP-017 L4)", () => {
  it("セッション無しは 401 で DB を呼ばない (EXP-017 L4)", async () => {
    const res = await GET(get({ projectId: PROJECT_ID }));
    expect(res.status).toBe(401);
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine(401);
  });

  it("メールの無いセッションは 401 (EXP-017 L4)", async () => {
    authState.session = { user: { name: "test user" }, accessToken: "fake-token" };
    const res = await GET(get({ projectId: PROJECT_ID }));
    expect(res.status).toBe(401);
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine(401);
  });

  it.each([
    ["projectId が無い", {}],
    ["UUID でない projectId", { projectId: "not-a-uuid" }],
  ])("%s は 400 で DB を呼ばない (EXP-017 L4)", async (_label, params) => {
    signedInWithEmail();
    const res = await GET(get(params));
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine(400);
  });

  it("200 { items }・owner はメール・db_ms と row_count・中身はログに出ない (EXP-017 L4)", async () => {
    signedInWithEmail();
    db.state.rows = [itemRow(ITEM_ID), itemRow(ITEM2_ID, { level: "kpi", parentId: ITEM_ID, status: "done" })];
    const res = await GET(get({ projectId: PROJECT_ID }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(Object.keys(body)).toEqual(["items"]);
    expect(body.items).toHaveLength(2);
    expect(body.items).toEqual(
      expect.arrayContaining([itemJson(ITEM_ID), itemJson(ITEM2_ID, { level: "kpi", parentId: ITEM_ID, status: "done" })]),
    );
    expectOwnerInEveryQuery();
    expect(db.state.calls.some((c) => c.values.includes(PROJECT_ID))).toBe(true);
    const line = expectOnePerfLine(200);
    expectDbPerf(line);
    expect(line.row_count).toBe(2);
    expectNoCanaryInLogs();
  });

  it("まだ無い (行が返らない) は 200 { items: [] } (EXP-017 L4)", async () => {
    signedInWithEmail();
    const res = await GET(get({ projectId: PROJECT_ID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
    expectOwnerInEveryQuery();
    expectOnePerfLine(200);
  });

  it("データベース未設定は 503 (EXP-017 L4)", async () => {
    signedInWithEmail();
    db.state.configured = false;
    const res = await GET(get({ projectId: PROJECT_ID }));
    expect(res.status).toBe(503);
    expect(await res.json()).toHaveProperty("error");
    expectOnePerfLine(503);
  });
});

describe("POST /api/items (EXP-017 L4)", () => {
  it("セッション無しは 401 で DB を呼ばない (EXP-017 L4)", async () => {
    const res = await POST(post(postBody));
    expect(res.status).toBe(401);
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine(401);
    expectNoCanaryInLogs();
  });

  it.each([
    ["壊れた JSON", "{not json"],
    ["空のタイトル", { ...postBody, title: "" }],
    ["201 字のタイトル", { ...postBody, title: TITLE_CANARY + "a".repeat(201) }],
    ["知らない段", { ...postBody, level: "okr" }],
    ["知らない状態", { ...postBody, status: "doing" }],
    ["kgi に親", { ...postBody, parentId: PARENT_ID }],
    ["kpi に親なし", { ...postBody, level: "kpi" }],
    ["実在しない日付", { ...postBody, dueDate: "2026-02-30" }],
    ["オブジェクトでない", [postBody]],
  ])("%s は 400 で DB を呼ばない (EXP-017 L4)", async (_label, body) => {
    signedInWithEmail();
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine(400);
    expectNoCanaryInLogs();
  });

  it("201 { item }・owner はメール・db_ms と row_count (EXP-017 L4)", async () => {
    signedInWithEmail();
    db.state.rows = [itemRow(ITEM_ID)];
    const res = await POST(post(postBody));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ item: itemJson(ITEM_ID) });
    expectOwnerInEveryQuery();
    expect(db.state.calls.some((c) => c.values.includes(PROJECT_ID))).toBe(true);
    expectDbPerf(expectOnePerfLine(201));
    expectNoCanaryInLogs();
  });

  it("プロジェクト・親が他人・無い・段が合わない (行が返らない) は 404 (EXP-017 L4)", async () => {
    signedInWithEmail();
    const res = await POST(post({ ...postBody, parentId: PARENT_ID, level: "kdi" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toHaveProperty("error");
    expectOwnerInEveryQuery();
    expectOnePerfLine(404);
    expectNoCanaryInLogs();
  });

  it("データベース未設定は 503 (EXP-017 L4)", async () => {
    signedInWithEmail();
    db.state.configured = false;
    const res = await POST(post(postBody));
    expect(res.status).toBe(503);
    expect(await res.json()).toHaveProperty("error");
    expectOnePerfLine(503);
    expectNoCanaryInLogs();
  });
});

describe("PATCH /api/items/[id] (EXP-017 L4)", () => {
  const patchBody = { title: TITLE_CANARY, status: "done" };

  it("セッション無しは 401 で DB を呼ばない (EXP-017 L4)", async () => {
    const res = await PATCH(patch(ITEM_ID, patchBody), ctx(ITEM_ID));
    expect(res.status).toBe(401);
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine(401);
    expectNoCanaryInLogs();
  });

  it.each([
    ["UUID でない id", "not-a-uuid", patchBody],
    ["壊れた JSON", ITEM_ID, "{not json"],
    ["項目が 1 つも無い", ITEM_ID, {}],
    ["空のタイトル", ITEM_ID, { title: "" }],
    ["知らない状態", ITEM_ID, { status: "doing" }],
    ["実在しない日付", ITEM_ID, { dueDate: "2026-13-01" }],
  ])("%s は 400 で DB を呼ばない (EXP-017 L4)", async (_label, id, body) => {
    signedInWithEmail();
    const res = await PATCH(patch(id, body), ctx(id));
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine(400);
    expectNoCanaryInLogs();
  });

  it("200 { item }・owner はメール・db_ms と row_count (EXP-017 L4)", async () => {
    signedInWithEmail();
    db.state.rows = [itemRow(ITEM_ID, { status: "done" })];
    const res = await PATCH(patch(ITEM_ID, patchBody), ctx(ITEM_ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ item: itemJson(ITEM_ID, { status: "done" }) });
    expectOwnerInEveryQuery();
    expect(db.state.calls.some((c) => c.values.includes(ITEM_ID))).toBe(true);
    expectDbPerf(expectOnePerfLine(200));
    expectNoCanaryInLogs();
  });

  it("他人・無い項目 (行が返らない) は 404 (EXP-017 L4)", async () => {
    signedInWithEmail();
    const res = await PATCH(patch(ITEM_ID, patchBody), ctx(ITEM_ID));
    expect(res.status).toBe(404);
    expect(await res.json()).toHaveProperty("error");
    expectOwnerInEveryQuery();
    expectOnePerfLine(404);
    expectNoCanaryInLogs();
  });

  it("データベース未設定は 503 (EXP-017 L4)", async () => {
    signedInWithEmail();
    db.state.configured = false;
    const res = await PATCH(patch(ITEM_ID, patchBody), ctx(ITEM_ID));
    expect(res.status).toBe(503);
    expect(await res.json()).toHaveProperty("error");
    expectOnePerfLine(503);
    expectNoCanaryInLogs();
  });
});

describe("DELETE /api/items/[id] (EXP-017 L4)", () => {
  it("セッション無しは 401 で DB を呼ばない (EXP-017 L4)", async () => {
    const res = await DELETE(del(ITEM_ID), ctx(ITEM_ID));
    expect(res.status).toBe(401);
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine(401);
  });

  it("UUID でない id は 400 で DB を呼ばない (EXP-017 L4)", async () => {
    signedInWithEmail();
    const res = await DELETE(del("not-a-uuid"), ctx("not-a-uuid"));
    expect(res.status).toBe(400);
    expect(db.state.calls).toHaveLength(0);
    expectOnePerfLine(400);
  });

  it("204・owner はメール・db_ms と row_count (EXP-017 L4)", async () => {
    signedInWithEmail();
    db.state.rows = [{ id: ITEM_ID }];
    const res = await DELETE(del(ITEM_ID), ctx(ITEM_ID));
    expect(res.status).toBe(204);
    expectOwnerInEveryQuery();
    expect(db.state.calls.some((c) => c.values.includes(ITEM_ID))).toBe(true);
    expectDbPerf(expectOnePerfLine(204));
    expectNoCanaryInLogs();
  });

  it("他人・無い項目 (行が返らない) は 404 (EXP-017 L4)", async () => {
    signedInWithEmail();
    const res = await DELETE(del(ITEM_ID), ctx(ITEM_ID));
    expect(res.status).toBe(404);
    expect(await res.json()).toHaveProperty("error");
    expectOwnerInEveryQuery();
    expectOnePerfLine(404);
  });

  it("データベース未設定は 503 (EXP-017 L4)", async () => {
    signedInWithEmail();
    db.state.configured = false;
    const res = await DELETE(del(ITEM_ID), ctx(ITEM_ID));
    expect(res.status).toBe(503);
    expect(await res.json()).toHaveProperty("error");
    expectOnePerfLine(503);
  });
});
