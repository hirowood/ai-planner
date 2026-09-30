# EXP-006 ローカル確認 — Date: 2026-09-30

開発サーバ (branch `ux/exp-006-time-dialog` @ 9ab0ce9)。`[perf]` 行だけ (本文は記録しない)。

| 往復 | history_len | question_count | time_prompted | time_dialog_used | plan_proposed | first_chunk_ms |
|---|---|---|---|---|---|---|
| 1 | 0 | 1 | false | — | false | 4789.9 |
| 2 | 2 | 2 | false | — | false | 1477.4 |
| 3 | 4 | 1 | **true** | — | false | 829.1 |
| 4 | 6 | 1 | false | **true** | false | 1782.7 |
| 5 | 8 | 1 | false | — | false | 5794.4 |
| 6 | 10 | 3 | false | — | false | 1624.1 |
| 7 | 12 | 1 | false | — | false | 7232.2 |
| 8 | 14 | 2 | false | — | false | 1361.5 |
| 9 | 16 | 1 | **true** | — | false | 1490.1 |
| 10 | 18 | 1 | false | **true** | false | 7714.4 |
| 11 | 20 | 2 | false | — | false | 1427.7 |
| 12 | 22 | 5 | false | — | false | 2182.0 |
| 13 | 24 | 0 | false | — | **true** | 1220.2 |

その後 `api/calendar/create` 200 (登録できた)。

## 観察 (事実)

- 入力画面の目印は 2 回付き (往復 3・9)、2 回とも次のメッセージが入力画面から送られた (往復 4・10)
- 予定案まで **13 往復** (基準値: 本番 4・ローカル 6)。予定案の登録まで届いた
- 予定案以外の返答 12 件の `question_count` の中央値は 1 (1 が 7 件・2 が 3 件・3 と 5 が 1 件ずつ)。「？」が複数でも質問が複数とは限らない (例示・確認の言い回しも数える)
- 本人の点数・一番困ったことは未回答

## 判定への影響

- EXP-006: 本人判定の機械の 2 条件 (`time_prompted` = true が 1 回以上・`time_dialog_used` = true) はローカルで成立。本人の声が未回答。判定は request.md §4 どおり本番の利用で行う
- EXP-004: 保留だった「予定案まで届くか」はローカルでは届いた。判定は本番の利用で行う (規則のまま)
- 往復数の増加 (6 → 13) は EXP-004 の request.md で予想した副作用 (判定には使わない)。本人の声しだいで新しい仮説にする
