import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authState } from "../test/mocks/next-auth";
import { geminiState } from "../test/mocks/generative-ai";
import { capturePerf } from "../test/mocks/fetch";

vi.mock("next-auth", async () => (await import("../test/mocks/next-auth")).nextAuthMock);
vi.mock("../app/api/auth/[...nextauth]/route", async () => (await import("../test/mocks/next-auth")).authRouteMock);
vi.mock("@google/generative-ai", async () => (await import("../test/mocks/generative-ai")).generativeAiMock);

const PROJECT_ID = "123e4567-e89b-12d3-a456-426614174000";
// どの問い合わせにも持ち主のプロジェクトの行を返す偽の DB (プロンプトの中身だけを見るため)
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

describe("コーチ・メンターのプロンプト (EXP-022 L1)", () => {
  let perf: ReturnType<typeof capturePerf>;
  beforeEach(() => {
    perf = capturePerf();
    authState.session = { user: { name: "t", email: "t@example.com" }, expires: "2099-01-01" } as never;
    geminiState.failWith = null;
    geminiState.reply = JSON.stringify({ reply: "いいですね。目的は何ですか？", plan: {} });
  });
  afterEach(() => perf.restore());

  it("役割・返答の形・鬼速PDCA の考え方がプロンプトに入る", async () => {
    const res = await POST(new Request("http://localhost/api/coach", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: PROJECT_ID, message: "こんにちは" }),
    }));
    expect(res.status).toBe(200);
    const p = geminiState.lastPrompt ?? "";
    expect(p).toContain("伴走するコーチであり、メンターです");
    expect(p).toContain("答えを押し付けず、問いで気づかせてください");
    expect(p).toMatch(/①受け止め[\s\S]*②記録に基づく所見か助言[\s\S]*③次の一歩の問い 1 つ/);
    expect(p).toContain("期日と数値");
    expect(p).toContain("3 つに絞ります");
    expect(p).toContain("ゴール / 課題 / 行動 / そのまま続ける");
  });
});
