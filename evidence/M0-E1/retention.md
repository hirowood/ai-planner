# M0-E1 実行ログの保持期間 (T-003) — 途中経過

Status: **確定 — 保持期間は 61 分以下 (約 1 時間)。ゲート B-001 の境界。本人に相談**
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
| 2026-09-29T14:27Z 頃 | ~58 分 | 取得失敗 (Vercel コネクタの認証エラー `permission_error`。本人が `/mcp` で再接続) |
| 2026-09-29T14:30:40Z | ~61 分 | **0 / 5** (deployment 指定・絶対時刻) |
| 2026-09-29T14:30:54Z | ~61 分 | **0 / 5** (t=0 と同じ形: deployment 指定なし・`since=2h`) |

陽性対照 (問い合わせ自体が効いていることの確認):
- 14:31:25Z / 14:31:27Z に最新の Preview (`dpl_HkYDk23PvJoax8obbzd4epRG7f9H`) へ未ログインで 2 回送った
- 14:31:35Z の同じ問い合わせで 1 行 (14:31:24 の分) がすぐ見えた。もう 1 行は反映待ちと見られる
- よって、0 件は「問い合わせの誤り」ではなく「ログが消えた」ことを示す

取得した行は、t=0 の 5 行・対照の 1 行とも `{"route","status","total_ms","calendar_ms"}` だけで、5 項目以外の値は無かった。

6h・24h の確認は、1h の時点で既に消えているので行わない。

## 結論

- [事実] 実行ログの保持期間は **16 秒より長く、61 分以下**。58 分時点の値はコネクタ障害で欠けた。
- [推測・外部知識] Hobby プランの保持期間は 1 時間とされており、13:29:35〜41 の行が 14:30:40 に無かったことと矛盾しない。
- **ゲート B-001 に当たる (境界)。** 「使った直後に回収」は、本人が使い終えてから約 1 時間以内に Claude が回収できたときだけ成立する。1 時間を過ぎると、その回の計測は失われる。
- M3 の回収方式は本人に相談して決める (tasks.md B-001 の手順)。
