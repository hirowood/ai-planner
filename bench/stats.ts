// ベンチの集計。bench/run.bench.ts と bench/compare.ts の両方が使う (外部依存なし)。

export type Summary = { n: number; median: number; p90: number; mean: number; stdev: number; cv: number };

const round = (x: number) => Math.round(x * 100) / 100;

export function summarize(values: number[]): Summary {
  if (values.length === 0) throw new Error("summarize: no values");
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  const p90 = s[Math.min(n - 1, Math.ceil(0.9 * n) - 1)]; // nearest-rank
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const stdev = n > 1 ? Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, median: round(median), p90: round(p90), mean: round(mean), stdev: round(stdev), cv: mean ? round(stdev / mean) : 0 };
}

export type ScenarioResult = Record<string, Summary>; // field (total_ms 等) → 集計

export type BenchResult = {
  label: string;
  created_at: string;
  node: string;
  warmup: number;
  network_calls: number;
  scenarios: Record<string, ScenarioResult>;
};
