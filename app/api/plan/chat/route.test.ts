import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authState } from "../../../../test/mocks/next-auth";
import { geminiState } from "../../../../test/mocks/generative-ai";
import { capturePerf } from "../../../../test/mocks/fetch";

vi.mock("next-auth", async () => (await import("../../../../test/mocks/next-auth")).nextAuthMock);
vi.mock("../../auth/[...nextauth]/route", async () => (await import("../../../../test/mocks/next-auth")).authRouteMock);
vi.mock("@google/generative-ai", async () => (await import("../../../../test/mocks/generative-ai")).generativeAiMock);

import { POST } from "./route";

const ALLOWED = [
  "calendar_ms", "first_chunk_ms", "gemini_ms", "history_len", "plan_proposed", "question_count", "route", "status",
  "time_dialog_used", "time_prompted", "total_ms", "db_ms", "row_count", "fields_filled",
];
const ROUTE = "api/plan/chat";
const EMAIL = "canary-user-8d2f@example.com";
const TOKEN_CANARY = "fake-token-canary-2b7c";
const MESSAGE_CANARY = "canary-plan-message-4a1e";
const HISTORY_CANARY = "canary-plan-history-6c3b";
const BASE_KGI_CANARY = "canary-plan-kgi-9e0d";
const REPLY_CANARY = "canary-plan-reply-1f5a";
const RETURNED_PURPOSE_CANARY = "canary-plan-purpose-3d8c";

const EMPTY = { purpose: "", kgi: "", kpis: [], kdis: [], criteria: "", deliverable: "" };
const PROJECT = { name: "朝の散歩", category: "habit", purpose: "体力をつける" };

function signedInWithEmail() {
  authState.session = {
    user: { name: "test user", email: EMAIL },
    accessToken: TOKEN_CANARY,
  } as typeof authState.session;
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/plan/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const history = [
  { role: "assistant", content: "目的は何ですか？" },
  { role: "user", content: HISTORY_CANARY },
];

// 目標だけ埋まっている Plan。AI が目的を返すと、目的・目標が埋まり次は KPI
const basePlan = { ...EMPTY, kgi: BASE_KGI_CANARY };
const validBody = { project: PROJECT, plan: basePlan, history, message: MESSAGE_CANARY };

function geminiReplies(x: unknown) {
  geminiState.reply = JSON.stringify(x);
}

function quotaError(quotaId: string) {
  return Object.assign(new Error(`[429 Too Many Requests] quota exceeded`), {
    status: 429,
    statusText: "Too Many Requests",
    errorDetails: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId }] }],
  });
}

let perf: ReturnType<typeof capturePerf>;
beforeEach(() => {
  perf = capturePerf();
  authState.session = null;
  geminiState.failWith = null;
  geminiState.delayMs = 0;
  geminiState.chunks = null;
  geminiState.chunkDelayMs = 0;
  geminiState.failAfterChunks = null;
  geminiState.lastPrompt = null;
  geminiState.lastConfig = null;
  geminiReplies({ reply: REPLY_CANARY, plan: { purpose: RETURNED_PURPOSE_CANARY } });
});
afterEach(() => perf.restore());

function expectOnePerfLine(status: number) {
  expect(perf.lines).toHaveLength(1);
  const [line] = perf.parsed();
  expect(Object.keys(line).filter((k) => !ALLOWED.includes(k))).toEqual([]);
  expect(line).toMatchObject({ route: ROUTE, status });
  return line;
}

function expectNoCanaryInLogs() {
  const everything = perf.all.join("\n");
  for (const canary of [EMAIL, TOKEN_CANARY, MESSAGE_CANARY, HISTORY_CANARY, BASE_KGI_CANARY, REPLY_CANARY, RETURNED_PURPOSE_CANARY]) {
    expect(everything).not.toContain(canary);
  }
}

describe("POST /api/plan/chat — 入口の検査 (EXP-009 L4)", () => {
  it("セッション無しは 401 で Gemini を呼ばない (EXP-009 L4)", async () => {
    const calls = geminiState.calls;
    const res = await POST(post(validBody));
    expect(res.status).toBe(401);
    expect(await res.json()).toHaveProperty("error");
    expect(geminiState.calls).toBe(calls);
    expectOnePerfLine(401);
    expectNoCanaryInLogs();
  });

  it.each([
    ["壊れた JSON", "{not json"],
    ["message が無い", { project: PROJECT, plan: basePlan, history }],
    ["message が文字列でない", { ...validBody, message: 123 }],
    ["history が配列でない", { ...validBody, history: "x" }],
  ])("%s は 400 で Gemini を呼ばない (EXP-009 L4)", async (_label, body) => {
    signedInWithEmail();
    const calls = geminiState.calls;
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
    expect(geminiState.calls).toBe(calls);
    expectOnePerfLine(400);
    expectNoCanaryInLogs();
  });
});

describe("POST /api/plan/chat — 200 (EXP-009 L4)", () => {
  it("200 { reply, plan, next }・AI の返した欄だけが重なる (EXP-009 L4)", async () => {
    signedInWithEmail();
    const res = await POST(post(validBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply).toBe(REPLY_CANARY);
    expect(body.plan).toEqual({ ...basePlan, purpose: RETURNED_PURPOSE_CANARY });
    expect(body.next).toBe("kpis");
  });

  it("AI の返した空の値では上書きしない (EXP-009 L4)", async () => {
    signedInWithEmail();
    geminiReplies({ reply: REPLY_CANARY, plan: { purpose: RETURNED_PURPOSE_CANARY, kgi: "", kpis: [] } });
    const res = await POST(post(validBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan.kgi).toBe(BASE_KGI_CANARY);
    expect(body.plan.purpose).toBe(RETURNED_PURPOSE_CANARY);
    expect(body.plan.kpis).toEqual([]);
  });

  it("next は AI の返した値ではなくサーバで決め直す (EXP-009 L4)", async () => {
    signedInWithEmail();
    geminiReplies({ reply: REPLY_CANARY, plan: { purpose: RETURNED_PURPOSE_CANARY }, next: "deliverable" });
    const res = await POST(post(validBody));
    expect((await res.json()).next).toBe("kpis");
  });

  it("AI が Plan を返さなければ今の Plan のまま・next は今の Plan から (EXP-009 L4)", async () => {
    signedInWithEmail();
    geminiReplies({ reply: REPLY_CANARY });
    const res = await POST(post(validBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan).toEqual(basePlan);
    expect(body.next).toBe("purpose");
  });

  it("Gemini に JSON で返させる (responseMimeType: application/json)・本文はモデルに渡る (EXP-009 L4)", async () => {
    signedInWithEmail();
    await POST(post(validBody));
    expect(geminiState.lastConfig).toMatchObject({ responseMimeType: "application/json" });
    expect(geminiState.lastPrompt).toContain(MESSAGE_CANARY);
  });

  it("[perf] 1 行・許可項目だけ・fields_filled は返した Plan の埋まった欄の数・history_len (EXP-009 L4)", async () => {
    signedInWithEmail();
    await POST(post(validBody));
    const line = expectOnePerfLine(200);
    expect(line).toMatchObject({ fields_filled: 2, history_len: 2 });
    expect(typeof line.gemini_ms).toBe("number");
  });

  it("ログに会話の本文・Plan の中身・返答・メール・トークンが出ない (EXP-009 L4)", async () => {
    signedInWithEmail();
    const res = await POST(post(validBody));
    await res.text();
    expectNoCanaryInLogs();
  });
});

describe("POST /api/plan/chat — 失敗 (EXP-009 L4)", () => {
  it("1 日の上限の 429 は kind=quota_daily (EXP-009 L4)", async () => {
    signedInWithEmail();
    geminiState.failWith = quotaError("GenerateRequestsPerDayPerProjectPerModel-FreeTier");
    const res = await POST(post(validBody));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({ kind: "quota_daily" });
    expect(body.reset_at).toMatch(/^\d{2}:\d{2}$/);
    expectOnePerfLine(429);
    expectNoCanaryInLogs();
  });

  it("それ以外の 429 は kind=quota_rate (EXP-009 L4)", async () => {
    signedInWithEmail();
    geminiState.failWith = quotaError("GenerateRequestsPerMinutePerProjectPerModel-FreeTier");
    const res = await POST(post(validBody));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ kind: "quota_rate" });
  });

  it("Gemini の失敗は 500・[perf] 1 行・中身はログに出ない (EXP-009 L4)", async () => {
    signedInWithEmail();
    geminiState.failWith = new Error("fake gemini failure");
    const res = await POST(post(validBody));
    expect(res.status).toBe(500);
    expectOnePerfLine(500);
    expectNoCanaryInLogs();
  });
});
