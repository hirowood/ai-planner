import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authState } from "../test/mocks/next-auth";
import { geminiState } from "../test/mocks/generative-ai";
import { capturePerf } from "../test/mocks/fetch";
import { todayJst } from "./smart";
import { GEMINI_MODEL, GEMINI_MODEL_DEEP } from "./model";

// /api/coach が階層を読み、次の段の候補を聞き、決まった項目を次の段の親の下に足す (EXP-019 L3)
const db = vi.hoisted(() => {
  type Call = { strings: string[]; values: unknown[] };
  type Row = Record<string, unknown>;
  const state = { items: [] as Row[], calls: [] as Call[], refuseInsert: false, notes: [] as Row[], failMessages: false, tasks: [] as Row[], history: [] as Row[] };
  const text = (c: Call) => c.strings.join(" ").toLowerCase().replace(/\s+/g, " ");
  const T = "2026-10-01T00:00:00.000Z";
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call = { strings: [...strings], values };
    state.calls.push(call);
    const q = text(call);
    if (/update plan_items set title = coalesce/.test(q)) {
      // updateItem: 値 = title, target, status, hasDue, dueDate, id, owner, touchesLocked
      const target = state.items.find((r) => r.id === values[5] && r.level !== "kgi");
      if (!target) return [];
      if (values[0] !== null) target.title = values[0];
      if (values[1] !== null) target.target = values[1];
      if (values[3]) target.due_date = values[4];
      return [{ ...target }];
    }
    if (/update plan_items set status/.test(q)) {
      // judgeItem: 値 = status, id, owner。今の状態が done のときだけ更新できる
      const target = state.items.find((r) => r.id === values[1] && r.level === "todo" && r.status === "done");
      if (!target) return [];
      target.status = values[0];
      return [{ ...target }];
    }
    if (/insert into plan_items/.test(q)) {
      if (state.refuseInsert) return [];
      // values: owner, projectId, parentId, level, title, target, dueDate, status, ...
      return [{
        id: `00000000-0000-4000-8000-0000000009${String(state.calls.length).padStart(2, "0")}`,
        project_id: values[1], parent_id: values[2], level: values[3], title: values[4], target: values[5],
        due_date: values[6], status: values[7], created_at: T, updated_at: T,
      }];
    }
    if (/insert into item_slots/.test(q)) return [{ item_id: values[0] }];
    if (/from daily_tasks/.test(q)) return state.tasks;
    if (/insert into notes/.test(q)) return [{ id: "n-1", project_id: values[1], kind: values[2], body: values[3], created_at: T }];
    if (/insert into messages/.test(q)) {
      if (state.failMessages) throw Object.assign(new Error("db down"), { code: "57P01" });
      return [{ id: "m" }];
    }
    if (/insert into cycles|update cycles/.test(q)) {
      return [{ id: "9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", project_id: values[1], phase: "plan", plan: {}, created_at: T, updated_at: T }];
    }
    if (/from plan_items/.test(q)) return state.items;
    if (/from notes/.test(q)) return state.notes;
    if (/from messages/.test(q)) return state.history;
    if (/from cycles/.test(q)) return [];
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

// EXP-043: 会話は目的ごと。thread を指定しないテストは、階層の状態に合う会話 (前の「次の段」と同じ) を使う
function autoThread(): string {
  const items = db.state.items;
  if (!items.some((r) => r.level === "kpi")) return "kpi";
  if (!items.some((r) => r.level === "kdi")) return "kdi";
  return "todo";
}
function post(message = "それにします", extra: Record<string, unknown> = {}) {
  return new Request("http://l/api/coach", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: PID, message, thread: autoThread(), ...extra }),
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
    db.state.notes = [];
    db.state.failMessages = false;
    db.state.tasks = [];
    db.state.history = [];
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
    // EXP-035: 候補は candidates・確認しない (EXP-019 の「同意したときだけ」を置き換え)
    expect(p).toContain('"candidates" に {"title", "target" (判定基準)} で入れてください');
    expect(p).not.toContain("ユーザーが候補を選んだ・同意した・自分で言ったときだけ");
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

  it("KDI が 2 つあれば、あと 1 つしか作らない (安全レビュー W5)", async () => {
    db.state.items = [
      row(KGI_ID, "kgi", null, KGI_CANARY),
      row(KPI_ID, "kpi", KGI_ID, "模試 700"),
      row("00000000-0000-4000-8000-000000000003", "kdi", KPI_ID, "単語"),
      row("00000000-0000-4000-8000-000000000004", "kdi", KPI_ID, "文法"),
      // EXP-035: 今日の ToDo がそろってから KDI を足す段になる
      ...[3, 4].flatMap((k) => [1, 2, 3].map((n) => ({
        ...row(`00000000-0000-4000-8000-0000000001${k}${n}`, "todo", `00000000-0000-4000-8000-00000000000${k}`, `t${k}${n}`),
        due_date: todayJst(),
      }))),
    ];
    geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [{ title: "x" }, { title: "y" }, { title: "z" }] });
    const body = await (await POST(post("x", { thread: "kdi" }))).json();
    expect(body.itemsAdded).toEqual([{ level: "kdi", title: "x" }]);
    expect(inserts()).toHaveLength(1);
    expect(geminiState.lastPrompt ?? "").toContain('その KDI (行動の目標) を "items" に入れてください (最大 1 個)');
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

  it("判定と調整の節・進み具合が <Records> の中・同意した仮説をノート (仮説) に残す (EXP-032 L2・L3)", async () => {
    const HYP = "canary-hyp-朝にやれば続くはず-4c7e";
    geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [], hypothesis: `  ${HYP} ` });
    const body = await (await POST(post())).json();
    const p = geminiState.lastPrompt ?? "";
    const rec = p.slice(p.indexOf("<Records>"), p.indexOf("</Records>"));
    expect(rec).toContain("#### 進み具合と期限 (最近 7 日)");
    expect(rec).toContain(`- KGI: ${KGI_CANARY} / 期日なし`);
    expect(p).toContain("**できた所から先に**伝え");
    expect(p).toContain("「KPI / 行動 / そのまま続ける」");
    expect(p).toContain("「〜すれば、〜になるはず」");
    expect(p).not.toContain("課題 / 行動 / そのまま続ける");
    expect(body.hypothesisSaved).toBe(true);
    const ins = db.state.calls.filter((c) => /insert into notes/.test(db.text(c)));
    expect(ins).toHaveLength(1);
    expect(ins[0].values).toEqual(expect.arrayContaining([EMAIL, PID, "仮説", HYP]));
    expect(ins[0].strings.join("")).not.toContain(EMAIL);
    expect(perf.parsed().find((l) => l.route === "api/coach")).toMatchObject({ hypothesis_saved: true });
    const logs = perf.all.join(" ");
    for (const c of [EMAIL, HYP]) expect(logs).not.toContain(c);
  });

  it.each([
    ["空", ""],
    ["空白だけ", "   "],
    ["301 字", "あ".repeat(301)],
    ["文字列でない", ["x"]],
    ["無い", undefined],
  ])("仮説が %s なら残さない (EXP-032 L3)", async (_l, hypothesis) => {
    geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [], hypothesis });
    const body = await (await POST(post())).json();
    expect(body.hypothesisSaved).toBe(false);
    expect(db.state.calls.filter((c) => /insert into notes/.test(db.text(c)))).toHaveLength(0);
    expect(perf.parsed().find((l) => l.route === "api/coach")).toMatchObject({ hypothesis_saved: false });
  });

  it("最近のノートに同じ仮説があれば残さない (レビュー W1)", async () => {
    db.state.notes = [{ id: "n-0", project_id: PID, kind: "仮説", body: "朝にやれば続くはず", created_at: T }];
    geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [], hypothesis: "朝にやれば続くはず" });
    const body = await (await POST(post())).json();
    expect(body.hypothesisSaved).toBe(false);
    expect(db.state.calls.filter((c) => /insert into notes/.test(db.text(c)))).toHaveLength(0);
  });

  it("会話の保存が失敗したら仮説は残さない (送り直しで 2 つにならない・レビュー W2)", async () => {
    db.state.failMessages = true;
    geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [], hypothesis: "朝にやれば続くはず" });
    const res = await POST(post());
    expect(res.status).toBe(500);
    expect(db.state.calls.filter((c) => /insert into notes/.test(db.text(c)))).toHaveLength(0);
  });

  describe("完了した ToDo の判定 (EXP-034 L3)", () => {
    const TODO_ID = "00000000-0000-4000-8000-000000000010";
    const OTHER_ID = "00000000-0000-4000-8000-000000000011";
    const TITLE = "canary-todo-単語 30 個-5d1a";
    const setup = () => {
      db.state.items = [
        row(KGI_ID, "kgi", null, KGI_CANARY),
        row(KPI_ID, "kpi", KGI_ID, "模試 700"),
        row("00000000-0000-4000-8000-000000000003", "kdi", KPI_ID, "単語"),
        { ...row(OTHER_ID, "todo", "00000000-0000-4000-8000-000000000003", "古い完了"), due_date: todayJst(), status: "done", updated_at: "2026-10-01T00:00:00.000Z" },
        { ...row(TODO_ID, "todo", "00000000-0000-4000-8000-000000000003", TITLE), due_date: todayJst(), status: "done", target: "30 個を言える", updated_at: "2026-10-02T09:00:00.000Z" },
      ];
    };

    it("判定を待っている ToDo の節・候補の 3 つ・C → A → 次の Plan・items は足さない", async () => {
      setup();
      geminiState.reply = JSON.stringify({ reply: "どうでしたか？", plan: {}, choices: [], items: [{ title: "足してはいけない" }], judgement: "" });
      const body = await (await POST(post("『x』を完了しました。判定をお願いします"))).json();
      const p = geminiState.lastPrompt ?? "";
      expect(p).toContain("### 判定を待っている ToDo (EXP-034)");
      expect(p).toContain(`- ToDo: ${TITLE} / 判定基準: 30 個を言える`);
      expect(p).toContain("「判定基準を満たした」「一部できた」「できなかった」");
      expect(p).toContain("振り返り (C) → 調整の型 (A: KPI / 行動 / そのまま続ける) → 次の Plan");
      expect(body.itemsAdded).toEqual([]);
      expect(inserts()).toHaveLength(0);
      expect(body.judged).toBeNull();
      expect(perf.parsed().find((l) => l.route === "api/coach")).toMatchObject({ judgement_applied: false });
    });

    it("決まった判定は、一番新しく完了した ToDo にだけ入る (owner をパラメータで)", async () => {
      setup();
      geminiState.reply = JSON.stringify({ reply: "よくできました", plan: {}, choices: [], items: [], judgement: "succeeded" });
      const body = await (await POST(post("判定基準を満たした"))).json();
      expect(body.judged).toEqual({ title: TITLE, status: "succeeded" });
      const ups = db.state.calls.filter((c) => /update plan_items set status/.test(db.text(c)));
      expect(ups).toHaveLength(1);
      expect(ups[0].values).toEqual(expect.arrayContaining(["succeeded", TODO_ID, EMAIL]));
      expect(ups[0].values).not.toContain(OTHER_ID);
      expect(db.text(ups[0])).toContain("status = 'done'");
      expect(perf.parsed().find((l) => l.route === "api/coach")).toMatchObject({ judgement_applied: true });
      const logs = perf.all.join(" ");
      for (const c of [EMAIL, TITLE]) expect(logs).not.toContain(c);
    });

    it.each(["chat", "kgi", "kpi", "kdi"])("判定は ✅ ToDo の会話だけ — %s では判定しない (EXP-043)", async (thread) => {
      setup();
      geminiState.reply = JSON.stringify({ reply: "よくできました", plan: {}, choices: [], items: [], judgement: "succeeded" });
      const body = await (await POST(post("判定基準を満たした", { thread }))).json();
      expect(body.judged ?? null).toBeNull();
      expect(db.state.calls.some((c) => /update plan_items set status/.test(db.text(c)))).toBe(false);
    });

    it.each([["空", ""], ["知らない値", "done"], ["無い", undefined]])("判定が %s なら更新しない", async (_l, judgement) => {
      setup();
      geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [], judgement });
      const body = await (await POST(post())).json();
      expect(body.judged).toBeNull();
      expect(db.state.calls.filter((c) => /update plan_items set status/.test(db.text(c)))).toHaveLength(0);
    });

    it("判定を待っている ToDo が無ければ、AI が判定を返しても何も更新しない", async () => {
      geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [], judgement: "failed" });
      const body = await (await POST(post())).json();
      expect(body.judged).toBeNull();
      expect(db.state.calls.filter((c) => /update plan_items set status/.test(db.text(c)))).toHaveLength(0);
      expect(geminiState.lastPrompt ?? "").not.toContain("### 判定を待っている ToDo");
    });
  });

  describe("候補をボタン 1 回で足す (EXP-035 L3・L4)", () => {
    const PICK = "canary-pick-模試の過去問 1 回-7e2b";

    it("pick は AI に聞く前に今の段 (KGI の下の KPI) として足し、確認しない指示が入る", async () => {
      geminiState.reply = JSON.stringify({ reply: "次は KDI ですね", plan: {}, choices: [], items: [] });
      const body = await (await POST(post(`『${PICK}』にします`, { pick: { title: PICK, target: "700 点" } }))).json();
      expect(body.itemsAdded).toEqual([{ level: "kpi", title: PICK }]);
      const ins = inserts();
      expect(ins).toHaveLength(1);
      expect(ins[0].values).toEqual(expect.arrayContaining([KGI_ID, "kpi", PICK, "700 点", EMAIL]));
      // AI に聞く前に足した: プロンプトに足した項目と「確認の質問はせず」
      const p = geminiState.lastPrompt ?? "";
      expect(p).toContain("### いまユーザーが選んで足した項目 (EXP-035)");
      expect(p).toContain(`KPI (途中の指標)『${PICK}』をサーバが階層に足しました。確認の質問はせず、次へ進んでください。`);
      // EXP-043: KPI の会話は KPI だけを扱う (足した後も KPI の段のまま・KDI は 🧭 KDI の会話で)
      expect(p).toContain("次に決める段: KPI (途中の指標)");
      expect(p).toContain("この会話は「KPI」です");
      expect(perf.parsed().find((l) => l.route === "api/coach")).toMatchObject({ pick_added: true, items_added: 1 });
      const logs = perf.all.join(" ");
      for (const c of [EMAIL, PICK]) expect(logs).not.toContain(c);
    });

    it("プロンプトに「確認しない」「根拠を添えて自分から提案」「伸長」「改善」", async () => {
      geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [] });
      await POST(post());
      const p = geminiState.lastPrompt ?? "";
      expect(p).toContain("「よろしいですか」「登録しますか」と確認しないでください");
      expect(p).toContain("根拠を添えて、自分から提案してください");
      expect(p).toContain("**伸長**");
      expect(p).toContain("**改善**");
    });

    it("AI の candidates は次の段で検査されて返る (足した後の段)", async () => {
      geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [], candidates: [{ title: "模試を 1 回", target: "700 点" }, { title: "" }] });
      const body = await (await POST(post())).json();
      expect(body.candidates).toEqual([{ title: "模試を 1 回", target: "700 点" }]);
    });

    it.each([
      ["題が空", { title: "" }],
      ["201 字", { title: "あ".repeat(201) }],
    ])("不正な pick (%s) は足さない", async (_l, pick) => {
      geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [] });
      const body = await (await POST(post("x", { pick }))).json();
      expect(body.itemsAdded).toEqual([]);
      expect(inserts()).toHaveLength(0);
      expect(perf.parsed().find((l) => l.route === "api/coach")).toMatchObject({ pick_added: false });
    });

    it("pick が配列や文字列なら 400", async () => {
      expect((await POST(post("x", { pick: ["a"] }))).status).toBe(400);
      expect((await POST(post("x", { pick: "a" }))).status).toBe(400);
    });

    it("判定を待っている間は pick を足さず、候補も返さない", async () => {
      db.state.items = [
        row(KGI_ID, "kgi", null, KGI_CANARY),
        row(KPI_ID, "kpi", KGI_ID, "模試"),
        row("00000000-0000-4000-8000-000000000003", "kdi", KPI_ID, "単語"),
        { ...row("00000000-0000-4000-8000-000000000010", "todo", "00000000-0000-4000-8000-000000000003", "完了した"), due_date: todayJst(), status: "done" },
      ];
      geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [], candidates: [{ title: "x" }] });
      const body = await (await POST(post("x", { pick: { title: "足さない" } }))).json();
      expect(body.itemsAdded).toEqual([]);
      expect(body.candidates).toEqual([]);
      expect(inserts()).toHaveLength(0);
    });
  });

  describe("KPI と KDI を AI と話しながら変える (EXP-038 L2)", () => {
    const KDI_ID = "00000000-0000-4000-8000-000000000003";
    const setup = () => {
      db.state.items = [
        { ...row(KGI_ID, "kgi", null, KGI_CANARY), due_date: "2099-12-31" },
        { ...row(KPI_ID, "kpi", KGI_ID, "模試 700"), target: "700 点" },
        row(KDI_ID, "kdi", KPI_ID, "単語 30 分"),
      ];
    };
    const updates = () => db.state.calls.filter((c) => /update plan_items set title = coalesce/.test(db.text(c)));

    it("プロンプトに番号と変え方の文・同意した KPI の変更はその KPI だけに入る (owner をパラメータで)", async () => {
      setup();
      geminiState.reply = JSON.stringify({ reply: "650 点にしましょう", plan: {}, choices: [], items: [], itemChange: { ref: "K1", target: "650 点" } });
      const body = await (await POST(post("それでいい", { thread: "kpi" }))).json();
      const p = geminiState.lastPrompt ?? "";
      expect(p).toContain("#### KPI と KDI の番号 (EXP-038)");
      expect(p).toContain("- K1: KPI『模試 700』 / 判定基準 700 点");
      expect(p).toContain("- D1: KDI『単語 30 分』");
      expect(p).toContain("KPI は仮置き、KDI は都度調整するものです (KGI は変えません)");
      expect(body.itemChanged).toEqual({ level: "kpi", before: { title: "模試 700", target: "700 点", dueDate: "" }, after: { title: "模試 700", target: "650 点", dueDate: "" } });
      const ups = updates();
      expect(ups).toHaveLength(1);
      expect(ups[0].values).toEqual(expect.arrayContaining([KPI_ID, EMAIL, "650 点"]));
      expect(perf.parsed().find((l) => l.route === "api/coach")).toMatchObject({ item_changed: true });
      for (const c of [EMAIL, "650 点"]) expect(perf.all.join(" ")).not.toContain(c);
    });

    it("KDI の題も変えられる", async () => {
      setup();
      geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [], itemChange: { ref: "D1", title: "単語 20 分" } });
      const body = await (await POST(post("x", { thread: "kdi" }))).json();
      expect(body.itemChanged?.level).toBe("kdi");
      expect(body.itemChanged?.after.title).toBe("単語 20 分");
      expect(updates()[0].values).toContain(KDI_ID);
    });

    it.each([
      ["知らない番号", { ref: "K9", title: "x" }],
      ["KGI の期限より後", { ref: "K1", dueDate: "2100-01-01" }],
      ["変える欄なし", { ref: "K1" }],
      ["無い", null],
    ])("%s なら変えない", async (_l, itemChange) => {
      setup();
      geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [], itemChange });
      const body = await (await POST(post())).json();
      expect(body.itemChanged).toBeNull();
      expect(updates()).toHaveLength(0);
      expect(perf.parsed().find((l) => l.route === "api/coach")).toMatchObject({ item_changed: false });
    });

    it("判定待ちの間は変えない", async () => {
      setup();
      db.state.items.push({ ...row("00000000-0000-4000-8000-000000000010", "todo", KDI_ID, "完了"), due_date: todayJst(), status: "done" });
      geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [], itemChange: { ref: "K1", target: "650 点" } });
      const body = await (await POST(post())).json();
      expect(body.itemChanged).toBeNull();
      expect(updates()).toHaveLength(0);
    });
  });

  describe("今日の ToDo の時刻と今日の日常の予定 (EXP-039 L3・EXP-040 L3)", () => {
    const KDI = "00000000-0000-4000-8000-000000000003";
    const setup = () => {
      db.state.items = [row(KGI_ID, "kgi", null, KGI_CANARY), row(KPI_ID, "kpi", KGI_ID, "模試"), row(KDI, "kdi", KPI_ID, "単語")];
      db.state.tasks = [{ id: "t1", day: todayJst(), title: "canary-歯医者-8e3a", start_time: "12:00", end_time: "13:00", status: "todo", created_at: "2026-10-02T00:00:00.000Z" }];
    };
    const slotInserts = () => db.state.calls.filter((c) => /insert into item_slots/.test(db.text(c)));

    it("今日の ToDo の段に時刻を聞く文・<Records> に今日の日常の予定", async () => {
      setup();
      geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [] });
      await POST(post());
      const p = geminiState.lastPrompt ?? "";
      expect(p).toContain('何時から何時にやるかも聞き、決まったら "items" / "candidates" の "start"・"end" (HH:MM) に入れてください');
      const rec = p.slice(p.indexOf("<Records>"), p.indexOf("</Records>"));
      expect(rec).toContain("#### 今日の日常の予定");
      expect(rec).toContain("- 12:00〜13:00 canary-歯医者-8e3a [未実行]");
    });

    it("AI の items に時刻があれば、ToDo と一緒に時刻も保存する (その ToDo・owner)", async () => {
      setup();
      geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [{ title: "単語 1〜30", start: "09:00", end: "09:30" }] });
      const body = await (await POST(post())).json();
      expect(body.itemsAdded).toEqual([{ level: "todo", title: "単語 1〜30" }]);
      const ins = slotInserts();
      expect(ins).toHaveLength(1);
      expect(ins[0].values).toEqual(expect.arrayContaining([EMAIL, "09:00", "09:30"]));
      const createdId = inserts()[0] ? db.state.calls.indexOf(inserts()[0]) + 1 : -1;
      expect(String(ins[0].values[0])).toBe(`00000000-0000-4000-8000-0000000009${String(createdId).padStart(2, "0")}`);
    });

    it("不正な時刻は時刻だけ捨てる (ToDo は作る)", async () => {
      setup();
      geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [{ title: "x", start: "10:00", end: "09:00" }] });
      const body = await (await POST(post())).json();
      expect(body.itemsAdded).toHaveLength(1);
      expect(slotInserts()).toHaveLength(0);
    });

    it("候補を時刻つきで選ぶと、時刻も保存する", async () => {
      setup();
      geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [] });
      await POST(post("x", { pick: { title: "過去問", target: "", start: "20:00", end: "21:00" } }));
      expect(slotInserts()[0]?.values).toEqual(expect.arrayContaining(["20:00", "21:00"]));
    });
  });

  it("DB が作るのを断った (親が他人など) ものは itemsAdded に入れない", async () => {
    db.state.refuseInsert = true;
    geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [{ title: "x" }] });
    const body = await (await POST(post())).json();
    expect(inserts()).toHaveLength(1);
    expect(body.itemsAdded).toEqual([]);
  });
});

// --- EXP-043: 目的ごとのチャット / EXP-044: 会話の質 ---
describe("POST /api/coach — 目的ごとのチャット (EXP-043・044)", () => {
  let perf: ReturnType<typeof capturePerf>;
  const KDI_ID = "00000000-0000-4000-8000-000000000003";
  const full = () => [row(KGI_ID, "kgi", null, KGI_CANARY), row(KPI_ID, "kpi", KGI_ID, "模試 700"), row(KDI_ID, "kdi", KPI_ID, "単語")];
  const call = (thread: unknown, message = "それにします") =>
    POST(new Request("http://l/api/coach", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: PID, message, ...(thread === undefined ? {} : { thread }) }),
    }));
  const msgCalls = () => db.state.calls.filter((c) => /from messages/.test(db.text(c)));
  const saveCalls = () => db.state.calls.filter((c) => /insert into messages/.test(db.text(c)));
  beforeEach(() => {
    perf = capturePerf();
    authState.session = { user: { name: "t", email: EMAIL }, expires: "2099-01-01" } as never;
    geminiState.failWith = null;
    geminiState.failTimes = null;
    db.state.items = full();
    db.state.calls = [];
    db.state.refuseInsert = false;
    db.state.notes = [];
    db.state.failMessages = false;
    db.state.tasks = [];
    db.state.history = [];
  });
  afterEach(() => perf.restore());

  it("知らない thread は 400・無ければ壁打ち (chat) の会話を読む", async () => {
    geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [] });
    expect((await call("plan")).status).toBe(400);
    expect((await call("xyz")).status).toBe(400);
    db.state.calls = [];
    expect((await call(undefined)).status).toBe(200);
    expect(msgCalls()[0].values).toContain("chat");
  });

  it("会話はその thread のものだけを読み、その thread へ保存する", async () => {
    geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [] });
    await call("kdi");
    expect(msgCalls()[0].values).toContain("kdi");
    expect(saveCalls().length).toBeGreaterThan(0);
    for (const c of saveCalls()) expect(c.values).toContain("kdi");
    expect(geminiState.lastPrompt ?? "").toContain("この会話は「KDI」です");
  });

  it("壁打ち・相談と KGI は階層に足さず、番号の変更もしない", async () => {
    for (const thread of ["chat", "kgi"]) {
      db.state.calls = [];
      geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [{ title: "x" }], itemChange: { ref: "K1", target: "650 点" } });
      const body = await (await call(thread)).json();
      expect(body.itemsAdded ?? []).toEqual([]);
      expect(inserts()).toHaveLength(0);
      expect(db.state.calls.some((c) => /update plan_items set title/.test(db.text(c)))).toBe(false);
      expect(geminiState.lastPrompt ?? "").toContain("この会話では階層に足しません");
    }
  });

  it("ToDo の会話は今日の ToDo を KDI の下に足し、KPI の番号は変えない", async () => {
    geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [{ title: "単語 20 個" }], itemChange: { ref: "K1", target: "650 点" } });
    const body = await (await call("todo")).json();
    expect(body.itemsAdded).toEqual([{ level: "todo", title: "単語 20 個" }]);
    expect(inserts()[0].values).toContain(KDI_ID);
    expect(db.state.calls.some((c) => /update plan_items set title/.test(db.text(c)))).toBe(false);
  });

  it("KPI の会話は KPI を足し、KDI の番号は変えない", async () => {
    geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [{ title: "模試 750" }], itemChange: { ref: "D1", title: "単語 40 分" } });
    const body = await (await call("kpi")).json();
    expect(body.itemsAdded).toEqual([{ level: "kpi", title: "模試 750" }]);
    expect(inserts()[0].values).toContain(KGI_ID);
    expect(db.state.calls.some((c) => /update plan_items set title/.test(db.text(c)))).toBe(false);
  });

  it("会話の質の決まり (同じ質問をしない・記録に基づく・提案か質問を 1 つ) がプロンプトに入る", async () => {
    geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [] });
    await call("chat");
    const p = geminiState.lastPrompt ?? "";
    expect(p).toContain("### この会話の役割 (EXP-043)");
    expect(p).toContain("### 会話の質 (EXP-044)");
    expect(p).toContain("直前の自分の質問と同じ質問をしない");
    expect(p).toContain("具体的に話してください: 数・期日・時刻・回数で言ってください。記録に無い数字は作らないでください。");
    expect(p).toContain("このユーザーの記録 (進み具合・前の日の記録・仮説) に結びつけてください");
  });

  it("直前と同じ質問なら question_repeat が true (真偽だけで中身はログに出ない)", async () => {
    const Q = "canary-q-8d2e 何時にやりますか？";
    db.state.history = [
      { id: "h1", role: "user", content: "a", created_at: T },
      { id: "h2", role: "assistant", content: `いいですね。${Q}`, created_at: T },
    ];
    geminiState.reply = JSON.stringify({ reply: `わかりました。 ${Q}`, plan: {}, choices: [], items: [] });
    await call("todo");
    const line = perf.parsed().find((l) => l.route === "api/coach");
    expect(line).toMatchObject({ question_repeat: true, model_fallback: false });
    expect(perf.all.join("\n")).not.toContain("canary-q-8d2e");
    perf.restore(); perf = capturePerf();
    geminiState.reply = JSON.stringify({ reply: "では、終わったら教えてください。", plan: {}, choices: [], items: [] });
    await call("todo");
    expect(perf.parsed().find((l) => l.route === "api/coach")).toMatchObject({ question_repeat: false });
  });

  it("壁打ち・KGI・KPI は上位のモデル・KDI・ToDo は今のモデル (EXP-044)", async () => {
    geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [] });
    for (const [thread, model] of [["chat", GEMINI_MODEL_DEEP], ["kgi", GEMINI_MODEL_DEEP], ["kpi", GEMINI_MODEL_DEEP], ["kdi", GEMINI_MODEL], ["todo", GEMINI_MODEL]]) {
      await call(thread);
      expect(geminiState.lastModel).toBe(model);
    }
  });

  it("上位が混んでいたら (503 が続く) 今のモデルで答え、model_fallback が true", async () => {
    geminiState.reply = JSON.stringify({ reply: "ok", plan: {}, choices: [], items: [] });
    geminiState.failWith = Object.assign(new Error("[503 Service Unavailable]"), { status: 503 });
    geminiState.failTimes = 2;
    const res = await call("chat");
    expect(res.status).toBe(200);
    expect(geminiState.lastModel).toBe(GEMINI_MODEL);
    expect(perf.parsed().find((l) => l.route === "api/coach")).toMatchObject({ model_fallback: true });
  });
});
