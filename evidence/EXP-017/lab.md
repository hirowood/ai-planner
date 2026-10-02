# EXP-017 実験室の判定 — Date: 2026-09-30

5 本同時 (13:20)。子は git を使わなかった。

| 規則 | 確認 | 結果 |
|---|---|---|
| L1 | `lib/plan-items.test.ts`: 入力の検査 (空・201 字・知らない段と状態・kgi に親・kpi に親なし・UUID でない親・実在しない日付・既定 todo)・更新の検査 | **成立** |
| L2 | 同: `buildTree` (4 段・親の無い項目は一番上・古い順・輪は一番上)・`statusCounts`・`nextParentFor` | **成立** |
| L3 | `lib/repo-items.test.ts`: 全問い合わせで owner・他人のプロジェクト / 他人・無い親 / 別プロジェクトの親 / 段が合わない親は null | **成立** |
| L4 | `app/api/items/route.test.ts`: GET/POST/PATCH/DELETE の status・`[perf]` 1 行・許可項目だけ・中身とメールがログに出ない | **成立** |
| L5 | `PlanTree.test.tsx`: 段の名前・6 つの状態の選択・「＋ 下に足す」・件数・親の既定 = 前に足した親・空で「＋ KGI を作る」 | **成立** |
| L6 | `npm test` 全件合格・`tsc` 0・lint 0 errors・`next build` 成功・会話のプロンプトは EXP-017 では変えていない | **成立** |
| L7 | 本物の Neon で移行と保存 | **未実施** (本人) |

## 計器の確認

| 壊した箇所 | 赤 |
|---|---|
| listItems から owner | 4 |
| createItem のプロジェクトの確認から owner | 2 |
| createItem の親の確認から level | 4 |
| updateItem から owner | 4 |
| deleteItem から owner | 4 |
| CHILD_LEVEL の kpi → todo | 8 |
| **createItem の親の確認から owner** | **0 (穴)** |

最後の 1 つ: 親の確認は「同じプロジェクト (project_id)」と「プロジェクトが owner のもの」を同じ問い合わせで確かめているので、owner を外しても他人の親は通らない (同じプロジェクトの項目は作るときに必ず owner が同じ)。**重なる予備の守りで、実際の穴ではないと判断**。ただしテストはこの予備の守りを確かめていない (記録として残す)。

## レビュー

- 安全: blocking 0。warn: 1 プロジェクトの項目数に上限が無い (本人のデータだけ・後で 500 件程度の上限) → H-27。low: level / status に DB の check 制約が無い (アプリで検査)・親が消えた瞬間の作成は 500 (漏れは無し)
- a11y: blocking 0。warn → 直した: 絞り込み中に状態を変えたときのフォーカス・「＋ 下に足す」の名前を表示の文字から始める・行ごとの操作の名前 (「『X』の状態」など)・足したことの読み上げとフォーカス・入力エラーと欄の結び付け・名前の効かない aria-labelledby・「すべて: N 件」
- 気になる点: `PlanTree.tsx` 約 590 行・`lib/repo.ts` 約 390 行 (目安 300 行)
