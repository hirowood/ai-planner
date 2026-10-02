# EXP-020 事前登録 — 1 日の記録 (今日の ToDo・〇△×・良かったこと 3 つ・明日はこうする)

Status: **登録済み (変更より前の commit)** / Date: 2026-10-01
仕様: `docs/product-spec.md` v2 (毎日 3 つ) / 参考: ほぼ日手帳の PDCA の使い方 (note.com/hakadoru_techo/n/n7789d57a5247)・NOLTY ビジネスベーシックダイアリー (nolty.jp/bbd/)
きっかけ: 本人「次のように計画を立てながら PDCA を継続的に回したい」(上の 2 つ)。本人の選択: 振り返りは **毎日 + 週末**・最初は **1 日の記録から** (週末の Check・Action 欄は次のカード)
**この文書の数値・規則は、測った後で変えない。**

## 1. 仮説と範囲

- H1: プロジェクトに「今日」の欄があり、朝に今日の ToDo を見て、夜に〇△×・良かったこと 3 つ・明日はこうする を 1 分で書けて、AI がその記録を読んで話せば、本人は毎日 PDCA の Check と Action を回せる
- 範囲: daily_logs 表・`/api/daily` (読む・書く)・「☀️ 今日」タブ (今日が期日の ToDo と状態・その日の振り返り・最近 7 日)・AI の記録に最近 7 日の記録を足す
- 範囲外: 週末の Check・Action 欄 / 4 象限 (次のカード)・月の振り返り・ToDo ごとの〇△× (状態は今ある 6 つを使う)・通知

## 2. 決まり

データ (`db/schema.sql`): `daily_logs` (id・owner・project_id → projects 消したら消える・day date・mark text (good / fair / bad = 〇 / △ / ×)・goods jsonb (文字列の配列)・tomorrow text・created_at・updated_at)・(owner, project_id, day) で 1 日 1 件

`lib/daily.ts` (純粋):
- `parseDailyInput(x, today)`: projectId は UUID・day は実在の日付で **今日から 7 日前まで** (未来は不可)・mark は good / fair / bad・goods は 3 個まで、各 1〜100 字 (空は落とす)・tomorrow 0〜200 字・余計な項目は落とす・通らなければ null
- `MARK_LABEL` = 〇 できた / △ 少し / × できなかった
- `todayTodos(items, today)`: level が todo で期日が今日の項目 (古い順)
- `dailyText(logs)`: AI に渡す要約 (新しい順 7 日まで・1 行 = 日付・〇△×・良かったこと・明日・neutralize・各 100 字で切る)・無ければ「(まだ無し)」

`/api/daily`:
- GET `?projectId=` → 持ち主の最近 7 件 (新しい順)・`[perf]` に row_count
- PUT → 持ち主のプロジェクト (しまっていない) のときだけ 1 日 1 件を作るか上書き・他人・無い → 404・不正 → 400・`[perf]` に fields_filled (mark・goods の数・tomorrow の有無の合計 0〜5)
- 中身・メールはログに出さない

画面 (`app/components/DailyPanel.tsx`・プロジェクトの最初のタブ「☀️ 今日」・既定のタブにする):
- 今日の ToDo: 期日が今日の ToDo と状態の選択 (今ある 6 つ)。3 つを超えたら「3 つに絞ると回しやすいです」。無ければ「会話で KDI から今日の ToDo を決めましょう」と、会話に送るボタン「今日の ToDo を 3 つ決めたい」
- 今日の振り返り: 〇△× (fieldset と legend のラジオ)・良かったこと 3 つ・明日はこうする・保存 (今日の記録があれば入れておく)
- 保存したら「今日の記録を保存しました」と、会話に送るボタン「AI にひとことをもらう」
- 最近 7 日: 日付・〇△×・良かったことの数

`/api/coach`: 記録に最近 7 日の記録 (`dailyText`) を「#### 毎日の記録」として `<Records>` に入れる・`[perf]` に context_days (数だけ)。指示の文は変えない (記録を足すだけ)

## 3. 実験室の判定

| 規則 | 条件 |
|---|---|
| L1 | `parseDailyInput`: 今日・7 日前は通る / 8 日前・明日・実在しない日付・mark 違い・goods 4 個目は落とす (3 個まで)・101 字・tomorrow 201 字は弾く・余計な項目は落ちる |
| L2 | `todayTodos`・`dailyText` (7 件まで・新しい順・`</Records>` は全角・無ければ「(まだ無し)」) |
| L3 | `/api/daily`: 401・400・他人 404・PUT は upsert (insert … on conflict) で owner をパラメータで渡す・GET は owner と projectId で絞る・`[perf]` 1 行で許可項目だけ・中身とメールがログに無い |
| L4 | `/api/coach`: プロンプトの `<Records>` の中に毎日の記録・context_days |
| L5 | `DailyPanel` の描画: 今日のタブが既定・〇△× は fieldset と legend・ToDo が無い / 4 つのときの案内・保存後のボタン |
| L6 | `npm test` 全件成功・`tsc` 0・`next build` 成功 |

## 4. 本人の判定

| 判定 | 条件 |
|---|---|
| **定着** | 本人が 7 日のうち 4 日以上その日の記録を保存する (daily_logs の行数で数える・中身は見ない)、かつ一番の困りごとに「毎日の記録が面倒」を挙げない |
| **巻き戻し** | 記録が消える・別のプロジェクトに入る、と本人が報告した (Human Gate) |
| **判定不能** | 14 日以内に使わない |

## 5. 注意

- EXP-019 (プロンプトの階層の節) はまだ本人が使っていない。本カードはプロンプトに記録を足すだけで指示は変えない。EXP-019 の判定は `items_added` で数えるので分けて判定できる
- 移行 (`daily_logs`) は本人が `node --env-file=.env.local scripts/db-migrate.mjs` を実行する
