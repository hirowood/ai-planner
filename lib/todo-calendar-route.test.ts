import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authState } from "../test/mocks/next-auth";
import { capturePerf, stubFetch } from "../test/mocks/fetch";

// ToDo を予定に入れる (EXP-030 L2・L3)
const db = vi.hoisted(() => {
  type Call = { strings: string[]; values: unknown[] };
  type Row = Record<string, unknown>;
  // item_events の 1 行を印 (event_id) つきで持つ。stale = 2 分より古い枠として扱う
  const state = {
    item: null as Row | null,
    row: null as { event_id: string } | null,
    stale: false,
    confirmThrows: false,
    beforeConfirm: null as null | (() => void),
    calls: [] as Call[],
    events: [] as Row[],
  };
  const text = (c: Call) => c.strings.join(" ").toLowerCase().replace(/\s+/g, " ");
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call = { strings: [...strings], values };
    state.calls.push(call);
    const q = text(call);
    if (/insert into item_events/.test(q)) {
      const ok = state.item && state.item.level === "todo" && state.item.due_date;
      const free = !state.row || (state.row.event_id.startsWith("pending") && state.stale);
      if (!ok || !free) return [];
      state.row = { event_id: String(values[2]) };
      return [{ item_id: values[0] }];
    }
    if (/delete from item_events/.test(q)) {
      if (state.row && state.row.event_id === values[2]) state.row = null;
      return [];
    }
    if (/update item_events/.test(q)) {
      state.beforeConfirm?.();
      if (state.confirmThrows) throw Object.assign(new Error("db down"), { code: "57P01" });
      if (state.row && state.row.event_id === values[3]) {
        state.row = { event_id: String(values[0]) };
        return [{ item_id: values[1] }];
      }
      return [];
    }
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
  db.state.row = null;
  db.state.stale = false;
  db.state.confirmThrows = false;
  db.state.beforeConfirm = null;
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
    const claimCall = calls(/insert into item_events/)[0];
    expect(claimCall.values).toEqual(expect.arrayContaining([ID, EMAIL, "09:00", "09:30"]));
    expect(claimCall.strings.join("")).not.toContain(EMAIL);
    // 枠の印は一度きり (pending:uuid)。確定はその印の枠だけ (安全レビュー W1)
    const token = String(claimCall.values[2]);
    expect(token).toMatch(/^pending:[0-9a-f-]{36}$/);
    const confirm = calls(/update item_events/)[0];
    expect(confirm.values).toEqual(expect.arrayContaining(["g-123", EMAIL, ID, token]));
    expect(db.state.row).toEqual({ event_id: "g-123" });
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
    // 消すのは自分の印の枠
    expect(calls(/delete from item_events/)[0].values).toContain(String(calls(/insert into item_events/)[0].values[2]));
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

describe("枠の取り合いと二重の予定 (安全レビュー W1)", () => {
  type FetchCall = { url: string; method: string; signal: unknown };
  function stubGoogle(created = "g-1") {
    const seen: FetchCall[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
      seen.push({ url: String(url), method: init?.method ?? "GET", signal: init?.signal });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ id: created }), { status: 200 });
    }));
    return seen;
  }

  it("Google への問い合わせは打ち切りの signal つき", async () => {
    const seen = stubGoogle();
    expect((await post({})).status).toBe(200);
    expect(seen[0].signal).toBeInstanceOf(AbortSignal);
  });

  it("待っている間に別の要求が枠を取り直したら、作った予定を Google から消して 409 (二重にしない)", async () => {
    const seen = stubGoogle("g-mine");
    db.state.beforeConfirm = () => {
      db.state.row = { event_id: "pending:other-request" };
    };
    const res = await post({});
    expect(res.status).toBe(409);
    const del = seen.filter((c) => c.method === "DELETE");
    expect(del).toHaveLength(1);
    expect(del[0].url).toMatch(/\/events\/g-mine$/);
    // 別の要求の枠は消さない
    expect(db.state.row).toEqual({ event_id: "pending:other-request" });
    noCanary();
  });

  it("確定の記録が失敗したら、Google の予定を消して自分の枠を返す (あとで入れ直しても 2 つにならない)", async () => {
    const seen = stubGoogle("g-mine");
    db.state.confirmThrows = true;
    const res = await post({});
    expect(res.status).toBe(500);
    expect(seen.filter((c) => c.method === "DELETE")).toHaveLength(1);
    expect(db.state.row).toBeNull();
    noCanary();
  });

  it("2 分より古い作りかけの枠は取り直せる・作り終えた予定は取り直せない", async () => {
    stubGoogle();
    db.state.row = { event_id: "pending:stale" };
    db.state.stale = true;
    expect((await post({})).status).toBe(200);
    db.state.stale = true;
    expect((await post({})).status).toBe(409);
    // 取り直しの SQL は作りかけ (pending で始まる) だけを対象にする
    expect(db.text(calls(/insert into item_events/)[0])).toContain("where item_events.event_id like");
  });
});

describe("GET /api/items/events (EXP-030 L3)", () => {
  it("owner と projectId で絞り、作り終えた予定だけ", async () => {
    db.state.events = [{ item_id: ID, start_time: "09:00", end_time: "09:30" }];
    const res = await GET(new Request(`http://l/api/items/events?projectId=${PID}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ events: [{ itemId: ID, start: "09:00", end: "09:30" }] });
    const q = calls(/from item_events/)[0];
    expect(q.values).toEqual(expect.arrayContaining([EMAIL, PID, "pending%"]));
    expect(db.text(q)).toContain("e.event_id not like");
  });
  it("401・400", async () => {
    expect((await GET(new Request(`http://l/api/items/events?projectId=x`))).status).toBe(400);
    authState.session = null;
    expect((await GET(new Request(`http://l/api/items/events?projectId=${PID}`))).status).toBe(401);
  });
});
