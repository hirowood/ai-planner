import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authState, signedIn } from "../../../test/mocks/next-auth";
import { geminiState } from "../../../test/mocks/generative-ai";
import { capturePerf } from "../../../test/mocks/fetch";

vi.mock("next-auth", async () => (await import("../../../test/mocks/next-auth")).nextAuthMock);
vi.mock("../auth/[...nextauth]/route", async () => (await import("../../../test/mocks/next-auth")).authRouteMock);
vi.mock("@google/generative-ai", async () => (await import("../../../test/mocks/generative-ai")).generativeAiMock);

import { POST } from "./route";

const ALLOWED = ["calendar_ms", "first_chunk_ms", "gemini_ms", "route", "status", "total_ms"];
const BODY_CANARY = "canary-message-body-7f3a";
const REPLY_CANARY = "canary-gemini-reply-91c2";
const TOKEN_CANARY = "fake-token-canary-5d1e";

function post(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function resetGemini() {
  geminiState.reply = REPLY_CANARY;
  geminiState.delayMs = 0;
  geminiState.chunks = null;
  geminiState.chunkDelayMs = 0;
  geminiState.failAfterChunks = null;
}

describe("POST /api/chat — 振る舞い", () => {
  let perf: ReturnType<typeof capturePerf>;
  beforeEach(() => {
    perf = capturePerf();
    authState.session = null;
    resetGemini();
  });
  afterEach(() => perf.restore());

  it("セッション無しは 401 (JSON) で、Gemini を呼ばない", async () => {
    const calls = geminiState.calls;
    const res = await POST(post({ message: "hi", history: [] }));
    expect(res.status).toBe(401);
    expect(await res.json()).toHaveProperty("error");
    expect(geminiState.calls).toBe(calls);
  });

  it("JSON が壊れていれば 400 (JSON)", async () => {
    authState.session = signedIn();
    const res = await POST(post("{not json"));
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
  });

  it("成功は 200 のテキストのストリームで、つなげると返答の全文になる (H3)", async () => {
    authState.session = signedIn();
    geminiState.chunks = ["こんにちは、", "計画を", "立てましょう。\n```json\n[]\n```"];
    const res = await POST(post({ message: BODY_CANARY, history: [] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(await res.text()).toBe(geminiState.chunks.join(""));
    expect(geminiState.lastPrompt).toContain(BODY_CANARY); // 本文はモデルには渡る
  });

  it("ストリームの途中で失敗すると、本文の読み取りが失敗する (クライアントが気づける)", async () => {
    authState.session = signedIn();
    geminiState.chunks = ["a", "b", "c"];
    geminiState.failAfterChunks = 1;
    const res = await POST(post({ message: "hi", history: [] }));
    expect(res.status).toBe(200);
    await expect(res.text()).rejects.toThrow();
  });
});

describe("POST /api/chat — 計測点", () => {
  let perf: ReturnType<typeof capturePerf>;
  beforeEach(() => {
    perf = capturePerf();
    authState.session = signedIn(TOKEN_CANARY);
    resetGemini();
  });
  afterEach(() => perf.restore());

  it("400 の経路: [perf] がちょうど 1 行・許可項目だけ・Server-Timing は total と gemini", async () => {
    const res = await POST(post("{not json"));
    expect(res.status).toBe(400);
    expect(perf.lines).toHaveLength(1);
    const [line] = perf.parsed();
    expect(Object.keys(line).every((k) => ALLOWED.includes(k))).toBe(true);
    expect(line).toMatchObject({ route: "api/chat", status: 400 });
    expect(res.headers.get("Server-Timing")).toMatch(/^total;dur=[\d.]+, gemini;dur=[\d.]+$/);
  });

  it("200 の経路: [perf] はストリームを閉じたときに 1 行・first_chunk_ms < total_ms・gemini_ms が待ちを捉える", async () => {
    geminiState.chunks = ["1", "2", "3", "4", "5"];
    geminiState.chunkDelayMs = 10;
    const res = await POST(post({ message: BODY_CANARY, history: [] }));
    expect(res.headers.get("Server-Timing")).toMatch(/^headers;dur=[\d.]+$/);
    expect(perf.lines).toHaveLength(0); // まだ読み切っていない
    await res.text();
    expect(perf.lines).toHaveLength(1);
    const [line] = perf.parsed();
    expect(Object.keys(line).every((k) => ALLOWED.includes(k))).toBe(true);
    expect(line).toMatchObject({ route: "api/chat", status: 200 });
    expect(line.first_chunk_ms as number).toBeLessThan(line.total_ms as number);
    expect(line.gemini_ms as number).toBeGreaterThanOrEqual(40);
  });

  it("ストリームの途中で失敗したら [perf] の status は 500", async () => {
    geminiState.chunks = ["a", "b"];
    geminiState.failAfterChunks = 1;
    const res = await POST(post({ message: "hi", history: [] }));
    await res.text().catch(() => undefined);
    expect(perf.parsed()).toEqual([expect.objectContaining({ route: "api/chat", status: 500 })]);
  });

  it("ログのどこにも本文・返答・トークンが出ない", async () => {
    geminiState.chunks = [REPLY_CANARY, "-tail"];
    const res = await POST(post({ message: BODY_CANARY, history: [{ role: "user", content: BODY_CANARY }] }));
    await res.text();
    const everything = perf.all.join("\n");
    for (const canary of [BODY_CANARY, REPLY_CANARY, TOKEN_CANARY]) {
      expect(everything).not.toContain(canary);
    }
  });
});
