# EXP-014 判定 — 不採用 (Date: 2026-09-30)

ローカルの利用で `/api/chat` と `/api/plan/chat` が 500。Gemini の返事は `404 NOT_FOUND "This model models/gemini-2.5-flash-lite is no longer available to new users"`。
モデルの一覧 (ListModels) には名前が載っていたが、呼ぶと 404 だった。**事前に実際に呼んで確かめずにモデル名を決めた親の誤り** (一覧に載っている ≠ 使える)。

候補を 1 回ずつ実際に呼んだ結果 (本人の実行・状態と時間だけ):

| モデル | 結果 |
|---|---|
| gemini-2.5-flash-lite | 404 (新しい利用者には提供終了) |
| gemini-flash-lite-latest | 200・775 ms (別名なので中身が替わりうる) |
| gemini-3.1-flash-lite | 200・1604 ms |
| gemini-3.5-flash-lite | 200・846 ms |
| gemini-2.5-flash | 429 (今日の枠を使い切り) |

→ 規則 L1 の値そのものが使えないので **不採用**。`gemini-3.5-flash-lite` を EXP-015 として登録し直す。
教訓: モデル名を替えるときは、一覧ではなく「実際に 1 回呼んで 200」を確かめてから決める (`docs/cycle-lessons.md`)。
