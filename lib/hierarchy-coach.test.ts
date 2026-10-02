import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authState } from "../test/mocks/next-auth";
import { geminiState } from "../test/mocks/generative-ai";
import { capturePerf } from "../test/mocks/fetch";
import { todayJst } from "./smart";

// /api/coach が階層を読み、次の段の候補を聞き、決まった項目を次の段の親の下に足す (EXP-019 L3)
const db = vi.hoisted(() => {
  type Call = { strings: string[]; values: unknown[] };
  type Row = Record<string, unknown>;
  const state = { items: [] as Row[], calls: [] as Call[], refuseInsert: false };
  const text = (c: Call) => c.strings.join(" ").toLowerCase().replace(/\s+/g, " ");
  const T = "2026-10-01T00:00:00.000Z";
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call = { strings: [...strings], values };
    state.calls.push(call);
    const q = text(call);
    if (/insert into plan_items/.test(q)) {
      if (state.refuseInsert) return [];
      // values: owner, projectId, parentId, level, title, target, dueDate, status, ...
      return [{
        id: `00000000-0000-4000-8000-0000000009${String(state.calls.length).padStart(2, "0")}`,
        project_id: values[1], parent_id: values[2], level: values[3], title: values[4], target: values[5],
        due_date: values[6], status: values[7], created_at: T, updated_at: T,
      }];
    }
    if (/insert into messages/.test(q)) return [{ id: "m" }];
    if (/insert into cycles|update cycles/.test(q)) {
      return [{ id: "9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", project_id: values[1], phase: "plan", plan: {}, created_at: T, updated_at: T }];
    }
    if (/from plan_items/.test(q)) return state.items;
    if (/from notes|from messages|from cycles/.test(q)) return [];
    if (/from projects/.test(q)) {
      return [{ id: "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b", owner: "x", name: "英語", category: "learning", purpose: "", created_at: T, archived_at: null }];
    }
    return [];
  };
  return { state, sql, text };
});

vi.mock("next-auth", async () => (await import("../test/mocks/next-auth")).nextAuthMock);
vi.mock("../app/api/auth/[...nextauth]/route", async () => (await import("../test/mocks/next-auth")).authRouteMock);
vi.mock("@google/generative-ai", async () => (await import("../test/mocks/generative-ai")).generativeAiMock);
vi.mock("./db", () => ({ DbNotConfigured: class extends Error {}, getSql: () => db.sql }));

import { POST } from "../app/api/coach/route";

const EMAIL = "canary-hier-7c1d@example.com";
const PID = "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b";
const KGI_ID = "00000000-0000-4000-8000-000000000001";
const KPI_ID = "00000000-0000-4000-8000-000000000002";
const KGI_CANARY = "canary-hier-kgi-2b9e";
const ITEM_CANARY = "canary-hier-item-5f3a";
const T = "2026-10-01T00:00:00.000Z";
const row = (id: string, level: string, parent: string | null, title: string) => ({
  id, project_id: PID, parent_id: parent, level, title, target: "", due_date: null, status: "todo", created_at: T, updated_at: T,
});

function post(message = "それにします") {
  return new Request("http://l/api/coach", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: PID, message }),
  });
}
const inserts = () => db.state.calls.filter((c) => /insert into plan_items/.test(db.text(c)));

describe("POST /api/coach — 階層の次の段 (EXP-019 L3)", () => {
  let perf: ReturnType<typeof capturePerf>;
  beforeEach(() => {
    perf = capturePerf();
    authState.session = { user: { name: "t", email: EMAIL }, expires: "2099-01-01" } as never;
    geminiState.failWith = null;
    geminiState.failTimes = null;
    db.state.items = [row(KGI_ID, "kgi", null, KGI_CANARY)];
    db.state.calls = [];
    db.state.refuseInsert = false;
  });
  afterEach(() => perf.restore());

  it("プロンプトに階層と次に決める段 (KGI の下の KPI) が入る", async () => {
    geminiState.reply = JSON.stringify({ reply: "どれにしますか？", plan: {}, choices: ["a", "b"], items: [] });
    await POST(post());
    const p = geminiState.lastPrompt ?? "";
    expect(p).toContain("#### 階層 (KGI → KPI → KDI → ToDo)");
    expect(p).toContain(`- KGI: ${KGI_CANARY}`);
    expect(p).toContain("次に決める段: KPI (途中の指標) (親: KGI (ゴール)「" + KGI_CANARY + "」の下)");
    expect(p).toContain("期限までに KGI を達成できているかを途中で測る数");
    expect(p).toContain("ユーザーが候補を選んだ・同意した・自分で言ったときだけ");
    // 階層の要約は <Records> の中
    expect(p.indexOf("#### 階層")).toBeLessThan(p.indexOf("</Records>"));
  });

  it("AI の items は次の段の親 (KGI) の下に KPI として作られ、itemsAdded と items_added が返る", async () => {
    geminiState.reply = JSON.stringify({
      reply: "足しました。次は KDI を決めましょう。",
      plan: {},
      choices: [],
      items: [{ title: ITEM_CANARY, target: "700 点", dueDate: "2026-11-30", parentId: "00000000-0000-4000-8000-000000000099", level: "todo" }],
    });
    const res = await POST(post());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.itemsAdded).toEqual([{ level: "kpi", title: ITEM_CANARY }]);
    const ins = inserts();
    expect(ins).toHaveLength(1);
    expect(ins[0].values).toContain(KGI_ID);
    expect(ins[0].values).toContain("kpi");
    expect(ins[0].values).toContain(EMAIL);
    expect(ins[0].values).not.toContain("00000000-0000-4000-8000-000000000099");
    expect(perf.parsed().find((l) => l.route === "api/coach")).toMatchObject({ status: 200, items_added: 1 });
    // 中身とメールはログに出ない
    const logs = perf.all.join("\n");
    for (const c of [EMAIL, ITEM_CANARY, KGI_CANARY]) expect(logs).not.toContain(c);
  });

  it("KPI があり KDI が無ければ、KPI の下に KDI として作る", async () => {
    db.state.items = [row(KGI_ID, "kgi", null, KGI_CANARY), row(KPI_ID, "kpi", KGI_ID, "模試 700")];
    geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [{ title: "週 3 回 単語 30 分" }] });
    const body = await (await POST(post())).json();
    expect(body.itemsAdded).toEqual([{ level: "kdi", title: "週 3 回 単語 30 分" }]);
    // KDI の段の決め方 (EXP-031): 全部で 3 つほど・判定基準
    expect(geminiState.lastPrompt ?? "").toContain("全部で 3 つほど決めます。判定基準 (何をもって達成か)");
    expect(inserts()[0].values).toContain(KPI_ID);
    expect(inserts()[0].values).toContain("kdi");
  });

  it("items が無い・空なら作らない (items_added: 0・itemsAdded: [])", async () => {
    geminiState.reply = JSON.stringify({ reply: "どれにしますか？", plan: {}, choices: ["a"] });
    const body = await (await POST(post())).json();
    expect(body.itemsAdded).toEqual([]);
    expect(inserts()).toHaveLength(0);
    expect(perf.parsed().find((l) => l.route === "api/coach")).toMatchObject({ items_added: 0 });
  });

  it("KGI が無ければ items は作らず、新しいプロジェクトを勧める指示が入る", async () => {
    db.state.items = [];
    geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [{ title: "x" }] });
    const body = await (await POST(post())).json();
    expect(body.itemsAdded).toEqual([]);
    expect(inserts()).toHaveLength(0);
    expect(geminiState.lastPrompt ?? "").toContain("「新しいプロジェクト」から SMART で KGI を作ることを勧めてください");
  });

  it("KDI が 3 つそろうと今日の ToDo の段: プロンプトに目安と判定基準・今日の期日で最初の KDI の下に作る (EXP-031 L3)", async () => {
    const KDI_A = "00000000-0000-4000-8000-000000000003";
    db.state.items = [
      row(KGI_ID, "kgi", null, KGI_CANARY),
      row(KPI_ID, "kpi", KGI_ID, "模試 700"),
      row(KDI_A, "kdi", KPI_ID, "単語 毎日 30 分"),
      row("00000000-0000-4000-8000-000000000004", "kdi", KPI_ID, "文法"),
      row("00000000-0000-4000-8000-000000000005", "kdi", KPI_ID, "リスニング"),
    ];
    geminiState.reply = JSON.stringify({
      reply: "ok", plan: {}, choices: [],
      items: [{ title: "単語 1〜30", target: "30 個を言える" }, { title: "明日の分", dueDate: "2999-01-01" }],
    });
    const body = await (await POST(post())).json();
    const p = geminiState.lastPrompt ?? "";
    expect(p).toContain("今日 3 つほど (1 日 9 つほど)");
    expect(p).toContain("判定基準 (何をもって達成か)");
    expect(p).toContain(`次に決める段: 今日 (${todayJst()}) の ToDo`);
    expect(p).toContain("この KDI の今日の ToDo は今 0 つです。あと 3 つまで足せます。");
    expect(body.itemsAdded).toEqual([{ level: "todo", title: "単語 1〜30" }]);
    const ins = inserts();
    expect(ins).toHaveLength(1);
    expect(ins[0].values).toEqual(expect.arrayContaining([KDI_A, "todo", todayJst(), "30 個を言える"]));
  });

  it("DB が作るのを断った (親が他人など) ものは itemsAdded に入れない", async () => {
    db.state.refuseInsert = true;
    geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [{ title: "x" }] });
    const body = await (await POST(post())).json();
    expect(inserts()).toHaveLength(1);
    expect(body.itemsAdded).toEqual([]);
  });
});
