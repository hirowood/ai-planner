# EXP-005 実験室の判定 — Date: 2026-09-30

| 規則 | 確認 | 結果 |
|---|---|---|
| L1 1 日の上限 | quotaId `GenerateRequestsPerDayPerProjectPerModel-FreeTier` の 429 → status 429・`kind: "quota_daily"`・`reset_at` が HH:MM で文言に入る (`route.test.ts`) | **成立** |
| L2 それ以外 | quotaId `...PerMinute...` の 429 → `kind: "quota_rate"` | **成立** |
| L3 戻る時刻 | 2026-09-30 JST 12:00 → 16:00 / 2026-12-01 JST 12:00 → 17:00 / JST 16:30 → (翌日) 16:00 (`lib/quota.test.ts`) | **成立** |
| L4 画面の文 | 429 + kind から表の文になる・本文が読めなくても 429 なら案内を出す・429 以外は null・「エラー」の語を含まない | **成立** |
| L5 壊さない | 429 の `[perf]` は 1 行・status 429・許可項目だけ。`npm test` 57 件合格・`tsc` 0・lint 0 errors (既存の 9 warnings)・`next build` 成功 | **成立** |

計器の確認 (変異): `quotaKind` の判定語を `PerDayXX` に壊すと 3 件が赤 (L1 と quotaKind の 2 件)。戻すと 57 件合格。

画面側 (`app/page.tsx`): 429 のときは `alert` を出さず、会話欄の下に `role="status"` のお知らせ (琥珀色) を出す。送れなかった発言を会話から外し、文を入力欄に戻す。次に送ったときにお知らせを消す。画面の単体テストは無い (本人のローカル確認で見る)。
