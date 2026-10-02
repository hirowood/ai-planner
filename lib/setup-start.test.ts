import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_START_CHOICES, OPENING, summarizePast, type PastProject } from "./setup-start";
import { authState } from "../test/mocks/next-auth";
import { geminiState } from "../test/mocks/generative-ai";
import { capturePerf } from "../test/mocks/fetch";

vi.mock("next-auth", async () => (await import("../test/mocks/next-auth")).nextAuthMock);
vi.mock("../app/api/auth/[...nextauth]/route", async () => (await import("../test/mocks/next-auth")).authRouteMock);
vi.mock("@google/generative-ai", async () => (await import("../test/mocks/generative-ai")).generativeAiMock);

const db: { rows: Record<string, unknown>[]; calls: { q: string; values: unknown[] }[] } = { rows: [], calls: [] };
vi.mock("./db", () => ({
  DbNotConfigured: class extends Error {},
  getSql: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    db.calls.push({ q: strings.join("?"), values });
    return db.rows;
  },
}));

import { GET } from "../app/api/setup/start/route";

const zero = { todo: 0, doing: 0, done: 0, shelved: 0, failed: 0, succeeded: 0, adjusted: 0 };
const past = (over: Partial<PastProject>): PastProject => ({ name: "英語", category: "learning", purpose: "", kgiTitle: null, kgiStatus: null, counts: zero, ...over });

describe("summarizePast (EXP-027 L1)", () => {
  it("1 件 1 行・種類の名前・KGI と状態の数", () => {
    const out = summarizePast([past({ purpose: "昇進", kgiTitle: "TOEIC 800", kgiStatus: "succeeded", counts: { ...zero, done: 3, shelved: 1 } })]);
    expect(out).toBe("- 英語 (学習): 目的「昇進」・KGI「TOEIC 800」は成功・未実行 0 / 実行中 0 / 実行 3 / 棚上げ 1 / 失敗 0 / 成功 0 / 調整 0");
  });
  it("10 件まで・60 字で切る・< を全角・KGI が無いとき", () => {
    const many = Array.from({ length: 12 }, (_, i) => past({ name: `p${i}` }));
    expect(summarizePast(many).split("\n")).toHaveLength(10);
    const long = summarizePast([past({ purpose: "あ".repeat(70) })]);
    expect(long).toContain(`目的「${"あ".repeat(60)}…」`);
    expect(summarizePast([past({ name: "<script>" })])).toContain("＜script＞");
    expect(summarizePast([past({})])).toContain("KGI はまだ無い");
  });
});

describe("GET /api/setup/start (EXP-027 L2)", () => {
  let perf: ReturnType<typeof capturePerf>;
  beforeEach(() => {
    perf = capturePerf();
    authState.session = { user: { name: "t", email: "owner@example.com" }, expires: "2099-01-01" } as never;
    geminiState.failWith = null;
    geminiState.lastPrompt = null;
    db.rows = [];
    db.calls = [];
  });
  afterEach(() => perf.restore());

  it("401", async () => {
    authState.session = null;
    expect((await GET()).status).toBe(401);
  });
  it("過去 0 件 → 既定で Gemini を呼ばない", async () => {
    const res = await GET();
    expect(await res.json()).toEqual({ message: OPENING, choices: DEFAULT_START_CHOICES, analyzed: false });
    expect(geminiState.lastPrompt).toBeNull();
  });
  it("1 件以上 → <Records> と要約・trend と choices・全問い合わせに owner・中身とメールはログに出ない", async () => {
    const CANARY = "目的カナリア4z";
    db.rows = [{ name: "英語", category: "learning", purpose: CANARY, kgi_title: "TOEIC", kgi_status: "todo", c_todo: 2, c_done: 1, c_shelved: 0, c_failed: 0, c_succeeded: 0, c_adjusted: 0 }];
    geminiState.reply = JSON.stringify({ trend: "学習が続いています", choices: ["英会話を続けたい", "試験に合格したい"] });
    const body = await (await GET()).json();
    expect(body).toEqual({ message: `学習が続いています\n${OPENING}`, choices: ["英会話を続けたい", "試験に合格したい"], analyzed: true });
    expect(geminiState.lastPrompt ?? "").toMatch(/<Records>[\s\S]*英語 \(学習\)[\s\S]*<\/Records>/);
    expect(db.calls.every((c) => c.values.includes("owner@example.com"))).toBe(true);
    const logs = perf.all.join("\n");
    expect(logs).not.toContain(CANARY);
    expect(logs).not.toContain("owner@example.com");
    expect(perf.parsed().find((l) => l.route === "api/setup/start")).toMatchObject({ status: 200, row_count: 1, choices_count: 2 });
  });
  it("choices が空なら既定・429 なら既定と 1 行", async () => {
    db.rows = [{ name: "a", category: "work", purpose: "", kgi_title: null, kgi_status: null }];
    geminiState.reply = JSON.stringify({ trend: "", choices: [] });
    expect((await (await GET()).json()).choices).toEqual(DEFAULT_START_CHOICES);
    geminiState.failWith = Object.assign(new Error("429"), { status: 429 });
    const body = await (await GET()).json();
    expect(body.choices).toEqual(DEFAULT_START_CHOICES);
    expect(body.message).toContain("上限");
    expect(body.analyzed).toBe(false);
  });
});
