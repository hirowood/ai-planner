# EXP-018 実験室の判定 — Date: 2026-10-01

**子 agent 5 本を起動したが、全員が Claude の週の使用量上限 (解除 2026-10-05) で止まった**。止まる前に `lib/smart.ts` だけが書かれていた (中身を読んで仕様どおりと確認)。残りはすべて親が直接作った (`docs/cycle-lessons.md` L-10)。

| 規則 | 確認 | 結果 |
|---|---|---|
| L1 | `lib/smart.test.ts`: 聞く順とラベル・parse (trim・無いキー・61 字・2026-02-30・オブジェクトでない)・merge (空と規則外は無視)・次の欄・ready (今日は true・昨日は false・空の欄は false)・smartToKgi | **成立** |
| L2 | 同: /api/setup の 401・400・200 (欄の重ね合わせ・next・choices・ready)・プロンプトに聞く順と今日の日付・**DB を一度も呼ばない** (偽の DB が呼ばれたら失敗)・`[perf]` fields_filled / choices_count・中身がログに出ない | **成立** |
| L3 | 同: ready でない下書きは 400 で DB を呼ばない・201 でプロジェクト・KGI (level kgi)・cycle を作る・全問い合わせに owner・中身とメールがログに出ない・401・503 | **成立** |
| L4 | 同: SmartPanel の 7 つのラベル・次の欄の aria-current・ready でなければ aria-disabled と理由・ready なら押せる・やめる | **成立** |
| L5 | `npm test` 全件合格・`tsc` 0・lint 0 errors・`next build` 成功・`/api/coach` は変えていない | **成立** |

計器の確認: 過去の期限を通す / 作成で ready の確認を外す / 作るボタンを常に押せる、の 3 つとも 1 件ずつ赤。

途中で直したこと: route のファイルから `todayJst` を export すると Next.js の build が通らない (route が export できるのは GET・POST などだけ) ので、`lib/smart.ts` に移した。

**未実施**: 安全と a11y のレビュー (子 agent が使用量上限で起動できない)。親が確かめたこと: owner はセッションのメールだけから取る・/api/setup は DB に書かない (テストで確認)・作成の 3 つの問い合わせは既存の owner で絞る関数 (createProject・createItem・saveCycle) を使う・ログはエラー名と状態 / Postgres の code だけ。上限の解除後にレビューを回す。
