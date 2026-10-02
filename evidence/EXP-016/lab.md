# EXP-016 実験室の判定 — Date: 2026-09-30

4 回目の並列サイクル (計画と実績: `docs/plans/EXP-016.json`)。TST・LIB・SRV・UIF・UIC の 5 本を同時に始め (12:57)、レビューは実装が終わった担当の分から順に起動した。**RUN の後、間を空けずに MUT を回した** (EXP-009 は 10 分空いた)。子は git を一度も使わなかった (報告で確認)。

| 規則 | 確認 | 結果 |
|---|---|---|
| L1 | `lib/coach-context.test.ts` (19 件): ノート 25 → 20・301 → 300 字・過去の周 5 → 3・各欄 201 → 200 字・絵文字 1 字・`<script>` → `＜script＞`・(まだ無し)・日付と種類・`recordCounts` | **成立** |
| L2 | `app/api/coach/route.test.ts` (18 件): 401・400・404 (他人・無い)・200・記録を DB から読み `<Records>` に入れる・画面から送った偽の記録は使わない・会話 2 件と Plan を保存・429 quota_daily・ノートの `</Records>` は全角になる | **成立** |
| L3 | 同 (4 件): `[perf]` 1 行・許可項目だけ・context_notes / context_cycles・中身とメールがログに出ない | **成立** |
| L4 | 同 (4 件): `[[time]]` を取り除いて timePrompted・`via: time_dialog` で time_dialog_used | **成立** |
| L5 | `PlanFields.test.tsx` (17 件): 6 つのラベル・aria-current="step"・role="status"・会話の入力欄と送信・反映ボタンが無い | **成立** |
| L6 | `npm test` 418 件合格・`tsc` 0・lint 0 errors (10 warnings・前と同じ)・`next build` 成功 | **成立** |

## 計器の確認

| 壊した箇所 | 赤 |
|---|---|
| M1 ノートの件数の上限 20 を外す | 4 |
| M2 ノートの字数の上限 300 を外す | 3 |
| M3 過去の周の件数の上限 3 を外す | 4 |
| M4 neutralize を外す (`<` `>` をそのまま) | 5 |
| M5 getProject から owner を外す | 1 |
| M6 返事から `[[time]]` を取り除かない | 1 |
| M7 記録をプロンプトに入れない | 2 |

7 つとも赤。戻して 418 件合格。

## レビュー

- 安全: blocking 0。warn → 直した: 会話履歴 1 件の字数を 2000 字で切る・ノートを DB で 20 件だけ読む (`listNotes` に任意の limit)・返事の長さの上限 (maxOutputTokens 1024)。提案「記録に無い数字をサーバで照らし合わせる」→ H-26
- a11y: blocking 3 (新しい返事が読み上げられない・送信後にフォーカスが消える・「考え中...」の文字が薄い) → 直した。warn → 直した: 処理中を常設の status で・AI の返事で変わった Plan の欄を読み上げる・入力欄のラベル・旧チャットの alert() をお知らせに・文字の欄の上限の案内。残す: タブの矢印キー (H-15)
- 片付け: 使われなくなった `PlanPanel.tsx` とそのテスト 2 つ (EXP-009・010 の画面) を消した。Plan の会話は `/api/coach` に、欄は `PlanFields` に移った (EXP-009 L6・EXP-010 L4 のテストは、EXP-016 の L5 と route のテストが置き換える)
- 気になる点: `app/page.tsx` 約 560 行・`PlanFields.tsx` 約 410 行・`route.test.ts` 約 460 行 (目安 300 行)
