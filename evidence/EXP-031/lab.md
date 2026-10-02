# EXP-031 実験室の結果 — KDI を 3 つほど・毎日 KDI ごとに今日の ToDo を 3 つほど (1 日 9 つほど)・判定基準つき

Date: 2026-10-02 / 事前登録: `request.md` (変更より前に commit 3ae7054)

## 変更

- `lib/hierarchy-step.ts`: `KDI_TARGET = 3`・`TODO_PER_KDI = 3`。`nextHierarchyStep(items, today)` は KDI (棚上げは数えない) が 3 つ未満なら KDI の少ない KPI の下に kdi・そろったら古い KDI から今日の ToDo が 3 つ未満の KDI に todo (`today`・`have`)。`parseProposedItems` は今日の ToDo の期日を今日にそろえ (空なら今日・今日でなければ捨てる)・`3 - have` まで。要約の target は「判定基準」
- `app/api/coach/route.ts`: KDI と今日の ToDo の決め方の文 (全部で 3 つほど・今日 3 つほど (1 日 9 つほど)・前の日の記録・進み具合・期限・判定基準を target に)・今日の数と残りの数・出力の target を「判定基準」と説明
- `lib/daily.ts`: `TODAY_TODO_TARGET` 3 → 9 (本人の言葉で EXP-020 の目安を置き換え)
- `app/components/DailyPanel.tsx`: 今日の ToDo を KDI ごとにまとめる (`groupByKdi`)・「判定基準: …」・目安の文・9 つ未満なら会話に送るボタン (文は「今日の ToDo を KDI ごとに 3 つずつ決めたい」)・9 つを超えたら案内
- `app/components/PlanTree.tsx`: 追加欄の「目標値」→「目標値・判定基準」

## 判定 (事前登録の規則)

| 規則 | 結果 | 根拠 |
|---|---|---|
| L1 | 成立 | `lib/hierarchy-step.test.ts` nextHierarchyStep 9 件 (KDI 0 / 1 / 2 → kdi で KDI の少ない KPI・棚上げは数えない・KDI 3 で今日 0 → todo (have 0)・別の日の ToDo は数えない・今日 2 → 同じ KDI (have 2)・3 → 次の KDI・9 つ → null) |
| L2 | 成立 | 同 今日の ToDo 2 件 (空 → 今日・明日は捨てる・判定基準が入る・have 2 → 1 つまで・have 3 → 0) |
| L3 | 成立 | `lib/hierarchy-coach.test.ts` プロンプトに「今日 3 つほど (1 日 9 つほど)」「判定基準 (何をもって達成か)」「今日 (日付) の ToDo」「今 0 つ・あと 3 つ」・KDI の段に「全部で 3 つほど」・今日の期日・判定基準つきで最初の KDI の下に作り、明日の分は作らない |
| L4 | 成立 | `app/components/DailyPanel.test.tsx` KDI の古い順の見出し (h4) の下に ToDo・「判定基準: …」・10 で案内・9 で出さない・9 未満でボタン・目安の文 |
| L5 | 成立 | `npm test` 52 ファイル 695 件合格 (688 → 695)・`tsc` 0・eslint 0 errors / 10 warnings (前と同じ)・`next build` 成功 |

## わざと壊して赤になるか (10/10)

M1 KDI を 3 つ待たない・M2 棚上げの KDI も数える・M3 別の日の ToDo も数える・M4 KDI の少ない KPI を選ばない・M5 明日の ToDo を捨てない・M6 空の期日を今日にしない・M7 have を引かない・M8 目安を 3 のまま・M9 判定基準を出さない・M10 プロンプトに今日の数を入れない → すべて赤

## 置き換えたテスト

- EXP-019 の「ToDo の無い KDI → todo」「全部ある → null」は、本カードの規則 (KDI 3 つ・今日の ToDo) に合わせて書き直した (古い規則は本人の言葉で置き換え)
- EXP-020 の「4 つで『3 つに絞ると』」は「10 で『9 つほどに絞ると』」に置き換えた

## 残り

- 本物の Gemini が「決めたときだけ・今日の期日で」を守るかは本人の利用で見る
- 1 回の返事で足せるのは 1 つの KDI の分だけ (9 つそろえるには KDI ごとに会話が進む)
- KPI の仮置き・見直しを AI がする / 週末の判定と調整は次のカード
- 安全と a11y のレビューは子 agent の上限解除 (2026-10-05) 後
