import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isOverloaded, withGeminiRetry } from "./gemini-retry";
import { authState } from "../test/mocks/next-auth";
import { geminiState } from "../test/mocks/generative-ai";
import { capturePerf } from "../test/mocks/fetch";

vi.mock("next-auth", async () => (await import("../test/mocks/next-auth")).nextAuthMock);
vi.mock("../app/api/auth/[...nextauth]/route", async () => (await import("../test/mocks/next-auth")).authRouteMock);
vi.mock("@google/generative-ai", async () => (await import("../test/mocks/generative-ai")).generativeAiMock);
vi.mock("./db", () => ({ DbNotConfigured: class extends Error {}, getSql: () => { throw new Error("no db"); } }));

import { POST as setupPOST } from "../app/api/setup/route";

const err = (status: number) => Object.assign(new Error(`[${status}]`), { status });

describe("withGeminiRetry (EXP-028 L1)", () => {
  it("1 回目 503 → 2 回目成功で結果を返す (2 回呼ぶ)", async () => {
    let n = 0;
    const r = await withGeminiRetry(async () => { n += 1; if (n === 1) throw err(503); return "ok"; }, 0);
    expect(r).toBe("ok");
    expect(n).toBe(2);
  });
  it("2 回とも 503 → 503 を投げる", async () => {
    let n = 0;
    await expect(withGeminiRetry(async () => { n += 1; throw err(503); }, 0)).rejects.toMatchObject({ status: 503 });
    expect(n).toBe(2);
  });
  it("429 は送り直さない・成功は 1 回", async () => {
    let n = 0;
    await expect(withGeminiRetry(async () => { n += 1; throw err(429); }, 0)).rejects.toMatchObject({ status: 429 });
    expect(n).toBe(1);
    let m = 0;
    await withGeminiRetry(async () => { m += 1; return 1; }, 0);
    expect(m).toBe(1);
    expect(isOverloaded(err(503))).toBe(true);
    expect(isOverloaded(err(500))).toBe(false);
  });
});

describe("/api/setup の 503 (EXP-028 L2)", () => {
  let perf: ReturnType<typeof capturePerf>;
  beforeEach(() => {
    perf = capturePerf();
    authState.session = { user: { name: "t", email: "t@example.com" }, expires: "2099-01-01" } as never;
    geminiState.reply = JSON.stringify({ reply: "いいですね。", draft: {}, choices: [] });
  });
  afterEach(() => {
    perf.restore();
    geminiState.failWith = null;
    geminiState.failTimes = null;
  });
  const send = () => setupPOST(new Request("http://l/api/setup", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draft: {}, history: [], message: "毎日の習慣を作りたい" }),
  }));

  it("2 回とも 503 → 503 と kind overloaded", async () => {
    geminiState.failWith = err(503);
    geminiState.failTimes = null;
    const res = await send();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ kind: "overloaded" });
  });
  it("1 回目だけ 503 → 200 (自動で送り直す)", async () => {
    geminiState.failWith = err(503);
    geminiState.failTimes = 1;
    const res = await send();
    expect(res.status).toBe(200);
    expect((await res.json()).reply).toBe("いいですね。");
  });
});
