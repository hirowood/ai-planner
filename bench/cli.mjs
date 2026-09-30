// npm run bench -- --label <name> [--n <count>]
// ベンチ本体は vitest の中で走る (差し替えと遮断を使うため)。ここは引数を env に渡すだけ。
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const label = get("--label");
if (!label || !/^[A-Za-z0-9._-]+$/.test(label)) {
  console.error("usage: npm run bench -- --label <name> [--n <count>]  (label: letters, digits, . _ -)");
  process.exit(2);
}
const env = { ...process.env, BENCH_LABEL: label };
const n = get("--n");
if (n) env.BENCH_N = n;

const r = spawnSync("npx", ["vitest", "run", "--config", "vitest.bench.config.mts"], { stdio: "inherit", env, shell: true });
process.exit(r.status ?? 1);
