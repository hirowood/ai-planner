import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authState } from "../test/mocks/next-auth";
import { capturePerf } from "../test/mocks/fetch";
import { todayJst } from "./smart";

// ToDo の時刻・全プロジェクトの予定・日常のタスクの API (EXP-039 L2・EXP-040 L2)
const db = vi.hoisted(() => {
  type Call = { strings: string[]; values: unknown[] };
  const state = { calls: [] as Call[], todoExists: true, taskExists: true, rows: [] as Record<string, unknown>[] };
  const text = (c: Call) => c.strings.join(" ").toLowerCase().replace(/\s+/g, " ");
  const T = "2026-10-02T00:00:00.000Z";
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call = { strings: [...strings], values };
    state.calls.push(call);
    const q = text(call);
    if (/insert into item_slots/.test(q)) return state.todoExists ? [{ item_id: values[0] }] : [];
    if (/delete from item_slots/.test(q)) return [];
    if (/from plan_items/.test(q) && /where id =/.test(q)) {
      return state.todoExists ? [{ id: values[0], project_id: "p", parent_id: null, level: "todo", title: "t", target: "", due_date: null, status: "todo", created_at: T, updated_at: T }] : [];
    }
    if (/insert into daily_tasks/.test(q)) return [{ id: "11111111-1111-4111-8111-111111111111", day: values[1], title: values[2], start_time: values[3], end_time: values[4], status: values[5], created_at: T }];
    if (/update daily_tasks/.test(q)) return state.taskExists ? [{ id: "11111111-1111-4111-8111-111111111111", day: "2026-10-02", title: "x", start_time: "", end_time: "", status: "done", created_at: T }] : [];
    if (/delete from daily_tasks/.test(q)) return state.taskExists ? [{ id: "x" }] : [];
    return state.rows;
  };
  return { state, sql, text };
});

vi.mock("next-auth", async () => (await import("../test/mocks/next-auth")).nextAuthMock);
vi.mock("../app/api/auth/[...nextauth]/route", async () => (await import("../test/mocks/next-auth")).authRouteMock);
vi.mock("./db", () => ({ DbNotConfigured: class extends Error {}, getSql: () => db.sql }));

import { PUT as slotPUT } from "../app/api/items/[id]/slot/route";
import { GET as slotsGET } from "../app/api/items/slots/route";
import { GET as scheduleGET } from "../app/api/items/schedule/route";
import { GET as tasksGET, POST as tasksPOST } from "../app/api/tasks/route";
import { DELETE as taskDELETE, PATCH as taskPATCH } from "../app/api/tasks/[id]/route";

const EMAIL = "canary-sched-2d8f@example.com";
const ID = "00000000-0000-4000-8000-000000000001";
const PID = "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b";
const TITLE = "canary-task-歯医者-6b1c";
const json = (body: unknown, method = "POST") => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const calls = (re: RegExp) => db.state.calls.filter((c) => re.test(db.text(c)));

let perf: ReturnType<typeof capturePerf>;
beforeEach(() => {
  perf = capturePerf();
  authState.session = { user: { name: "t", email: EMAIL }, expires: "2099-01-01" } as never;
  db.state.calls = [];
  db.state.todoExists = true;
  db.state.taskExists = true;
  db.state.rows = [];
});
afterEach(() => perf.restore());

describe("PUT /api/items/[id]/slot (EXP-039 L2)", () => {
  it("401・400 (id・時刻)", async () => {
    authState.session = null;
    expect((await slotPUT(new Request("http://l", json({ start: "09:00", end: "10:00" }, "PUT")), ctx(ID))).status).toBe(401);
    authState.session = { user: { email: EMAIL } } as never;
    expect((await slotPUT(new Request("http://l", json({ start: "09:00", end: "10:00" }, "PUT")), ctx("x"))).status).toBe(400);
    expect((await slotPUT(new Request("http://l", json({ start: "10:00", end: "09:00" }, "PUT")), ctx(ID))).status).toBe(400);
    expect(db.state.calls).toHaveLength(0);
  });
  it("時刻は upsert (持ち主の ToDo だけ)・両方空は消す・他人 / ToDo でない 404", async () => {
    const res = await slotPUT(new Request("http://l", json({ start: "09:00", end: "10:00" }, "PUT")), ctx(ID));
    expect(res.status).toBe(200);
    const up = calls(/insert into item_slots/)[0];
    expect(up.values).toEqual(expect.arrayContaining([ID, EMAIL, "09:00", "10:00"]));
    expect(db.text(up)).toContain("level = 'todo'");
    expect(db.text(up)).toContain("where item_slots.owner =");
    db.state.calls = [];
    expect((await slotPUT(new Request("http://l", json({ start: "", end: "" }, "PUT")), ctx(ID))).status).toBe(200);
    expect(calls(/delete from item_slots/)[0].values).toEqual(expect.arrayContaining([ID, EMAIL]));
    db.state.todoExists = false;
    expect((await slotPUT(new Request("http://l", json({ start: "09:00", end: "10:00" }, "PUT")), ctx(ID))).status).toBe(404);
    expect((await slotPUT(new Request("http://l", json({ start: "", end: "" }, "PUT")), ctx(ID))).status).toBe(404);
  });
  it("GET slots は owner と projectId で絞る", async () => {
    db.state.rows = [{ item_id: ID, start_time: "09:00", end_time: "10:00" }];
    const body = await (await slotsGET(new Request(`http://l/api/items/slots?projectId=${PID}`))).json();
    expect(body.slots).toEqual([{ itemId: ID, start: "09:00", end: "10:00" }]);
    expect(db.state.calls[0].values).toEqual(expect.arrayContaining([EMAIL, PID]));
  });
});

describe("GET /api/items/schedule (EXP-039 L2)", () => {
  it("全プロジェクトの ToDo を owner と期間で・しまったプロジェクトは除く・62 日を超えると 400", async () => {
    db.state.rows = [{ id: ID, project_id: PID, project_name: "英語", title: "単語", due_date: "2026-10-02", status: "todo", start_time: "09:00", end_time: "09:30" }];
    const body = await (await scheduleGET(new Request("http://l/api/items/schedule?from=2026-09-28&to=2026-11-01"))).json();
    expect(body.todos).toEqual([{ itemId: ID, projectId: PID, projectName: "英語", title: "単語", dueDate: "2026-10-02", status: "todo", start: "09:00", end: "09:30" }]);
    const q = db.state.calls[0];
    expect(q.values).toEqual(expect.arrayContaining([EMAIL, "2026-09-28", "2026-11-01"]));
    expect(db.text(q)).toContain("p.archived_at is null");
    expect(db.text(q)).toContain("i.owner =");
    expect(db.text(q)).toContain("p.owner =");
    for (const bad of ["from=2026-09-01&to=2026-11-02", "from=2026-10-02&to=2026-10-01", "from=x&to=2026-10-01", ""]) {
      expect((await scheduleGET(new Request(`http://l/api/items/schedule?${bad}`))).status).toBe(400);
    }
  });
});

describe("/api/tasks (EXP-040 L2)", () => {
  it("作る: owner をパラメータで・201・不正は 400 で DB を呼ばない・中身はログに無い", async () => {
    const res = await tasksPOST(new Request("http://l/api/tasks", json({ day: todayJst(), title: TITLE, start: "10:00", end: "11:00" })));
    expect(res.status).toBe(201);
    const ins = calls(/insert into daily_tasks/)[0];
    expect(ins.values).toEqual(expect.arrayContaining([EMAIL, todayJst(), TITLE, "10:00", "11:00", "todo"]));
    expect(ins.strings.join("")).not.toContain(EMAIL);
    db.state.calls = [];
    expect((await tasksPOST(new Request("http://l/api/tasks", json({ day: todayJst(), title: "" })))).status).toBe(400);
    expect(db.state.calls).toHaveLength(0);
    for (const c of [EMAIL, TITLE]) expect(perf.all.join(" ")).not.toContain(c);
  });
  it("一覧は owner と期間で・63 日は 400", async () => {
    await tasksGET(new Request("http://l/api/tasks?from=2026-10-01&to=2026-10-31"));
    expect(db.state.calls[0].values).toEqual(expect.arrayContaining([EMAIL, "2026-10-01", "2026-10-31"]));
    expect((await tasksGET(new Request("http://l/api/tasks?from=2026-10-01&to=2026-12-02"))).status).toBe(400);
  });
  it("変える / 消す: 持ち主のものだけ・他人 / 無い 404・401", async () => {
    const T_ID = "11111111-1111-4111-8111-111111111111";
    expect((await taskPATCH(new Request("http://l", json({ status: "done" }, "PATCH")), ctx(T_ID))).status).toBe(200);
    expect(calls(/update daily_tasks/)[0].values).toEqual(expect.arrayContaining([T_ID, EMAIL, "done"]));
    expect((await taskDELETE(new Request("http://l", { method: "DELETE" }), ctx(T_ID))).status).toBe(204);
    expect(calls(/delete from daily_tasks/)[0].values).toEqual(expect.arrayContaining([T_ID, EMAIL]));
    db.state.taskExists = false;
    expect((await taskPATCH(new Request("http://l", json({ status: "done" }, "PATCH")), ctx(T_ID))).status).toBe(404);
    expect((await taskDELETE(new Request("http://l", { method: "DELETE" }), ctx(T_ID))).status).toBe(404);
    expect((await taskPATCH(new Request("http://l", json({}, "PATCH")), ctx(T_ID))).status).toBe(400);
    authState.session = null;
    expect((await taskDELETE(new Request("http://l", { method: "DELETE" }), ctx(T_ID))).status).toBe(401);
  });
});
