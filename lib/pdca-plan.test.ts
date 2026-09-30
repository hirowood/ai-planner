import { describe, expect, it } from "vitest";
import {
  EMPTY_PLAN,
  PLAN_FIELDS,
  PLAN_FIELD_LABEL,
  filledCount,
  mergePlan,
  nextField,
  openingMessage,
  parsePlanDraft,
  planToEvents,
  type PlanDraft,
  type PlanField,
} from "./pdca-plan";

const FULL: PlanDraft = {
  purpose: "毎朝歩いて体力をつける",
  kgi: "10 月末に 5km を 40 分で歩ける",
  kpis: [{ name: "歩いた日数", target: "週 5 日" }],
  kdis: [{ action: "朝の散歩", date: "2026-10-01", start: "07:00", end: "07:30" }],
  criteria: "週 5 日を 3 週続けたら成功",
  deliverable: "散歩の記録表",
};

/** 聞く順どおりに先頭 n 欄だけ埋めた Plan */
function filledUpTo(n: number): PlanDraft {
  const d: PlanDraft = { ...EMPTY_PLAN, kpis: [], kdis: [] };
  PLAN_FIELDS.slice(0, n).forEach((f) => {
    (d as Record<PlanField, unknown>)[f] = FULL[f];
  });
  return d;
}

const questionCount = (s: string) => (s.match(/[？?]/g) ?? []).length;

describe("lib/pdca-plan — 欄の定義 (EXP-009 L1)", () => {
  it("聞く順は 目的 → 目標 → KPI → 行動 → 判定基準 → 成果物 (EXP-009 L1)", () => {
    expect(PLAN_FIELDS).toEqual(["purpose", "kgi", "kpis", "kdis", "criteria", "deliverable"]);
  });

  it("欄のラベル (EXP-009 L1)", () => {
    expect(PLAN_FIELD_LABEL).toEqual({
      purpose: "目的",
      kgi: "目標 (KGI)",
      kpis: "途中の指標 (KPI)",
      kdis: "行動 (KDI)",
      criteria: "判定基準",
      deliverable: "成果物",
    });
  });

  it("EMPTY_PLAN は全部空 (EXP-009 L1)", () => {
    expect(EMPTY_PLAN).toEqual({ purpose: "", kgi: "", kpis: [], kdis: [], criteria: "", deliverable: "" });
    expect(filledCount(EMPTY_PLAN)).toBe(0);
  });
});

describe("parsePlanDraft (EXP-009 L1)", () => {
  it("正しい形はそのまま通る (EXP-009 L1)", () => {
    expect(parsePlanDraft(FULL)).toEqual(FULL);
  });

  it("文字列は trim する (EXP-009 L1)", () => {
    const r = parsePlanDraft({ ...FULL, purpose: "  歩く  ", deliverable: "\n記録\t" });
    expect(r?.purpose).toBe("歩く");
    expect(r?.deliverable).toBe("記録");
  });

  it("500 字はそのまま通る (EXP-009 L1)", () => {
    const r = parsePlanDraft({ ...FULL, purpose: "あ".repeat(500) });
    expect(r?.purpose).toBe("あ".repeat(500));
  });

  it.each(["purpose", "kgi", "criteria", "deliverable"] as const)(
    "%s が 501 字なら 500 字を超えて残らない (EXP-009 L1)",
    (field) => {
      const r = parsePlanDraft({ ...FULL, [field]: "あ".repeat(501) });
      // 切り詰め・拒否 (null) のどちらでもよいが、501 字のまま通ってはいけない
      if (r !== null) expect(r[field].length).toBeLessThanOrEqual(500);
    },
  );

  it("KPI が 4 件なら 3 件まで (EXP-009 L1)", () => {
    const kpis = [1, 2, 3, 4].map((i) => ({ name: `指標${i}`, target: `${i}` }));
    const r = parsePlanDraft({ ...FULL, kpis });
    if (r !== null) expect(r.kpis).toEqual(kpis.slice(0, 3));
    expect(parsePlanDraft({ ...FULL, kpis: kpis.slice(0, 3) })?.kpis).toEqual(kpis.slice(0, 3));
  });

  it("行動が 6 件なら 5 件まで (EXP-009 L1)", () => {
    const kdis = [1, 2, 3, 4, 5, 6].map((i) => ({ action: `行動${i}`, date: `2026-10-0${i}`, start: "07:00", end: "07:30" }));
    const r = parsePlanDraft({ ...FULL, kdis });
    if (r !== null) expect(r.kdis).toEqual(kdis.slice(0, 5));
    expect(parsePlanDraft({ ...FULL, kdis: kdis.slice(0, 5) })?.kdis).toEqual(kdis.slice(0, 5));
  });

  it("形の合わない KPI・行動は捨てる (EXP-009 L1)", () => {
    const goodKpi = { name: "歩いた日数", target: "週 5 日" };
    const goodKdi = { action: "散歩", date: "2026-10-01", start: "", end: "" };
    const r = parsePlanDraft({
      ...FULL,
      kpis: [goodKpi, { name: 1, target: "x" }, "文字列", null, { target: "名前が無い" }],
      kdis: [goodKdi, { action: 42, date: "2026-10-01", start: "", end: "" }, 7, null, ["配列"]],
    });
    expect(r).not.toBeNull();
    expect(r!.kpis).toEqual([goodKpi]);
    expect(r!.kdis).toEqual([goodKdi]);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["文字列", "plan"],
    ["数", 42],
  ])("オブジェクトでない (%s) は null (EXP-009 L1)", (_label, x) => {
    expect(parsePlanDraft(x)).toBeNull();
  });
});

describe("mergePlan (EXP-009 L1)", () => {
  const base: PlanDraft = { ...FULL };

  it("返した欄だけを上書きする (EXP-009 L1)", () => {
    const r = mergePlan(base, { kgi: "新しい目標" });
    expect(r).toEqual({ ...base, kgi: "新しい目標" });
  });

  it("配列の欄は中身があれば置き換える (EXP-009 L1)", () => {
    const kpis = [{ name: "歩数", target: "8000 歩" }];
    expect(mergePlan(base, { kpis }).kpis).toEqual(kpis);
  });

  it.each([
    ["空文字", { purpose: "", kgi: "", criteria: "", deliverable: "" }],
    ["空の配列", { kpis: [], kdis: [] }],
    ["null", { purpose: null, kpis: null }],
  ])("空の値 (%s) では上書きしない (EXP-009 L1)", (_label, patch) => {
    expect(mergePlan(base, patch)).toEqual(base);
  });

  it.each([
    ["null", null],
    ["文字列", "purpose"],
    ["知らない欄だけ", { foo: "bar" }],
  ])("使えない patch (%s) なら base のまま (EXP-009 L1)", (_label, patch) => {
    expect(mergePlan(base, patch)).toEqual(base);
  });

  it("base を書き換えない (EXP-009 L1)", () => {
    const snapshot = structuredClone(base);
    mergePlan(base, { purpose: "別の目的", kpis: [{ name: "x", target: "y" }] });
    expect(base).toEqual(snapshot);
  });

  it("patch の値にも上限がかかる (501 字・KPI 4 件・行動 6 件) (EXP-009 L1)", () => {
    const r = mergePlan(EMPTY_PLAN, {
      purpose: "あ".repeat(501),
      kpis: [1, 2, 3, 4].map((i) => ({ name: `n${i}`, target: `t${i}` })),
      kdis: [1, 2, 3, 4, 5, 6].map((i) => ({ action: `a${i}`, date: "2026-10-01", start: "", end: "" })),
    });
    expect(r.purpose.length).toBeLessThanOrEqual(500);
    expect(r.kpis.length).toBeLessThanOrEqual(3);
    expect(r.kdis.length).toBeLessThanOrEqual(5);
  });
});

describe("nextField・filledCount (EXP-009 L1)", () => {
  it.each([
    [0, "purpose"],
    [1, "kgi"],
    [2, "kpis"],
    [3, "kdis"],
    [4, "criteria"],
    [5, "deliverable"],
    [6, null],
  ] as const)("聞く順の先頭 %i 欄が埋まっていれば次は %s (EXP-009 L1)", (n, want) => {
    const d = filledUpTo(n);
    expect(nextField(d)).toBe(want);
    expect(filledCount(d)).toBe(n);
  });

  it("途中の欄が空なら、後ろが埋まっていてもその欄を聞く (EXP-009 L1)", () => {
    expect(nextField({ ...FULL, purpose: "" })).toBe("purpose");
    expect(nextField({ ...FULL, kpis: [] })).toBe("kpis");
    expect(filledCount({ ...FULL, kpis: [], criteria: "" })).toBe(4);
  });
});

describe("openingMessage (EXP-009 L2)", () => {
  const project = { name: "朝の散歩プロジェクト", purpose: "体力をつけたい" };

  it("空の Plan: プロジェクト名が入り「？」は 1 つ (EXP-009 L2)", () => {
    const m = openingMessage(project, EMPTY_PLAN);
    expect(m).toContain(project.name);
    expect(questionCount(m)).toBe(1);
  });

  it("空の Plan: プロジェクトの目的があれば触れる (EXP-009 L2)", () => {
    expect(openingMessage(project, EMPTY_PLAN)).toContain(project.purpose);
  });

  it("プロジェクトの目的が空でも「？」は 1 つ (EXP-009 L2)", () => {
    const m = openingMessage({ name: project.name, purpose: "" }, EMPTY_PLAN);
    expect(m).toContain(project.name);
    expect(questionCount(m)).toBe(1);
  });

  it("目的まで埋まっていれば目標を聞く (EXP-009 L2)", () => {
    const m = openingMessage(project, filledUpTo(1));
    expect(m).toContain("目標");
    expect(questionCount(m)).toBe(1);
  });

  it("全部埋まれば保存を促す (EXP-009 L2)", () => {
    const m = openingMessage(project, FULL);
    expect(m).toContain("保存");
    expect(questionCount(m)).toBe(1);
  });

  it.each([0, 1, 2, 3, 4, 5, 6])("先頭 %i 欄が埋まった Plan でも「？」は 1 つだけ (EXP-009 L2)", (n) => {
    expect(questionCount(openingMessage(project, filledUpTo(n)))).toBe(1);
  });
});

describe("planToEvents (EXP-009 L3)", () => {
  const CYCLE_ID = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const plan: PlanDraft = {
    ...FULL,
    kdis: [
      { action: "朝の散歩", date: "2026-10-01", start: "07:00", end: "07:30" },
      { action: "時刻が無い", date: "2026-10-02", start: "", end: "" },
      { action: "終わりが無い", date: "2026-10-03", start: "07:00", end: "" },
      { action: "日付が無い", date: "", start: "07:00", end: "07:30" },
      { action: "夜の振り返り", date: "2026-10-04", start: "21:00", end: "21:15" },
    ],
  };

  type Ev = { summary: string; description?: string; start: { dateTime?: string }; end: { dateTime?: string } };
  const events = () => planToEvents(plan, CYCLE_ID) as unknown as Ev[];

  it("日付と開始・終了がそろった行動だけが予定になる (EXP-009 L3)", () => {
    const evs = events();
    expect(evs).toHaveLength(2);
    expect(evs[0].summary).toContain("朝の散歩");
    expect(evs[1].summary).toContain("夜の振り返り");
  });

  it("開始・終了は +09:00 の ISO (EXP-009 L3)", () => {
    const [first, second] = events();
    expect(first.start.dateTime).toMatch(/^2026-10-01T07:00(:00)?\+09:00$/);
    expect(first.end.dateTime).toMatch(/^2026-10-01T07:30(:00)?\+09:00$/);
    expect(second.start.dateTime).toMatch(/^2026-10-04T21:00(:00)?\+09:00$/);
    expect(second.end.dateTime).toMatch(/^2026-10-04T21:15(:00)?\+09:00$/);
  });

  it("説明に Plan の要点が入り、最終行は PDCA-CYCLE:<id> (EXP-009 L3)", () => {
    for (const ev of events()) {
      const description = ev.description ?? "";
      expect(description.includes(plan.purpose) || description.includes(plan.kgi)).toBe(true);
      expect(description.split(/\r?\n/).pop()).toBe(`PDCA-CYCLE:${CYCLE_ID}`);
    }
  });

  it("そろった行動が無ければ空の配列 (EXP-009 L3)", () => {
    expect(planToEvents(EMPTY_PLAN, CYCLE_ID)).toEqual([]);
    expect(planToEvents({ ...plan, kdis: plan.kdis.slice(1, 4) }, CYCLE_ID)).toEqual([]);
  });
});
