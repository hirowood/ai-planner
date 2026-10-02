import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_START_CHOICES, afterCreateMessage } from "./setup-start";
import { authState } from "../test/mocks/next-auth";
import { geminiState } from "../test/mocks/generative-ai";
import { capturePerf } from "../test/mocks/fetch";

vi.mock("next-auth", async () => (await import("../test/mocks/next-auth")).nextAuthMock);
vi.mock("../app/api/auth/[...nextauth]/route", async () => (await import("../test/mocks/next-auth")).authRouteMock);
vi.mock("@google/generative-ai", async () => (await import("../test/mocks/generative-ai")).generativeAiMock);
vi.mock("./db", () => ({
  DbNotConfigured: class extends Error {},
  getSql: () => async () => [{ name: "英語", category: "learning", purpose: "", kgi_title: "TOEIC", kgi_status: "todo" }],
}));

import { GET as startGET } from "../app/api/setup/start/route";
import { POST as setupPOST } from "../app/api/setup/route";

describe("KGI (成果) に揃える (EXP-029)", () => {
  let perf: ReturnType<typeof capturePerf>;
  beforeEach(() => {
    perf = capturePerf();
    authState.session = { user: { name: "t", email: "t@example.com" }, expires: "2099-01-01" } as never;
    geminiState.failWith = null;
    geminiState.failTimes = null;
  });
  afterEach(() => perf.restore());

  it("L1: 傾向の候補の指示に「成果」「行動は書かない」「KDI」・既定の候補は成果の言い方", async () => {
    geminiState.reply = JSON.stringify({ trend: "学習が続いています", choices: ["英語で会議に出る"] });
    await startGET();
    const p = geminiState.lastPrompt ?? "";
    expect(p).toContain("成果・なりたい状態の言い方");
    expect(p).toContain("行動は書かないでください");
    expect(p).toContain("KDI");
    expect(DEFAULT_START_CHOICES).toEqual(["健康的な生活習慣を身につける", "資格・試験に合格する", "仕事で成果を出す", "まだ決めていない"]);
    // 行動の言い方 (毎日〜・〜したい) を既定の候補に入れない
    expect(DEFAULT_START_CHOICES.some((c) => /毎日|時間|したい/.test(c))).toBe(false);
  });

  it("L2: SMART の会話の指示に「どうなっていたいか (成果)」「それは後で決める KDI」と階層の順", async () => {
    geminiState.reply = JSON.stringify({ reply: "何を達成したいですか？", draft: {}, choices: [] });
    await setupPOST(new Request("http://l/api/setup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: {}, history: [], message: "毎朝 20 分走る" }),
    }));
    const p = geminiState.lastPrompt ?? "";
    expect(p).toContain("期限までにどうなっていたいか (成果)");
    expect(p).toContain("それは後で決める KDI (行動の目標) です");
    // EXP-037: 作るときに KPI (仮置き) まで決める
    expect(p).toContain("階層は KGI → KPI → KDI (行動の目標) → ToDo の順で、KDI から下はプロジェクトを作った後に決めます");
  });

  it("L3: 作った直後の一言は KDI へ案内する (EXP-037 が EXP-029 の「KPI へ」を置き換え)", () => {
    const m = afterCreateMessage("英語で会議");
    expect(m).toContain("『英語で会議』の KGI ができました (固定)");
    expect(m).toContain("KPI は仮置きで、あとで話しながら変えられます");
    expect(m).toContain("次は、KPI を達成するための KDI (行動の量・頻度) を決めましょう");
    expect([...m].filter((c) => c === "？").length).toBe(1);
  });
});
