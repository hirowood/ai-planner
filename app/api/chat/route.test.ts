import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authState, signedIn } from "../../../test/mocks/next-auth";
import { geminiState } from "../../../test/mocks/generative-ai";
import { capturePerf } from "../../../test/mocks/fetch";

vi.mock("next-auth", async () => (await import("../../../test/mocks/next-auth")).nextAuthMock);
vi.mock("../auth/[...nextauth]/route", async () => (await import("../../../test/mocks/next-auth")).authRouteMock);
vi.mock("@google/generative-ai", async () => (await import("../../../test/mocks/generative-ai")).generativeAiMock);

import { POST } from "./route";

const ALLOWED = ["calendar_ms", "gemini_ms", "route", "status", "total_ms"];
const BODY_CANARY = "canary-message-body-7f3a";
const REPLY_CANARY = "canary-gemini-reply-91c2";

function post(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/chat — 振る舞い", () => {
  let perf: ReturnType<typeof capturePerf>;
  beforeEach(() => {
    perf = capturePerf();
    authState.session = null;
    geminiState.reply = REPLY_CANARY;
    geminiState.delayMs = 0;
  });
  afterEach(() => perf.restore());

  it("セッション無しは 401 で、Gemini を呼ばない", async () => {
    const calls = geminiState.calls;
    const res = await POST(post({ message: "hi", history: [] }));
    expect(res.status).toBe(401);
    expect(geminiState.calls).toBe(calls);
  });

  it("JSON が壊れていれば 400", async () => {
    authState.session = signedIn();
    const res = await POST(post("{not json"));
    expect(res.status).toBe(400);
  });

  it("差し替えたモデルで 200 と reply を返す", async () => {
    authState.session = signedIn();
    const res = await POST(post({ message: BODY_CANARY, history: [] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reply: REPLY_CANARY });
    expect(geminiState.lastPrompt).toContain(BODY_CANARY); // 本文はモデルには渡る
  });
});

describe("POST /api/chat — 計測点", () => {
  let perf: ReturnType<typeof capturePerf>;
  beforeEach(() => {
    perf = capturePerf();
    authState.session = signedIn("fake-token-canary-5d1e");
    geminiState.reply = REPLY_CANARY;
    geminiState.delayMs = 20;
  });
  afterEach(() => perf.restore());

  it.each([
    ["200", () => post({ message: BODY_CANARY, history: [] }), 200],
    ["400", () => post("{not json"), 400],
  ])("%s の経路で [perf] がちょうど 1 行・5 項目だけ・Server-Timing あり", async (_n, make, status) => {
    const res = await POST(make());
    expect(res.status).toBe(status);
    expect(perf.lines).toHaveLength(1);
    const [line] = perf.parsed();
    expect(Object.keys(line).every((k) => ALLOWED.includes(k))).toBe(true);
    expect(line).toMatchObject({ route: "api/chat", status });
    expect(res.headers.get("Server-Timing")).toMatch(/^total;dur=[\d.]+, gemini;dur=[\d.]+$/);
  });

  it("gemini_ms がモデルの待ち時間を捉えている", async () => {
    await POST(post({ message: BODY_CANARY, history: [] }));
    const [line] = perf.parsed();
    expect(line.gemini_ms as number).toBeGreaterThanOrEqual(15);
    expect(line.total_ms as number).toBeGreaterThanOrEqual(line.gemini_ms as number);
  });

  it("ログのどこにも本文・返答・トークンが出ない", async () => {
    await POST(post({ message: BODY_CANARY, history: [{ role: "user", content: BODY_CANARY }] }));
    const everything = perf.all.join("\n");
    for (const canary of [BODY_CANARY, REPLY_CANARY, "fake-token-canary-5d1e"]) {
      expect(everything).not.toContain(canary);
    }
  });
});
