import { describe, expect, it } from "vitest";
import { compare } from "./compare";
import { summarize, type BenchResult } from "./stats";

const result = (medianMs: number, networkCalls = 0): BenchResult => ({
  label: `m${medianMs}`,
  created_at: "2026-09-29T00:00:00Z",
  node: "v24",
  warmup: 3,
  network_calls: networkCalls,
  scenarios: { "api/chat": { total_ms: summarize([medianMs - 1, medianMs, medianMs + 1]) } },
});

describe("bench/compare — 事前登録した閾値で機械的に判定する", () => {
  it("閾値を超えて速くなれば improved", () => {
    expect(compare(result(100), result(80), "api/chat", "total_ms", 10).verdict).toBe("improved");
  });

  it("差が閾値以内なら no_change (小さな差を改善と呼ばない)", () => {
    expect(compare(result(100), result(95), "api/chat", "total_ms", 10).verdict).toBe("no_change");
    expect(compare(result(100), result(110), "api/chat", "total_ms", 10).verdict).toBe("no_change"); // ちょうど閾値は超えていない
  });

  it("閾値を超えて遅くなれば worse", () => {
    expect(compare(result(100), result(125), "api/chat", "total_ms", 10).verdict).toBe("worse");
  });

  it("ネットワーク呼び出しが 1 回でもある結果は比べない", () => {
    expect(() => compare(result(100, 1), result(80), "api/chat", "total_ms", 10)).toThrow("network_calls=1");
  });

  it("閾値が無い / 0 以下なら判定しない (測った後に閾値を決めさせない)", () => {
    expect(() => compare(result(100), result(80), "api/chat", "total_ms", 0)).toThrow("threshold_ms");
  });

  it("baseField: ベースラインの別の項目と比べられる (EXP-001 R1: total_ms -> first_chunk_ms)", () => {
    const cand: BenchResult = { ...result(100), scenarios: { "api/chat": { first_chunk_ms: summarize([9, 10, 11]), total_ms: summarize([99, 100, 101]) } } };
    const r = compare(result(100), cand, "api/chat", "first_chunk_ms", 2.12, "total_ms");
    expect(r).toMatchObject({ field: "total_ms -> first_chunk_ms", base_median: 100, candidate_median: 10, delta_ms: 90, verdict: "improved" });
  });

  it("summarize: median / p90 / cv", () => {
    const s = summarize([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(s).toMatchObject({ n: 10, median: 55, p90: 90, mean: 55 });
    expect(s.cv).toBeCloseTo(0.55, 2);
  });
});
