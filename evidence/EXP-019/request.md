# EXP-019 事前登録 — プロジェクトの会話が KPI → KDI → ToDo の順に誘導し、決まったら AI が階層に足す

Status: **登録済み (変更より前の commit)** / Date: 2026-10-01
仕様: `docs/product-spec.md` v2 / 調査: `docs/research/onisoku-pdca.md`
きっかけ: 本人「SMART で KGI を設定する。次に KPI を設定する (期限までに達成するために調整する)。KPI を達成するために KDI を設定する。KDI から具体的に ToDo を設定する。このようにして PDCA を回していく計画的な改善行動をとる」
**この文書の数値・規則は、測った後で変えない。**

## 1. 仮説と範囲

- H1: 会話が階層の「次の段」(KGI の下に KPI → KPI の下に KDI → KDI の下に ToDo) を 1 つずつ聞き、候補を出し、本人が決めたら AI がその段に足せば、本人は手で階層を組まなくても KGI から ToDo まで具体になる
- 範囲: 次の段を決める純粋な関数・階層の要約を AI に渡す・`/api/coach` が決まった項目を階層に足す・画面が足した項目を読み直して知らせる
- 範囲外: KPI の調整 (更新) を AI が行う (後のカード・今は本人が手で直す)・毎日の ToDo の画面 (後のカード)・KGI は AI が作らない (EXP-018 の会話で作る)

## 2. 決まり

`lib/hierarchy-step.ts` (純粋):
- `nextHierarchyStep(items)`: KGI が無い → `{ level: "kgi" }`・KGI の下に KPI が無い → `{ level: "kpi", parent: KGI }`・KDI の無い KPI (古い順で最初) → `{ level: "kdi", parent: KPI }`・ToDo の無い KDI (古い順で最初) → `{ level: "todo", parent: KDI }`・すべてある → `null`
- `hierarchyText(items)`: 字下げした 1 行ずつ (段・題・目標値・期日・状態)・題は 60 字で切る・neutralize・40 件まで・無ければ「(まだ無し)」
- `parseProposedItems(x, step, projectId)`: 配列でなければ []・3 件まで・各 `{ title, target?, dueDate? }` を、段 = step.level・親 = step.parent として `parseItemInput` で検査 (通らないものは捨てる)・step が kgi か null なら []

`/api/coach`:
- 記録に階層 (`listItems`) を足し、プロンプトに「### 階層 (KGI → KPI → KDI → ToDo)」と「### 次に決める段」を入れる
- 次の段の約束: KPI は「期限までに KGI を達成できているかを途中で測る数 (数と期日)」・KDI は「KPI を達成するための行動の量・頻度」・ToDo は「KDI から落とした具体的な作業 (日付つき)」。候補を 2〜3 個 choices に・**本人が決めた (選んだ・同意した) ときだけ** "items" に入れる・KGI は足さない
- 出力の JSON に `"items": [{ "title", "target", "dueDate" }]` を足す。サーバが `parseProposedItems` で検査し、`createItem` で足す (親と段はサーバが決める・AI の言う親は使わない)
- 返事に `itemsAdded: [{ level, title }]`・`[perf]` に `items_added` (数だけ)
- 次の段が KGI (KGI が無い) のときは「新しいプロジェクトから KGI を作りましょう」と案内する

画面: 返事に `itemsAdded` があれば階層を読み直し、status に「階層に KPI『…』を足しました」

## 3. 実験室の判定

| 規則 | 条件 |
|---|---|
| L1 | `nextHierarchyStep`: 5 つの場合 (KGI 無し・KPI 無し・KDI 無し・ToDo 無し・全部ある)・古い順で最初 |
| L2 | `hierarchyText`・`parseProposedItems` (3 件まで・段と親はサーバ・空の題・201 字・実在しない日付は捨てる・kgi / null は []) |
| L3 | `/api/coach`: プロンプトに階層と次の段・AI の items が次の段の親の下に作られる (insert into plan_items の値に親の id と段)・itemsAdded・`items_added`・items が無ければ作らない・中身とメールがログに出ない |
| L4 | `npm test` 全件成功・`tsc` 0・`next build` 成功 |

## 4. 本人の判定

| 判定 | 条件 |
|---|---|
| **定着** | 本人の会話で KPI・KDI・ToDo が 1 つ以上ずつ階層に足され (`items_added`)、一番の困りごとに「階層を作るのが大変」「どこに何を置くか」を挙げない |
| **巻き戻し** | 決めていないのに足される・違う所に足される、と本人が報告した (Human Gate) |
| **判定不能** | 14 日以内に使わない |
