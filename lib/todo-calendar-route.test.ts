import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authState } from "../test/mocks/next-auth";
import { capturePerf, stubFetch } from "../test/mocks/fetch";

// ToDo を予定に入れる (EXP-030 L2・L3)
const db = vi.hoisted(() => {
  type Call = { strings: string[]; values: unknown[] };
  type Row = Record<string, unknown>;
  const state = { item: null as Row | null, claimed: false, calls: [] as Call[], events: [] as Row[] };
  const text = (c: Call) => c.strings.join(" ").toLowerCase().replace(/\s+/g, " ");
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call = { strings: [...strings], values };
    state.calls.push(call);
    const q = text(call);
    if (/insert into item_events/.test(q)) {
      const ok = state.item && state.item.level === "todo" && state.item.due_date && !state.claimed;
      if (!ok) return [];
      state.claimed = true;
      return [{ item_id: values[0] }];
    }
    if (/delete from item_events/.test(q)) {
      state.claimed = false;
      return [];
    }
    if (/update item_events/.test(q)) return [];
    if (/from item_events/.test(q)) return state.events;
    if (/from plan_items/.test(q)) return state.item ? [state.item] : [];
    return [];
  };
  return { state, sql, text };
});

vi.mock("next-auth", async () => (await import("../test/mocks/next-auth")).nextAuthMock);
vi.mock("../app/api/auth/[...nextauth]/route", async () => (await import("../test/mocks/next-auth")).authRouteMock);
vi.mock("./db", () => ({ DbNotConfigured: class extends Error {}, getSql: () => db.sql }));

import { POST } from "../app/api/items/[id]/calendar/route";
import { GET } from "../app/api/items/events/route";

const EMAIL = "canary-cal-3f9a@example.com";
const TOKEN = "canary-cal-token-7b2d";
const TITLE = "canary-cal-title-1e8c";
const ID = "00000000-0000-4000-8000-000000000001";
const PID = "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b";
const T = "2026-10-01T00:00:00.000Z";
const todoRow = (extra: Record<string, unknown> = {}) => ({
  id: ID, project_id: PID, parent_id: null, level: "todo", title: TITLE, target: "", due_date: "2026-10-02", status: "todo",
  created_at: T, updated_at: T, ...extra,
});
const post = (body: unknown, id = ID) =>
  POST(
    new Request(`http://l/api/items/${id}/calendar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
const calls = (re: RegExp) => db.state.calls.filter((c) => re.test(db.text(c)));

let perf: ReturnType<typeof capturePerf>;
beforeEach(() => {
  perf = capturePerf();
  authState.session = { user: { name: "t", email: EMAIL }, accessToken: TOKEN } as never;
  db.state.item = todoRow();
  db.state.claimed = false;
  db.state.calls = [];
  db.state.events = [];
});
afterEach(() => {
  perf.restore();
  vi.unstubAllGlobals();
});

function noCanary() {
  const all = perf.all.join("\n");
  for (const c of [EMAIL, TOKEN, TITLE]) expect(all).not.toContain(c);
}

describe("POST /api/items/[id]/calendar (EXP-030 L2)", () => {
  it("トークンが無ければ 401 で DB も Google も呼ばない", async () => {
    authState.session = { user: { name: "t", email: EMAIL } } as never;
    const f = stubFetch({ body: { id: "g1" } });
    expect((await post({})).status).toBe(401);
    expect(db.state.calls).toHaveLength(0);
    expect(f.calls).toHaveLength(0);
  });
  it.each([
    ["UUID でない id", {}, "x"],
    ["片方だけの時刻", { start: "09:00" }, ID],
    ["end ≤ start", { start: "10:00", end: "09:00" }, ID],
    ["壊れた JSON", "{x", ID],
  ])("%s は 400 で Google を呼ばない", async (_l, body, id) => {
    const f = stubFetch({ body: { id: "g1" } });
    expect((await post(body, id)).status).toBe(400);
    expect(f.calls).toHaveLength(0);
  });
  it("他人・無い ToDo は 404", async () => {
    db.state.item = null;
    const f = stubFetch({ body: { id: "g1" } });
    expect((await post({})).status).toBe(404);
    expect(f.calls).toHaveLength(0);
  });
  it("ToDo でない・期日が無いものは 400", async () => {
    stubFetch({ body: { id: "g1" } });
    db.state.item = todoRow({ level: "kdi" });
    expect((await post({})).status).toBe(400);
    db.state.item = todoRow({ due_date: null });
    expect((await post({})).status).toBe(400);
  });
  it("時刻つきで作る: 中身はサーバが項目から作る (画面の summary は使わない)・event_id を保存・owner はパラメータ", async () => {
    let sent: unknown = null;
    const f = vi.fn(async (_url: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
      return new Response(JSON.stringify({ id: "g-123" }), { status: 200 });
    });
    vi.stubGlobal("fetch", f);
    const res = await post({ start: "09:00", end: "09:30", summary: "画面の件名", description: "画面の説明" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ event: { itemId: ID, start: "09:00", end: "09:30" } });
    expect(sent).toEqual({
      summary: `✅ ${TITLE}`,
      description: "ai-planner の ToDo",
      start: { dateTime: "2026-10-02T09:00:00+09:00" },
      end: { dateTime: "2026-10-02T09:30:00+09:00" },
    });
    const claim = calls(/insert into item_events/)[0];
    expect(claim.values).toEqual(expect.arrayContaining([ID, EMAIL, "pending", "09:00", "09:30"]));
    expect(claim.strings.join("")).not.toContain(EMAIL);
    const confirm = calls(/update item_events/)[0];
    expect(confirm.values).toEqual(expect.arrayContaining(["g-123", EMAIL, ID]));
    expect(calls(/delete from item_events/)).toHaveLength(0);
    const line = perf.parsed().find((l) => l.route === "api/items/[id]/calendar");
    expect(line).toMatchObject({ status: 200 });
    expect(typeof line?.calendar_ms).toBe("number");
    noCanary();
  });
  it("2 回目は 409 で Google を呼ばない (同じ ToDo に 2 つ作らない)", async () => {
    const f = stubFetch({ body: { id: "g1" } });
    expect((await post({})).status).toBe(200);
    expect((await post({})).status).toBe(409);
    expect(f.calls).toHaveLength(1);
  });
  it("Google が失敗したら枠を消して 502・401 は「もう一度ログイン」・中身はログに無い", async () => {
    stubFetch({ status: 401, body: { error: { message: TITLE } } });
    const res = await post({});
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("Google にもう一度ログイン");
    expect(calls(/delete from item_events/)).toHaveLength(1);
    expect(calls(/update item_events/)).toHaveLength(0);
    noCanary();
    // 枠を消したので、もう一度入れられる
    stubFetch({ body: { id: "g2" } });
    expect((await post({})).status).toBe(200);
  });
  it("Google が id を返さなければ 502 で枠を消す", async () => {
    stubFetch({ body: {} });
    expect((await post({})).status).toBe(502);
    expect(calls(/delete from item_events/)).toHaveLength(1);
  });
});

describe("GET /api/items/events (EXP-030 L3)", () => {
  it("owner と projectId で絞り、作り終えた予定だけ", async () => {
    db.state.events = [{ item_id: ID, start_time: "09:00", end_time: "09:30" }];
    const res = await GET(new Request(`http://l/api/items/events?projectId=${PID}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ events: [{ itemId: ID, start: "09:00", end: "09:30" }] });
    const q = calls(/from item_events/)[0];
    expect(q.values).toEqual(expect.arrayContaining([EMAIL, PID, "pending"]));
    expect(db.text(q)).toContain("e.event_id <>");
  });
  it("401・400", async () => {
    expect((await GET(new Request(`http://l/api/items/events?projectId=x`))).status).toBe(400);
    authState.session = null;
    expect((await GET(new Request(`http://l/api/items/events?projectId=${PID}`))).status).toBe(401);
  });
});
