import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authState, signedIn } from "../../../test/mocks/next-auth";
import { geminiState } from "../../../test/mocks/generative-ai";
import { capturePerf } from "../../../test/mocks/fetch";

vi.mock("next-auth", async () => (await import("../../../test/mocks/next-auth")).nextAuthMock);
vi.mock("../auth/[...nextauth]/route", async () => (await import("../../../test/mocks/next-auth")).authRouteMock);
vi.mock("@google/generative-ai", async () => (await import("../../../test/mocks/generative-ai")).generativeAiMock);

import { POST } from "./route";

const ALLOWED = ["calendar_ms", "first_chunk_ms", "gemini_ms", "history_len", "plan_proposed", "question_count", "route", "status", "total_ms"];
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
  geminiState.failWith = null;
}

// @google/generative-ai の GoogleGenerativeAIFetchError と同じ形 (status・errorDetails)
function quotaError(quotaId: string) {
  return Object.assign(new Error(`[429 Too Many Requests] quota exceeded`), {
    status: 429,
    statusText: "Too Many Requests",
    errorDetails: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId }] }],
  });
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

  it("1 日の上限の 429 は kind=quota_daily と戻る時刻を返す (EXP-005 L1)", async () => {
    authState.session = signedIn();
    geminiState.failWith = quotaError("GenerateRequestsPerDayPerProjectPerModel-FreeTier");
    const res = await POST(post({ message: "hi", history: [] }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({ kind: "quota_daily" });
    expect(body.reset_at).toMatch(/^\d{2}:\d{2}$/);
    expect(body.error).toContain(body.reset_at);
  });

  it("それ以外の 429 は kind=quota_rate (EXP-005 L2)", async () => {
    authState.session = signedIn();
    geminiState.failWith = quotaError("GenerateRequestsPerMinutePerProjectPerModel-FreeTier");
    const res = await POST(post({ message: "hi", history: [] }));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ kind: "quota_rate" });
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

  it("history_len は会話のメッセージ数 (数だけ)", async () => {
    const history = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ];
    const res = await POST(post({ message: BODY_CANARY, history }));
    await res.text();
    expect(perf.parsed()[0]).toMatchObject({ history_len: 3 });
  });

  it("plan_proposed: ```json の囲みがチャンクの境目で割れても true", async () => {
    geminiState.chunks = ["プランです。\n``", "`json\n[{\"summary\":\"x\"}]\n``", "`\nどうですか"];
    const res = await POST(post({ message: "hi", history: [] }));
    await res.text();
    expect(perf.parsed()[0]).toMatchObject({ status: 200, plan_proposed: true, history_len: 0 });
  });

  it("question_count: 全角「？」と半角「?」を、チャンクをまたいで数える (EXP-004 L1)", async () => {
    geminiState.chunks = ["何をしたいですか？", "なぜですか？ また", "時間は?"];
    const res = await POST(post({ message: "hi", history: [] }));
    await res.text();
    expect(perf.parsed()[0]).toMatchObject({ status: 200, question_count: 3 });
  });

  it("question_count: 質問が無ければ 0", async () => {
    geminiState.chunks = ["承知しました。", "プランを作ります。"];
    const res = await POST(post({ message: "hi", history: [] }));
    await res.text();
    expect(perf.parsed()[0]).toMatchObject({ status: 200, question_count: 0 });
  });

  it("plan_proposed: 予定案が無ければ false", async () => {
    geminiState.chunks = ["何をしたいですか?", " なぜですか?"];
    const res = await POST(post({ message: "hi", history: [] }));
    await res.text();
    expect(perf.parsed()[0]).toMatchObject({ status: 200, plan_proposed: false });
  });

  it("429 の経路: [perf] は status 429 の 1 行で、項目は増えない (EXP-005 L5)", async () => {
    geminiState.failWith = quotaError("GenerateRequestsPerDayPerProjectPerModel-FreeTier");
    await POST(post({ message: BODY_CANARY, history: [] }));
    expect(perf.lines).toHaveLength(1);
    const [line] = perf.parsed();
    expect(Object.keys(line).every((k) => ALLOWED.includes(k))).toBe(true);
    expect(line).toMatchObject({ route: "api/chat", status: 429 });
  });

  it("ストリームの途中で失敗したら [perf] の status は 500", async () => {
    geminiState.chunks = ["a", "b"];
    geminiState.failAfterChunks = 1;
    const res = await POST(post({ message: "hi", history: [] }));
    await res.text().catch(() => undefined);
    expect(perf.parsed()).toEqual([expect.objectContaining({ route: "api/chat", status: 500 })]);
    expect(perf.parsed()[0]).not.toHaveProperty("plan_proposed"); // 途中で切れた返答では判定しない
    expect(perf.parsed()[0]).not.toHaveProperty("question_count");
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
