import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authState, signedIn } from "../test/mocks/next-auth";
import { geminiState } from "../test/mocks/generative-ai";
import { capturePerf } from "../test/mocks/fetch";
import { GEMINI_MODEL } from "./model";

vi.mock("next-auth", async () => (await import("../test/mocks/next-auth")).nextAuthMock);
vi.mock("../app/api/auth/[...nextauth]/route", async () => (await import("../test/mocks/next-auth")).authRouteMock);
vi.mock("@google/generative-ai", async () => (await import("../test/mocks/generative-ai")).generativeAiMock);

import { POST as chatPOST } from "../app/api/chat/route";
import { POST as planPOST } from "../app/api/plan/chat/route";

const json = (body: unknown) =>
  new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("使うモデル (EXP-015 L1)", () => {
  let perf: ReturnType<typeof capturePerf>;
  beforeEach(() => {
    perf = capturePerf();
    authState.session = signedIn();
    geminiState.failWith = null;
    geminiState.chunks = null;
    geminiState.lastModel = null;
  });
  afterEach(() => perf.restore());

  it("モデルは gemini-3.5-flash-lite", () => {
    expect(GEMINI_MODEL).toBe("gemini-3.5-flash-lite");
  });

  it("/api/chat は lib/model.ts のモデルを使う", async () => {
    geminiState.reply = "こんにちは";
    const res = await chatPOST(json({ message: "hi", history: [] }));
    await res.text();
    expect(geminiState.lastModel).toBe(GEMINI_MODEL);
  });

  it("/api/plan/chat は lib/model.ts のモデルを使う", async () => {
    geminiState.reply = JSON.stringify({ reply: "目的は？", plan: {} });
    const res = await planPOST(
      json({ project: { name: "p", category: "habit", purpose: "" }, plan: {}, history: [], message: "hi" }),
    );
    expect(res.status).toBe(200);
    expect(geminiState.lastModel).toBe(GEMINI_MODEL);
  });
});
