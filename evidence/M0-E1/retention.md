# M0-E1 実行ログの保持期間 (T-003) — 途中経過

Status: **t=0 記録済み / 1h・6h・24h の確認待ち**
Preview: `dpl_Bv7gsMP9Xk7yzBdBDR8QwaLKre6M` (branch `perf/loop-1`, commit `a9ed90f`, target=preview)

## 送信

Preview は Vercel Authentication (ssoProtection: all_except_custom_domains) で保護されている。
`web_fetch_vercel_url` は SSO への 302 で止まったので、`get_access_to_vercel_url` の一時共有リンク
(23 時間有効・値は記録しない) で cookie を得て、curl で送った。

未ログインの `GET /api/calendar/get` を 5 回 (401 経路。本番・本人のデータに触れない):

| 送信 (UTC) | 応答 | Server-Timing |
|---|---|---|
| 2026-09-29T13:29:35Z | 401 | total;dur=9.3, calendar;dur=0 |
| 2026-09-29T13:29:37Z | 401 | total;dur=0.9, calendar;dur=0 |
| 2026-09-29T13:29:38Z | 401 | total;dur=0.8, calendar;dur=0 |
| 2026-09-29T13:29:40Z | 401 | total;dur=0.9, calendar;dur=0 |
| 2026-09-29T13:29:41Z | 401 | total;dur=1.1, calendar;dur=0 |

初回の 9.3ms は [推測] コールドスタート。

## 残っていた件数

`get_runtime_logs` (environment=preview, query=`[perf]`)

| 確認時刻 (UTC) | 送信からの経過 | 残っていた `[perf]` 行 |
|---|---|---|
| 2026-09-29T13:29:51Z | ~0 分 | **5 / 5** |
| 予定 2026-09-29T14:29Z | 1h | 未確認 |
| 予定 2026-09-29T19:29Z | 6h | 未確認 |
| 予定 2026-09-30T13:29Z | 24h | 未確認 |

取得した 5 行はすべて `{"route","status","total_ms","calendar_ms"}` だけで、5 項目以外の値は無かった (t=0 で確認)。

## 結論

未確定。1h 時点で 0 件なら tasks.md のゲート B-001 (回収方式が成立しない → 外部保存の再検討) に当たる。
