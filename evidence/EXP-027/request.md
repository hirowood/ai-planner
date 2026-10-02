# EXP-027 事前登録 — 新しいプロジェクトの最初の質問に、過去の傾向から選択肢を出す

Status: **登録済み (変更より前の commit)** / Date: 2026-10-01
きっかけ: 本人「新しいプロジェクトを押したときに『新しい目標を一緒に決めましょう。まず、具体的に何をしたいですか？』と出ます。選択肢のボタンも出してください。過去の傾向などを分析して作成してください」
**この文書の数値・規則は、測った後で変えない。**

## 1. 仮説と範囲

- H1: 新しい目標の最初の質問で、過去のプロジェクトの傾向の一言と、それに沿った候補のボタンが出れば、本人は最初の一歩で迷わず、続いてきた分野・つまずいた分野を踏まえた目標を選べる
- 範囲: `/api/setup/start` (過去の記録の要約を読み、Gemini に一言と候補を作らせる)・記録の要約の純粋な関数・画面 (作成モードの最初の一言と候補)
- 過去のプロジェクトが無いときは Gemini を呼ばず、決まった候補を出す

## 2. 決まり

`lib/setup-start.ts` (純粋):
- `type PastProject = { name; category; purpose; kgiTitle: string | null; kgiStatus: string | null; counts: Record<ItemStatus, number> }`
- `summarizePast(projects: PastProject[]): string` — 新しい 10 件まで・1 件 1 行「- {名前} (種類): 目的…・KGI「…」は{状態}・実行 n / 未実行 n / 棚上げ n / 失敗 n / 成功 n / 調整 n」・本人の書いた文は neutralize と 60 字で切る
- `DEFAULT_START_CHOICES = ["毎日の習慣を作りたい", "資格・試験に合格したい", "仕事の成果を上げたい", "まだ決めていない"]`
- `OPENING = "新しい目標を一緒に決めましょう。まず、具体的に何をしたいですか？"`

`lib/repo.ts`: `listPastProjects(sql, owner, limit)` — owner のプロジェクト (新しい順) と、その KGI の題と状態、階層の状態ごとの件数 (owner で絞る)

`GET /api/setup/start` → `200 { message, choices, analyzed }`
- 過去のプロジェクトが 0 件: `{ message: OPENING, choices: DEFAULT_START_CHOICES, analyzed: false }` (Gemini を呼ばない)
- 1 件以上: Gemini に要約を `<Records>` のデータとして渡し、JSON `{"trend": "傾向の一言 (60 字まで)", "choices": [...]}` を作らせる。記録に無い数字を作らない・候補は 20 字まで 2〜4 個・具体的な目標の言い方。`message` = 「{trend}\n{OPENING}」・`choices` = parseChoices (空なら DEFAULT)・`analyzed: true`
- 読めない・失敗・429 のとき: 0 件と同じ既定を返す (`analyzed: false`・429 はそのことを 1 行添える)
- `[perf]`: route `api/setup/start`・db_ms・gemini_ms・row_count (過去のプロジェクトの数)・choices_count。中身とメールは出さない

画面: 「新しいプロジェクト」を押したら、まず既定の一言と既定の候補を出し、`/api/setup/start` が返ったら一言と候補を差し替える (候補は AnswerChoices)

## 3. 実験室の判定

| 規則 | 条件 |
|---|---|
| L1 | `summarizePast`: 1 件 1 行・10 件まで・60 字で切る・`<` を全角に・KGI が無いときの書き方 |
| L2 | API: 過去 0 件 → 既定で Gemini を呼ばない・1 件以上 → プロンプトに `<Records>` と要約・返事の trend と choices・choices が空 → 既定・429 → 既定・401・全問い合わせで owner・中身とメールがログに出ない |
| L3 | `npm test` 全件成功・`tsc` 0・`next build` 成功 |

## 4. 本人の判定

| 判定 | 条件 |
|---|---|
| **定着** | 本人が最初の候補のボタンから目標づくりを 1 回以上始め、一番の困りごとに「最初に何を書けばよいか」を挙げない |
| **巻き戻し** | 傾向が記録と違う・候補が的外れ、と本人が報告した |
| **判定不能** | 14 日以内に使わない |
