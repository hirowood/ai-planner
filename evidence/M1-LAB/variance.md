# M1 実験室のばらつきと計測点のオーバーヘッド (T-013)

Date: 2026-09-29 / branch `perf/loop-1` (commit `3f43c3c` + `bench/overhead.bench.ts`) / Windows・Node v24.19.0
条件 (両回とも同一): n=20・warm-up 3 回・差替え遅延 gemini 100ms / calendar 30ms・create は 3 件
生データ: `bench-run-a.json` / `bench-run-b.json` / `overhead-run-a.json` / `overhead-run-b.json`

## 1. 同じコードの 2 回実行

| route | 項目 | median A | median B | 2 回の差 | CV A / B | 差 ≤ CV |
|---|---|---|---|---|---|---|
| api/chat | total_ms | 108.25 | 108.45 | 0.18% | 0.01 / 0.01 | ✓ |
| api/chat | gemini_ms | 107.65 | 107.70 | 0.05% | 0.01 / 0.01 | ✓ |
| api/calendar/get | total_ms | 31.20 | 31.20 | 0.00% | 0.18 / 0.19 | ✓ |
| api/calendar/get | calendar_ms | 31.05 | 30.95 | 0.32% | 0.18 / 0.19 | ✓ |
| api/calendar/create | total_ms | 93.45 | 93.95 | 0.54% | 0.07 / 0.08 | ✓ |
| api/calendar/create | calendar_ms | 93.20 | 93.60 | 0.43% | 0.07 / 0.08 | ✓ |

- 両 JSON とも `network_calls: 0`。
- 全行で「2 回の median 差 ≤ CV」なので、n=20 のまま再測はしていない。

## 2. 閾値の候補 (T-020 が使う)

タスク定義は「CV × 2」だが、JSON の CV は小数 2 桁に丸められている。chat の CV 0.01 は実際には 0.005〜0.015 の幅があり、閾値にすると 1.1〜3.2ms の違いになる。
そこで **閾値 = 2 × 標準偏差 (2 回のうち大きい方, ms)** とする。CV × 2 × median と同じ意味で、丸めの影響を受けない。

| route | 項目 | stdev A / B (ms) | **閾値 (ms)** | median 比 |
|---|---|---|---|---|
| api/chat | total_ms | 0.81 / 1.06 | **2.12** | 2.0% |
| api/chat | gemini_ms | 0.81 / 1.02 | **2.04** | 1.9% |
| api/calendar/get | total_ms | 6.11 / 6.61 | **13.22** | 42.4% |
| api/calendar/create | total_ms | 7.32 / 7.49 | **14.98** | 16.0% |

注意 (事実と推測):
- [事実] calendar の差替えは固定の 30ms 待ちなのに、p90 は 45.6ms・stdev は約 6ms。
- [推測] Windows のタイマー精度 (約 15.6ms 刻み) で、`setTimeout(30)` が 31ms か 46ms に丸められている。コードの揺れではなく実験室の条件によるもの。calendar 系の閾値が大きいのはこのため。遅延を 15.6ms の倍数に揃えるか、待ちを busy-wait に替えれば小さくできる (必要になったら M2 で)。
- [事実] 実験室の差替えは遅延が一定なので、ここのばらつきは本番よりずっと小さい。本番の chat は 3,307〜9,414ms と揺れた (M0-E2)。**この閾値は実験室の判定専用**で、現場 (M3) の判定には使わない。現場の規則は T-020 の事前登録で別に決める。
- 最初のカード (chat のストリーミング化) の指標 `first_chunk_ms` はまだ存在しない。その閾値は、ストリーミング用の差替えを作った後 (T-021 の前) に同じ方法 (2 回実行・2 × stdev) で測って事前登録する。

## 3. 計測点のオーバーヘッド

`bench/overhead.bench.ts`: 同じ処理 (空の非同期呼び出し + Response 生成) を計測点あり / なしで 5,000 回 × 5 ラウンド回し、1 回あたりの差を取った。console.log は一時ファイルへの `writeSync` で近似している。

| 回 | 1 リクエストあたりの計測点コスト (median / max) |
|---|---|
| run-a | 0.0070 / 0.0076 ms |
| run-b | 0.0068 / 0.0075 ms |

- 実験室の最小の `total_ms` (calendar/get の 31.2ms) に対して **約 0.02%**、chat (108ms) に対して約 0.007%。**1% 未満の条件を満たすので、計測点は減らさない。**
- [推測] 本番の stdout 書き出し (Vercel のログ収集) のコストは、この近似と異なる可能性がある。本番の chat は数秒単位なので、比率への影響は無視できる。

## M1 の完了条件

振る舞いテスト (T-011) + `npm run bench` (T-012) + ばらつきの測定値 (本書) が揃った。
