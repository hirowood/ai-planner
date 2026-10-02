import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authState } from "../test/mocks/next-auth";
import { geminiState } from "../test/mocks/generative-ai";
import { capturePerf } from "../test/mocks/fetch";
import { todayJst } from "./smart";

// /api/daily と、/api/coach に毎日の記録が入ること (EXP-020 L3・L4)
const db = vi.hoisted(() => {
  type Call = { strings: string[]; values: unknown[] };
  type Row = Record<string, unknown>;
  const state = { hasProject: true, logs: [] as Row[], calls: [] as Call[] };
  const text = (c: Call) => c.strings.join(" ").toLowerCase().replace(/\s+/g, " ");
  const T = "2026-10-01T00:00:00.000Z";
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call = { strings: [...strings], values };
    state.calls.push(call);
    const q = text(call);
    if (/insert into daily_logs/.test(q)) {
      if (!state.hasProject) return [];
      return [{ project_id: values[1], day: values[2], mark: values[3], goods: values[4], tomorrow: values[5], updated_at: T }];
    }
    if (/from daily_logs/.test(q)) return state.logs;
    if (/insert into messages/.test(q)) return [{ id: "m" }];
    if (/insert into cycles|update cycles/.test(q)) return [{ id: "9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", project_id: values[1], phase: "plan", plan: {}, created_at: T, updated_at: T }];
    if (/from plan_items|from notes|from messages|from cycles/.test(q)) return [];
    if (/from projects/.test(q)) return state.hasProject ? [{ id: values[0], name: "英語", category: "learning", purpose: "", created_at: T, archived_at: null }] : [];
    return [];
  };
  return { state, sql, text };
});

vi.mock("next-auth", async () => (await import("../test/mocks/next-auth")).nextAuthMock);
vi.mock("../app/api/auth/[...nextauth]/route", async () => (await import("../test/mocks/next-auth")).authRouteMock);
vi.mock("@google/generative-ai", async () => (await import("../test/mocks/generative-ai")).generativeAiMock);
vi.mock("./db", () => ({ DbNotConfigured: class extends Error {}, getSql: () => db.sql }));

import { GET, PUT } from "../app/api/daily/route";
import { POST as coachPOST } from "../app/api/coach/route";

const EMAIL = "canary-daily-4e2a@example.com";
const PID = "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b";
const GOOD_CANARY = "canary-daily-good-9b1c";
const TOMORROW_CANARY = "canary-daily-tomorrow-6d3e";
const ALLOWED = ["route", "status", "total_ms", "db_ms", "row_count", "fields_filled"];

const put = (body: unknown) =>
  PUT(new Request("http://l/api/daily", { method: "PUT", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));
const get = (q: string) => GET(new Request(`http://l/api/daily${q}`));
const valid = () => ({ projectId: PID, day: todayJst(), mark: "fair", goods: [GOOD_CANARY], tomorrow: TOMORROW_CANARY });
const writes = () => db.state.calls.filter((c) => /insert into daily_logs/.test(db.text(c)));

let perf: ReturnType<typeof capturePerf>;
beforeEach(() => {
  perf = capturePerf();
  authState.session = { user: { name: "t", email: EMAIL }, expires: "2099-01-01" } as never;
  db.state.hasProject = true;
  db.state.logs = [];
  db.state.calls = [];
  geminiState.failWith = null;
  geminiState.failTimes = null;
});
afterEach(() => perf.restore());

function onePerfLine(status: number) {
  const lines = perf.parsed().filter((l) => l.route === "api/daily");
  expect(lines).toHaveLength(1);
  expect(Object.keys(lines[0]).filter((k) => !ALLOWED.includes(k))).toEqual([]);
  expect(lines[0]).toMatchObject({ status });
  return lines[0];
}
function noCanary() {
  const all = perf.all.join("\n");
  for (const c of [EMAIL, GOOD_CANARY, TOMORROW_CANARY]) expect(all).not.toContain(c);
}

describe("/api/daily (EXP-020 L3)", () => {
  it("セッション無しは 401 で DB を呼ばない", async () => {
    authState.session = null;
    expect((await put(valid())).status).toBe(401);
    expect((await get(`?projectId=${PID}`)).status).toBe(401);
    expect(db.state.calls).toHaveLength(0);
  });
  it.each([
    ["壊れた JSON", "{x"],
    ["明日の日付", { ...valid(), day: "2999-01-01" }],
    ["mark 違い", { ...valid(), mark: "〇" }],
    ["101 字の良かったこと", { ...valid(), goods: ["あ".repeat(101)] }],
  ])("%s は 400 で DB を呼ばない", async (_l, body) => {
    expect((await put(body)).status).toBe(400);
    expect(db.state.calls).toHaveLength(0);
    onePerfLine(400);
  });
  it("GET の projectId が UUID でなければ 400", async () => {
    expect((await get("?projectId=p1")).status).toBe(400);
  });
  it("PUT は upsert (on conflict) で owner をパラメータで渡し、fields_filled を出す・中身はログに無い", async () => {
    const res = await put(valid());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.log).toMatchObject({ projectId: PID, day: todayJst(), mark: "fair", goods: [GOOD_CANARY], tomorrow: TOMORROW_CANARY });
    const w = writes();
    expect(w).toHaveLength(1);
    expect(db.text(w[0])).toContain("on conflict (owner, project_id, day) do update");
    expect(db.text(w[0])).toContain("archived_at is null");
    expect(w[0].values).toContain(EMAIL);
    expect(w[0].strings.join("")).not.toContain(EMAIL);
    expect(onePerfLine(200)).toMatchObject({ fields_filled: 3 });
    noCanary();
  });
  it("他人・無いプロジェクトは 404", async () => {
    db.state.hasProject = false;
    expect((await put(valid())).status).toBe(404);
    onePerfLine(404);
  });
  it("GET は owner と projectId で絞り、row_count と today を返す", async () => {
    db.state.logs = [{ project_id: PID, day: "2026-09-30", mark: "good", goods: JSON.stringify([GOOD_CANARY]), tomorrow: "", updated_at: "2026-09-30T12:00:00.000Z" }];
    const res = await get(`?projectId=${PID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.today).toBe(todayJst());
    expect(body.logs).toEqual([{ projectId: PID, day: "2026-09-30", mark: "good", goods: [GOOD_CANARY], tomorrow: "", updatedAt: "2026-09-30T12:00:00.000Z" }]);
    const reads = db.state.calls.filter((c) => /from daily_logs/.test(db.text(c)));
    expect(reads[0].values).toEqual(expect.arrayContaining([EMAIL, PID]));
    expect(onePerfLine(200)).toMatchObject({ row_count: 1 });
    noCanary();
  });
});

describe("/api/coach に毎日の記録 (EXP-020 L4)", () => {
  it("<Records> の中に毎日の記録・context_days", async () => {
    db.state.logs = [{ project_id: PID, day: "2026-09-30", mark: "bad", goods: [GOOD_CANARY], tomorrow: TOMORROW_CANARY, updated_at: "2026-09-30T12:00:00.000Z" }];
    geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [] });
    const res = await coachPOST(new Request("http://l/api/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: PID, message: "どう？" }) }));
    expect(res.status).toBe(200);
    const p = geminiState.lastPrompt ?? "";
    const inRecords = p.slice(p.indexOf("<Records>"), p.indexOf("</Records>"));
    expect(inRecords).toContain("#### 毎日の記録");
    expect(inRecords).toContain(`- 2026-09-30 × / 良かったこと: ${GOOD_CANARY} / 明日は: ${TOMORROW_CANARY}`);
    expect(perf.parsed().find((l) => l.route === "api/coach")).toMatchObject({ context_days: 1 });
    noCanary();
  });
});
