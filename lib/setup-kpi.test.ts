import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mergeKpiDrafts, parseKpiDrafts, setupKpisReady } from "./setup-kpi";
import { authState } from "../test/mocks/next-auth";
import { geminiState } from "../test/mocks/generative-ai";
import { capturePerf } from "../test/mocks/fetch";

const TODAY = "2026-10-02";
const DUE = "2026-12-31";

describe("KPI の下書き (EXP-037 L1)", () => {
  it("3 個まで・空の題・201 字・昨日・KGI の期限より後・実在しない日付は捨てる・期日なしは通る", () => {
    const got = parseKpiDrafts(
      [
        { title: "a", target: "t", dueDate: "2026-11-30" },
        { title: "" },
        { title: "あ".repeat(201) },
        { title: "b", dueDate: "2026-10-01" },
        { title: "c", dueDate: "2027-01-01" },
        { title: "d", dueDate: "2026-02-30" },
        { title: "e" },
        { title: "f", dueDate: DUE },
        { title: "g" },
      ],
      DUE,
      TODAY,
    );
    expect(got).toEqual([
      { title: "a", target: "t", dueDate: "2026-11-30" },
      { title: "e", target: "", dueDate: "" },
      { title: "f", target: "", dueDate: DUE },
    ]);
    expect(parseKpiDrafts("x", DUE, TODAY)).toEqual([]);
  });
  it("merge: 通った分で置き換え・何も通らなければ元のまま", () => {
    const base = [{ title: "a", target: "", dueDate: "" }];
    expect(mergeKpiDrafts(base, [{ title: "b" }], DUE, TODAY)).toEqual([{ title: "b", target: "", dueDate: "" }]);
    expect(mergeKpiDrafts(base, [{ title: "" }], DUE, TODAY)).toEqual(base);
    expect(mergeKpiDrafts(base, undefined, DUE, TODAY)).toEqual(base);
  });
  it("作れるか: 題のある KPI が 1 つ以上で全部が通る", () => {
    expect(setupKpisReady([{ title: "a", target: "", dueDate: "" }], DUE, TODAY)).toBe(true);
    expect(setupKpisReady([], DUE, TODAY)).toBe(false);
    expect(setupKpisReady([{ title: "a", target: "", dueDate: "2027-01-01" }], DUE, TODAY)).toBe(false);
    expect(setupKpisReady([{ title: "a", target: "", dueDate: "" }, { title: "", target: "", dueDate: "" }], DUE, TODAY)).toBe(true);
  });
});

// /api/setup (EXP-037 L2)
vi.mock("next-auth", async () => (await import("../test/mocks/next-auth")).nextAuthMock);
vi.mock("../app/api/auth/[...nextauth]/route", async () => (await import("../test/mocks/next-auth")).authRouteMock);
vi.mock("@google/generative-ai", async () => (await import("../test/mocks/generative-ai")).generativeAiMock);
const db = vi.hoisted(() => ({ calls: [] as { q: string; values: unknown[] }[], notConfigured: false }));
vi.mock("./db", () => {
  class DbNotConfigured extends Error {}
  return {
    DbNotConfigured,
    getSql: () => {
      if (db.notConfigured) throw new DbNotConfigured("x");
      return async (strings: TemplateStringsArray, ...values: unknown[]) => {
        db.calls.push({ q: strings.join("?"), values });
        return [{ name: "英語 PAST-9c1", category: "learning", purpose: "", kgi_title: "TOEIC 700", kgi_status: "succeeded", c_succeeded: 3 }];
      };
    },
  };
});
import { POST as setupPOST } from "../app/api/setup/route";
import { SmartPanel } from "../app/components/SmartPanel";

const READY = {
  specific: "英語の会議で発言する", measurable: "週 1 回は発言する", timeBound: "2099-12-31",
  relevant: "仕事の幅を広げたい", achievable: "毎朝 20 分なら続けられる", name: "英語で会議", category: "work",
};
const post = (body: unknown) => new Request("http://l/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("/api/setup の KPI の段と過去のデータ (EXP-037 L2)", () => {
  let perf: ReturnType<typeof capturePerf>;
  beforeEach(() => {
    perf = capturePerf();
    authState.session = { user: { name: "t", email: "owner-kpi@example.com" }, expires: "2099-01-01" } as never;
    geminiState.failWith = null;
    db.calls = [];
    db.notConfigured = false;
  });
  afterEach(() => perf.restore());

  it("SMART がそろうと KPI (仮置き) の段・あとで変えられる・過去のプロジェクトが入る (owner で読む)", async () => {
    geminiState.reply = JSON.stringify({ reply: "どう測りますか？", draft: {}, choices: ["模試の点"] });
    const body = await (await setupPOST(post({ draft: READY, history: [], message: "OK" }))).json();
    const p = geminiState.lastPrompt ?? "";
    expect(p).toContain("次に決める欄: KPI (仮置き)");
    expect(p).toContain("KPI は **仮置き** です");
    expect(p).toContain("AI と話しながら変えられます");
    expect(p).toContain("### 過去のプロジェクト (参考");
    expect(p).toContain("英語 PAST-9c1");
    expect(db.calls[0].values).toContain("owner-kpi@example.com");
    expect(body.kpis).toEqual([]);
    expect(body.ready).toBe(false);
    expect(perf.all.join(" ")).not.toContain("owner-kpi@example.com");
  });

  it("AI が kpis を返すと下書きに入り、ready になる", async () => {
    geminiState.reply = JSON.stringify({ reply: "これで作れます", draft: {}, choices: [], kpis: [{ title: "模試で 700 点", target: "700", dueDate: "2099-06-30" }, { title: "期限より後", dueDate: "2100-01-01" }] });
    const body = await (await setupPOST(post({ draft: READY, history: [], message: "模試で" }))).json();
    expect(body.kpis).toEqual([{ title: "模試で 700 点", target: "700", dueDate: "2099-06-30" }]);
    expect(body.ready).toBe(true);
  });

  it("DB が無くても 200 で続く", async () => {
    db.notConfigured = true;
    geminiState.reply = JSON.stringify({ reply: "ok", draft: {}, choices: [] });
    const res = await setupPOST(post({ draft: READY, history: [], message: "x" }));
    expect(res.status).toBe(200);
    expect(geminiState.lastPrompt ?? "").toContain("<Past>\n(まだ無し)\n</Past>");
  });
});

describe("SmartPanel の KPI (EXP-037 L4)", () => {
  const html = (kpis: { title: string; target: string; dueDate: string }[]) =>
    renderToStaticMarkup(createElement(SmartPanel, { draft: READY, onChange: () => {}, ready: false, creating: false, onCreate: () => {}, onCancel: () => {}, kpis, onKpisChange: () => {} }));
  it("KPI の一覧と「仮置き」・足すボタン・次に決める印", () => {
    const empty = html([]);
    expect(empty).toContain("KPI (仮置き・あとで AI と話しながら変えられます)");
    expect(empty).toContain("次に決める");
    expect(empty).toContain("KPI を足す");
    const one = html([{ title: "模試", target: "700", dueDate: "2099-06-30" }]);
    expect(one).toContain('value="模試"');
    expect(one).toContain("KPI 1 を消す");
    expect(one).toContain('max="2099-12-31"');
  });
});
