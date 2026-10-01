import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  EMPTY_SMART,
  SMART_FIELDS,
  SMART_LABEL,
  isSmartReady,
  mergeSmart,
  nextSmartField,
  parseSmartDraft,
  smartToKgi,
  type SmartDraft,
} from "./smart";
import { SmartPanel } from "../app/components/SmartPanel";
import { authState } from "../test/mocks/next-auth";
import { geminiState } from "../test/mocks/generative-ai";
import { capturePerf } from "../test/mocks/fetch";

vi.mock("next-auth", async () => (await import("../test/mocks/next-auth")).nextAuthMock);
vi.mock("../app/api/auth/[...nextauth]/route", async () => (await import("../test/mocks/next-auth")).authRouteMock);
vi.mock("@google/generative-ai", async () => (await import("../test/mocks/generative-ai")).generativeAiMock);

// 偽の DB: /api/setup が呼んだら失敗にする・/api/setup/create の問い合わせを記録する
const db: { calls: { q: string; values: unknown[] }[]; forbid: boolean; notConfigured: boolean } = { calls: [], forbid: false, notConfigured: false };
vi.mock("./db", () => {
  class DbNotConfigured extends Error {}
  return {
    DbNotConfigured,
    getSql: () => {
      if (db.forbid) throw new Error("DB must not be called");
      if (db.notConfigured) throw new DbNotConfigured("x");
      return async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const q = strings.join("?");
        db.calls.push({ q, values });
        const now = new Date();
        if (/insert into projects/i.test(q)) return [{ id: "11111111-1111-4111-8111-111111111111", name: values[1], category: values[2], purpose: values[3], created_at: now }];
        if (/insert into plan_items/i.test(q)) return [{ id: "22222222-2222-4222-8222-222222222222", project_id: "11111111-1111-4111-8111-111111111111", parent_id: null, level: "kgi", title: "t", target: "m", due_date: "2099-12-31", status: "todo", created_at: now, updated_at: now }];
        if (/insert into cycles/i.test(q)) return [{ id: "33333333-3333-4333-8333-333333333333", project_id: "11111111-1111-4111-8111-111111111111", phase: "plan", plan: {}, created_at: now, updated_at: now }];
        return [];
      };
    },
  };
});

import { POST as setupPOST } from "../app/api/setup/route";
import { POST as createPOST } from "../app/api/setup/create/route";

const READY: SmartDraft = {
  specific: "英語の会議で発言する", measurable: "週 1 回は発言する", timeBound: "2099-12-31",
  relevant: "仕事の幅を広げたい", achievable: "毎朝 20 分なら続けられる", name: "英語で会議", category: "work",
};
const post = (url: string, body: unknown) =>
  new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("SMART の下書き (EXP-018 L1)", () => {
  it("聞く順と 7 つのラベル", () => {
    expect(SMART_FIELDS).toEqual(["specific", "measurable", "timeBound", "relevant", "achievable", "name", "category"]);
    expect(SMART_LABEL.specific).toBe("具体的に何を (S)");
  });
  it("parseSmartDraft: trim・無いキーは空・規則外は null", () => {
    expect(parseSmartDraft({ specific: "  走る " })).toEqual({ ...EMPTY_SMART, specific: "走る" });
    expect(parseSmartDraft({ name: "あ".repeat(61) })).toBeNull();
    expect(parseSmartDraft({ timeBound: "2026-02-30" })).toBeNull();
    expect(parseSmartDraft("x")).toBeNull();
  });
  it("mergeSmart: 埋まった欄だけ・空と規則外は無視", () => {
    const m = mergeSmart({ ...EMPTY_SMART, specific: "走る" }, { specific: "", measurable: "週 3 回", timeBound: "bad" });
    expect(m).toMatchObject({ specific: "走る", measurable: "週 3 回", timeBound: "" });
  });
  it("nextSmartField: 聞く順で最初の空の欄", () => {
    expect(nextSmartField(EMPTY_SMART)).toBe("specific");
    expect(nextSmartField({ ...READY, relevant: "" })).toBe("relevant");
    expect(nextSmartField(READY)).toBeNull();
  });
  it("isSmartReady: 全部埋まり期限が今日以降", () => {
    expect(isSmartReady({ ...READY, timeBound: "2026-10-01" }, "2026-10-01")).toBe(true);
    expect(isSmartReady({ ...READY, timeBound: "2026-09-30" }, "2026-10-01")).toBe(false);
    expect(isSmartReady({ ...READY, achievable: "" }, "2026-10-01")).toBe(false);
  });
  it("smartToKgi: title = specific・target = measurable・dueDate = timeBound", () => {
    expect(smartToKgi(READY)).toEqual({ title: READY.specific, target: READY.measurable, dueDate: READY.timeBound });
  });
});

describe("/api/setup (EXP-018 L2)", () => {
  let perf: ReturnType<typeof capturePerf>;
  beforeEach(() => {
    perf = capturePerf();
    authState.session = { user: { name: "t", email: "t@example.com" }, expires: "2099-01-01" } as never;
    geminiState.failWith = null;
    db.forbid = true;
    db.calls = [];
  });
  afterEach(() => { perf.restore(); db.forbid = false; });

  it("401・400", async () => {
    authState.session = null;
    expect((await setupPOST(post("http://l/api/setup", { message: "x" }))).status).toBe(401);
    authState.session = { user: { email: "t@example.com" }, expires: "2099-01-01" } as never;
    expect((await setupPOST(post("http://l/api/setup", { message: "" }))).status).toBe(400);
  });
  it("200: 欄が重なり・次の欄・候補・ready・プロンプトに順と今日・DB を呼ばない・中身はログに出ない", async () => {
    const CANARY = "下書きカナリア9q";
    geminiState.reply = JSON.stringify({ reply: "いつまでにしますか？", draft: { measurable: CANARY }, choices: ["年内", "3 か月後"] });
    const res = await setupPOST(post("http://l/api/setup", { draft: { specific: "走る" }, history: [], message: "週 3 回測る" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft).toMatchObject({ specific: "走る", measurable: CANARY });
    expect(body.next).toBe("timeBound");
    expect(body.choices).toEqual(["年内", "3 か月後"]);
    expect(body.ready).toBe(false);
    const p = geminiState.lastPrompt ?? "";
    expect(p).toContain("1. specific (具体的に何を (S))");
    expect(p).toMatch(/\d{4}-\d{2}-\d{2} \(期限 timeBound は今日以降/);
    expect(db.calls).toHaveLength(0);
    const line = perf.parsed().find((l) => l.route === "api/setup");
    expect(line).toMatchObject({ status: 200, fields_filled: 2, choices_count: 2 });
    expect(perf.all.join("\n")).not.toContain(CANARY);
  });
});

describe("/api/setup/create (EXP-018 L3)", () => {
  let perf: ReturnType<typeof capturePerf>;
  beforeEach(() => {
    perf = capturePerf();
    authState.session = { user: { name: "t", email: "owner@example.com" }, expires: "2099-01-01" } as never;
    db.calls = [];
    db.forbid = false;
    db.notConfigured = false;
  });
  afterEach(() => perf.restore());

  it("ready でない下書きは 400 で DB を呼ばない", async () => {
    const res = await createPOST(post("http://l/api/setup/create", { draft: { ...READY, achievable: "" } }));
    expect(res.status).toBe(400);
    expect(db.calls).toHaveLength(0);
  });
  it("201: プロジェクト・KGI・cycle を作り、全問い合わせに owner・中身とメールはログに出ない", async () => {
    const res = await createPOST(post("http://l/api/setup/create", { draft: READY }));
    expect(res.status).toBe(201);
    const qs = db.calls.map((c) => c.q).join("\n");
    expect(qs).toMatch(/insert into projects/i);
    expect(qs).toMatch(/insert into plan_items/i);
    expect(qs).toMatch(/insert into cycles/i);
    expect(db.calls.every((c) => c.values.includes("owner@example.com"))).toBe(true);
    const kgiInsert = db.calls.find((c) => /insert into plan_items/i.test(c.q));
    expect(kgiInsert?.values).toContain("kgi");
    const logs = perf.all.join("\n");
    expect(logs).not.toContain("owner@example.com");
    expect(logs).not.toContain(READY.specific);
  });
  it("401・503", async () => {
    authState.session = null;
    expect((await createPOST(post("http://l/api/setup/create", { draft: READY }))).status).toBe(401);
    authState.session = { user: { email: "owner@example.com" }, expires: "2099-01-01" } as never;
    db.notConfigured = true;
    expect((await createPOST(post("http://l/api/setup/create", { draft: READY }))).status).toBe(503);
  });
});

describe("SmartPanel (EXP-018 L4)", () => {
  const html = (draft: SmartDraft, ready: boolean) =>
    renderToStaticMarkup(createElement(SmartPanel, { draft, onChange: () => {}, ready, creating: false, onCreate: () => {}, onCancel: () => {} }));
  it("7 つのラベル・次の欄に aria-current", () => {
    const out = html({ ...EMPTY_SMART, specific: "走る" }, false);
    for (const f of SMART_FIELDS) expect(out).toContain(SMART_LABEL[f]);
    expect(out).toMatch(/aria-current="step"[\s\S]*どう測るか \(M\)/);
  });
  it("ready でなければ作るボタンは aria-disabled と理由・ready なら押せる", () => {
    const notReady = html(EMPTY_SMART, false);
    expect(notReady).toMatch(/aria-disabled="true"[^>]*aria-describedby="[^"]+"[^>]*>このゴールで作る|aria-describedby="[^"]+"[^>]*aria-disabled="true"[^>]*>このゴールで作る/);
    expect(notReady).toContain("すべての欄を埋め、期限を今日以降にすると作れます");
    const ready = html(READY, true);
    expect(ready).not.toMatch(/aria-disabled="true"[^>]*>このゴールで作る/);
    expect(ready).toContain("やめる");
  });
});
