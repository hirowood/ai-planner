// 計測点そのもののコスト (T-013)。同じ処理を「計測点あり / なし」で N 回ずつ回し、差を 1 回あたりに割る。
// console.log の書き出しは、実際の出力先の代わりに一時ファイルへの writeSync で近似する
// (vitest は console を横取りするため、そのままでは本番の stdout のコストにならない)。
import { closeSync, mkdirSync, openSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, it, vi } from "vitest";
import { startPerf } from "../lib/perf";

const N = Number(process.env.OVERHEAD_N ?? 5000);
const ROUNDS = 5;
let result: Record<string, unknown> = {};

const noopAsync = async () => 1;

it(`overhead n=${N} x ${ROUNDS} rounds`, async () => {
  const dir = join(tmpdir(), `perf-overhead-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const fd = openSync(join(dir, "stdout.log"), "w");
  const spy = vi.spyOn(console, "log").mockImplementation((line: string) => {
    writeSync(fd, line + "\n");
  });

  const perRound: { without: number; with: number }[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    let t = performance.now();
    for (let i = 0; i < N; i++) {
      await noopAsync();
      new Response(null, { status: 200 });
    }
    const without = (performance.now() - t) / N;

    t = performance.now();
    for (let i = 0; i < N; i++) {
      const p = startPerf("api/chat", ["gemini_ms"]);
      await p.time("gemini_ms", noopAsync);
      p.finish(new Response(null, { status: 200 }));
    }
    const withPerf = (performance.now() - t) / N;
    perRound.push({ without, with: withPerf });
  }

  spy.mockRestore();
  closeSync(fd);
  rmSync(dir, { recursive: true, force: true });

  const diffs = perRound.map((x) => x.with - x.without).sort((a, b) => a - b);
  result = {
    n: N,
    rounds: ROUNDS,
    per_request_overhead_ms_median: Math.round(diffs[Math.floor(ROUNDS / 2)] * 10000) / 10000,
    per_request_overhead_ms_max: Math.round(diffs[ROUNDS - 1] * 10000) / 10000,
    rounds_detail: perRound.map((x) => ({ without_ms: Math.round(x.without * 10000) / 10000, with_ms: Math.round(x.with * 10000) / 10000 })),
  };
}, 120_000);

afterAll(() => {
  mkdirSync("bench/results", { recursive: true });
  const file = `bench/results/${process.env.BENCH_LABEL ?? "unlabeled"}.overhead.json`;
  writeFileSync(file, JSON.stringify(result, null, 2) + "\n");
});
