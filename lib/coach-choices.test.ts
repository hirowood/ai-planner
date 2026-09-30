import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { parseChoices } from "./coach-choices";
import { AnswerChoices } from "../app/components/AnswerChoices";
import { authState } from "../test/mocks/next-auth";
import { geminiState } from "../test/mocks/generative-ai";
import { capturePerf } from "../test/mocks/fetch";

vi.mock("next-auth", async () => (await import("../test/mocks/next-auth")).nextAuthMock);
vi.mock("../app/api/auth/[...nextauth]/route", async () => (await import("../test/mocks/next-auth")).authRouteMock);
vi.mock("@google/generative-ai", async () => (await import("../test/mocks/generative-ai")).generativeAiMock);

const PROJECT_ID = "123e4567-e89b-12d3-a456-426614174000";
vi.mock("./db", () => ({
  DbNotConfigured: class extends Error {},
  getSql: () => async (strings: TemplateStringsArray) => {
    const q = strings.join("?");
    if (/from projects/i.test(q) && !/insert/i.test(q)) {
      return [{ id: PROJECT_ID, name: "英語", category: "learning", purpose: "", created_at: new Date() }];
    }
    if (/insert into cycles|update cycles/i.test(q)) {
      return [{ id: PROJECT_ID, project_id: PROJECT_ID, phase: "plan", plan: {}, created_at: new Date(), updated_at: new Date() }];
    }
    if (/insert into messages/i.test(q)) return [{ id: "m" }];
    return [];
  },
}));

import { POST } from "../app/api/coach/route";

describe("parseChoices (EXP-023 L1)", () => {
  it("正しい 3 個を通す", () => {
    expect(parseChoices(["毎朝 20 分", "週 3 回", "まだ決めていない"])).toEqual(["毎朝 20 分", "週 3 回", "まだ決めていない"]);
  });
  it("5 個 → 4 個・trim", () => {
    expect(parseChoices([" a ", "b", "c", "d", "e"])).toEqual(["a", "b", "c", "d"]);
  });
  it("21 字・空・改行・数字・重複を捨てる", () => {
    expect(parseChoices(["あ".repeat(21), "", "  ", "改\n行", 3, "同じ", "同じ", "あ".repeat(20)])).toEqual(["同じ", "あ".repeat(20)]);
  });
  it("配列でなければ []", () => {
    expect(parseChoices("a")).toEqual([]);
    expect(parseChoices(null)).toEqual([]);
    expect(parseChoices({ 0: "a" })).toEqual([]);
  });
});

describe("/api/coach の答えの候補 (EXP-023 L2)", () => {
  let perf: ReturnType<typeof capturePerf>;
  beforeEach(() => {
    perf = capturePerf();
    authState.session = { user: { name: "t", email: "t@example.com" }, expires: "2099-01-01" } as never;
    geminiState.failWith = null;
  });
  afterEach(() => perf.restore());

  it("Gemini の choices が検査されて返り、候補の節がプロンプトに入り、choices_count が出て、中身はログに出ない", async () => {
    const CANARY = "候補カナリア7x";
    geminiState.reply = JSON.stringify({ reply: "どのくらい続けますか？", plan: {}, choices: [CANARY, "週 3 回", "あ".repeat(30)] });
    const res = await POST(new Request("http://localhost/api/coach", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: PROJECT_ID, message: "こんにちは" }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.choices).toEqual([CANARY, "週 3 回"]);
    expect(geminiState.lastPrompt ?? "").toContain("答えの候補を 2〜4 個");
    const line = perf.parsed().find((l) => l.route === "api/coach");
    expect(line).toMatchObject({ status: 200, choices_count: 2 });
    expect(perf.all.join("\n")).not.toContain(CANARY);
  });

  it("choices が無い返事では []", async () => {
    geminiState.reply = JSON.stringify({ reply: "記録しました。", plan: {} });
    const res = await POST(new Request("http://localhost/api/coach", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: PROJECT_ID, message: "やった" }),
    }));
    expect((await res.json()).choices).toEqual([]);
  });
});

describe("AnswerChoices (EXP-023 L3)", () => {
  const html = (busy: boolean) =>
    renderToStaticMarkup(createElement(AnswerChoices, { choices: ["週 3 回", "毎日"], busy, onPick: () => {}, onWriteOwn: () => {} }));
  it("group の名前・候補の数 + 1 のボタン", () => {
    const out = html(false);
    expect(out).toMatch(/role="group"[^>]*aria-label="答えの候補"|aria-label="答えの候補"[^>]*role="group"/);
    expect(out.match(/<button[^>]*type="button"/g) ?? []).toHaveLength(3);
    expect(out).toContain("自分で書く");
    expect(out).not.toContain("aria-disabled");
  });
  it("送信中は aria-disabled", () => {
    expect((html(true).match(/aria-disabled="true"/g) ?? []).length).toBe(3);
  });
});
