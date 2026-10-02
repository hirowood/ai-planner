import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authState } from "../test/mocks/next-auth";
import { geminiState } from "../test/mocks/generative-ai";
import { capturePerf } from "../test/mocks/fetch";
import { KGI_LOCKED, deleteItem, updateItem } from "./repo";

vi.mock("next-auth", async () => (await import("../test/mocks/next-auth")).nextAuthMock);
vi.mock("../app/api/auth/[...nextauth]/route", async () => (await import("../test/mocks/next-auth")).authRouteMock);
vi.mock("@google/generative-ai", async () => (await import("../test/mocks/generative-ai")).generativeAiMock);

const PROJECT_ID = "123e4567-e89b-12d3-a456-426614174000";
const ITEM_ID = "223e4567-e89b-12d3-a456-426614174000";
const ROW = (level: string) => ({ id: ITEM_ID, project_id: PROJECT_ID, parent_id: null, level, title: "t", target: "", due_date: null, status: "todo", created_at: new Date(), updated_at: new Date() });

// 保存された cycle の Plan (テストごとに差し替える)
const saved: { plan: unknown } = { plan: {} };
vi.mock("./db", () => ({
  DbNotConfigured: class extends Error {},
  getSql: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join("?");
    if (/from projects/i.test(q) && !/insert/i.test(q)) return [{ id: PROJECT_ID, name: "英語", category: "learning", purpose: "", created_at: new Date() }];
    if (/from cycles/i.test(q) && /order by updated_at desc/i.test(q) && /limit 1/i.test(q)) {
      return [{ id: PROJECT_ID, project_id: PROJECT_ID, phase: "plan", plan: saved.plan, created_at: new Date(), updated_at: new Date() }];
    }
    if (/update cycles|insert into cycles/i.test(q)) {
      const planJson = values.find((v) => typeof v === "string" && v.startsWith("{"));
      if (typeof planJson === "string") saved.plan = JSON.parse(planJson);
      return [{ id: PROJECT_ID, project_id: PROJECT_ID, phase: "plan", plan: saved.plan, created_at: new Date(), updated_at: new Date() }];
    }
    if (/insert into messages/i.test(q)) return [{ id: "m" }];
    return [];
  },
}));

import { POST } from "../app/api/coach/route";

// 偽の DB: KGI の行を持つ。level <> 'kgi' の条件が付いた更新・削除は何も返さない
function fakeSql(level: string) {
  return (async (strings: TemplateStringsArray) => {
    const q = strings.join("?");
    if (/level <> 'kgi'/.test(q) && level === "kgi") {
      // update は「kgi でない or 固定の欄に触れない」の条件なので、status だけの更新は通す
      if (/update plan_items/i.test(q) && /not \?::boolean/.test(q)) return (globalThis as { __touches?: boolean }).__touches ? [] : [ROW(level)];
      return [];
    }
    if (/select 1 from plan_items/i.test(q)) return level === "kgi" ? [{ "?column?": 1 }] : [];
    if (/update plan_items|delete from plan_items/i.test(q)) return [ROW(level)];
    return [];
  }) as never;
}

describe("KGI の固定: repo (EXP-024 L1)", () => {
  it("KGI の title の更新は KGI_LOCKED", async () => {
    (globalThis as { __touches?: boolean }).__touches = true;
    expect(await updateItem(fakeSql("kgi"), "o", ITEM_ID, { title: "別" })).toBe(KGI_LOCKED);
  });
  it("KGI の status だけの更新は通る", async () => {
    (globalThis as { __touches?: boolean }).__touches = false;
    const r = await updateItem(fakeSql("kgi"), "o", ITEM_ID, { status: "succeeded" });
    expect(r).not.toBe(KGI_LOCKED);
    expect(r).toMatchObject({ level: "kgi" });
  });
  it("KGI の削除は KGI_LOCKED・KPI の削除は true", async () => {
    expect(await deleteItem(fakeSql("kgi"), "o", ITEM_ID)).toBe(KGI_LOCKED);
    expect(await deleteItem(fakeSql("kpi"), "o", ITEM_ID)).toBe(true);
  });
});

describe("KGI の固定: /api/coach (EXP-024 L2)", () => {
  let perf: ReturnType<typeof capturePerf>;
  beforeEach(() => {
    perf = capturePerf();
    authState.session = { user: { name: "t", email: "t@example.com" }, expires: "2099-01-01" } as never;
    geminiState.failWith = null;
  });
  afterEach(() => perf.restore());
  const send = () => POST(new Request("http://localhost/api/coach", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: PROJECT_ID, message: "ゴールを変えたい" }),
  }));

  it("KGI が決まっていれば、AI の返した別の KGI は採らない・プロンプトに固定の一文", async () => {
    saved.plan = { purpose: "", kgi: "12/31 までに TOEIC 800", kpis: [], kdis: [], criteria: "", deliverable: "" };
    geminiState.reply = JSON.stringify({ reply: "わかりました。", plan: { kgi: "来年までに 900" }, choices: [] });
    const res = await send();
    expect((await res.json()).plan.kgi).toBe("12/31 までに TOEIC 800");
    expect(geminiState.lastPrompt ?? "").toContain("KGI は固定");
  });
  it("KGI が空なら AI の KGI を採る", async () => {
    saved.plan = { purpose: "", kgi: "", kpis: [], kdis: [], criteria: "", deliverable: "" };
    geminiState.reply = JSON.stringify({ reply: "いいですね。", plan: { kgi: "12/31 までに TOEIC 800" }, choices: [] });
    const res = await send();
    expect((await res.json()).plan.kgi).toBe("12/31 までに TOEIC 800");
  });
});
