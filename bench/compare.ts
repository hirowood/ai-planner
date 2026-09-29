// 比較判定 (measure → improve ループ M1 / T-012)
// 事前登録した閾値 (ms) を使って、2 つのベンチ結果を「改善 / 差なし / 悪化」に機械的に分ける。
// 閾値は測った後で変えない — 実験カードの request.md に書いた値をそのまま渡す。
// 実行: node bench/compare.ts <base.json> <candidate.json> <scenario> <field> <threshold_ms>
import { readFileSync } from "node:fs";
import type { BenchResult } from "./stats";

export type Verdict = "improved" | "no_change" | "worse";

export type Comparison = {
  scenario: string;
  field: string;
  base_median: number;
  candidate_median: number;
  delta_ms: number; // base − candidate (正 = 速くなった)
  threshold_ms: number;
  verdict: Verdict;
};

export function compare(base: BenchResult, cand: BenchResult, scenario: string, field: string, thresholdMs: number): Comparison {
  if (!(thresholdMs > 0)) throw new Error("threshold_ms must be a positive number fixed before measuring");
  for (const [name, r] of [["base", base], ["candidate", cand]] as const) {
    if (r.network_calls !== 0) throw new Error(`${name}: network_calls=${r.network_calls} (lab results must be offline)`);
  }
  const b = base.scenarios[scenario]?.[field];
  const c = cand.scenarios[scenario]?.[field];
  if (!b || !c) throw new Error(`missing ${scenario}.${field} in ${!b ? "base" : "candidate"}`);
  const delta = Math.round((b.median - c.median) * 100) / 100;
  const verdict: Verdict = delta > thresholdMs ? "improved" : delta < -thresholdMs ? "worse" : "no_change";
  return { scenario, field, base_median: b.median, candidate_median: c.median, delta_ms: delta, threshold_ms: thresholdMs, verdict };
}

// CLI (node bench/compare.ts ...)
if (process.argv[1]?.replace(/\\/g, "/").endsWith("bench/compare.ts")) {
  const [basePath, candPath, scenario, field, threshold] = process.argv.slice(2);
  if (!threshold) {
    console.error("usage: node bench/compare.ts <base.json> <candidate.json> <scenario> <field> <threshold_ms>");
    process.exit(2);
  }
  const load = (p: string) => JSON.parse(readFileSync(p, "utf-8")) as BenchResult;
  const result = compare(load(basePath), load(candPath), scenario, field, Number(threshold));
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.verdict === "worse" ? 1 : 0);
}
