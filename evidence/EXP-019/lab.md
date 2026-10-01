# EXP-019 実験室の結果 — 会話が KPI → KDI → ToDo の順に誘導し、決まったら AI が階層に足す

Date: 2026-10-01 / 事前登録: `request.md` (変更より前に commit 1c5157e)

## 変更

- `lib/hierarchy-step.ts` (新規・純粋): `nextHierarchyStep`・`hierarchyText`・`parseProposedItems`・`itemsAddedNotice`
- `app/api/coach/route.ts`: 階層を `listItems` で読み `<Records>` に要約を入れる・「### 階層の次に決める段」(段ごとの決め方と「決めたときだけ items」)・約束 4 を「階層の次の段を先に」・出力 JSON に `items`・サーバが段と親を決めて `createItem`・返事に `itemsAdded`
- `lib/perf.ts`: `items_added` (数だけ)
- `app/components/PlanTree.tsx`: `useItems` に `refresh()`
- `app/page.tsx`: `itemsAdded` があれば階層を読み直し、「階層に KPI『…』を足しました」

## 判定 (事前登録の規則)

| 規則 | 結果 | 根拠 |
|---|---|---|
| L1 | 成立 | `lib/hierarchy-step.test.ts` nextHierarchyStep 6 件 (KGI 無し・KPI 無し・KDI 無し (古い順で最初)・2 つ目の KPI・ToDo 無し・全部ある) |
| L2 | 成立 | 同 hierarchyText 3 件 (字下げ・全角化・60 字・40 行)・parseProposedItems 5 件 (段と親はサーバ・3 件まで・空/201 字/実在しない日付は捨てる・200 字は通る・kgi / null / 配列でない → []) |
| L3 | 成立 | `lib/hierarchy-coach.test.ts` 6 件 (プロンプトに階層と次の段・KGI の下に KPI として insert (値に KGI の id と "kpi"・AI の親 id は入らない)・KPI の下に KDI・items 無しは作らない・KGI 無しは作らず新しいプロジェクトを勧める・DB が断ったものは数えない)・`items_added`・中身とメールはログに無い |
| L4 | 成立 | `npm test` 46 ファイル 638 件合格 (616 → 638)・`tsc` 0・eslint 0 errors / 10 warnings (前と同じ)・`next build` 成功 |

## わざと壊して赤になるか (8/8)

| 壊し方 | 結果 |
|---|---|
| M1 AI の言う親を使う | 赤 |
| M2 古い順に並べない | 赤 |
| M3 階層の要約を neutralize しない | 赤 |
| M4 3 件で切らない | 赤 |
| M5 DB が断ったものも数える | 赤 |
| M6 次の段をプロンプトに入れない | 赤 |
| M7 KGI の段でも作る | 赤 |
| M8 items_added を出さない | 赤 |

## 残り

- 本物の Gemini が「決まったときだけ items に入れる」を守るかは、本人の利用でしか分からない (巻き戻しの条件: 決めていないのに足される)
- 安全と a11y のレビューは子 agent の上限解除 (2026-10-05) 後
- KPI の調整を AI が行うこと・毎日の ToDo の画面は後のカード
