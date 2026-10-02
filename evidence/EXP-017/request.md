# EXP-017 事前登録 — プロジェクトの中の階層 (KGI → KPI → KDI → ToDo) とタスクの状態

Status: **登録済み (変更より前の commit)** / Date: 2026-09-30
仕様: `docs/product-spec.md` v2 §1 / 調査: `docs/research/onisoku-pdca.md` / 作り方: `docs/parallel-cycle-spec.md` (計画 `docs/plans/EXP-017.json`)
きっかけ: 本人「プロジェクトの中で作った階層に計画のタスクを置いてください。実行や未実行や棚上げや失敗や成功や調整など分けられるように。プロジェクトが同じであれば次に作ったタスクもその階層に作ってください」
**この文書の数値・規則は、測った後で変えない。**

## 1. 仮説と範囲

- 動かしたい指標: KGI (本人の点数)。KPI-4 (再発: 「計画が漠然」)
- H1: プロジェクトの中に KGI → KPI → KDI → ToDo の階層を持ち、タスクを 6 つの状態 (未実行・実行・棚上げ・失敗・成功・調整) で分けられれば、何が進んで何が止まっているかが見え、P・C・A が具体になる
- H2: 次に作るタスクが、前に作った場所と同じ階層に入れば、置き場所に迷わない
- 範囲: 階層の表 (`plan_items`)・API・階層の画面 (手で作る・状態を変える・期日・消す)
- 範囲外: 会話で SMART を決めてプロジェクトを作る (EXP-018)・AI が会話から階層に足す / 毎日の ToDo (EXP-019)。今の Plan の欄 (PlanFields) はそのまま残す

## 2. 部品の受け渡しの形

`lib/plan-items.ts` (純粋):

```ts
export type ItemLevel = "kgi" | "kpi" | "kdi" | "todo";
export type ItemStatus = "todo" | "done" | "shelved" | "failed" | "succeeded" | "adjusted";
export const LEVEL_LABEL: Record<ItemLevel, string>;   // KGI (ゴール) / KPI (途中の指標) / KDI (行動の目標) / ToDo
export const STATUS_LABEL: Record<ItemStatus, string>; // 未実行 / 実行 / 棚上げ / 失敗 / 成功 / 調整
export const STATUS_ORDER: ItemStatus[];               // todo, done, shelved, failed, succeeded, adjusted
export const CHILD_LEVEL: Record<ItemLevel, ItemLevel | null>; // kgi→kpi, kpi→kdi, kdi→todo, todo→null
export type PlanItem = { id: string; projectId: string; parentId: string | null; level: ItemLevel; title: string; target: string; dueDate: string; status: ItemStatus; createdAt: string; updatedAt: string };
export type ItemInput = { projectId: string; parentId: string | null; level: ItemLevel; title: string; target: string; dueDate: string; status: ItemStatus };
export type ItemPatch = Partial<Pick<PlanItem, "title" | "target" | "dueDate" | "status">>;
export type TreeNode = PlanItem & { children: TreeNode[] };
export function parseItemInput(x: unknown): ItemInput | null; // title 1〜200 字 (trim)・target 0〜200・dueDate は実在する YYYY-MM-DD か ""・level と status は決まった値 (status 既定 todo)・kgi は parentId が null・kgi 以外は parentId が UUID
export function parseItemPatch(x: unknown): ItemPatch | null;  // 1 つ以上の項目があり、どれも上と同じ検査に通る
export function buildTree(items: PlanItem[]): TreeNode[];      // 親子に組む・親が見つからない項目は一番上に・同じ親の中は createdAt の古い順
export function statusCounts(items: PlanItem[]): Record<ItemStatus, number>;
export function nextParentFor(items: PlanItem[], lastParentId: string | null): PlanItem | null; // 前に使った親が今もあればそれ (同じ階層に作る)・無ければ null
```

表 `plan_items`: id・owner・project_id (projects を on delete cascade)・parent_id (plan_items を on delete cascade・null 可)・level・title・target・due_date (date・null 可)・status・created_at・updated_at。索引 (owner, project_id)。

`lib/repo.ts` に足す (owner で絞る):
- `listItems(sql, owner, projectId): Promise<PlanItem[]>`
- `createItem(sql, owner, input): Promise<PlanItem | null>` — プロジェクトが owner のもの (しまっていない)・親があれば同じプロジェクトで owner のもの・親の level の `CHILD_LEVEL` が input.level と一致、のときだけ作る (違えば null)
- `updateItem(sql, owner, id, patch): Promise<PlanItem | null>` — owner のものだけ・updated_at を今に
- `deleteItem(sql, owner, id): Promise<boolean>` — 子も消える (on delete cascade)

API:

| 経路 | 成功 | 失敗 |
|---|---|---|
| `GET /api/items?projectId=` | 200 `{ items }` | 400 / 401 / 503 |
| `POST /api/items` (ItemInput) | 201 `{ item }` | 400 / 401 / 404 (プロジェクト・親が他人・無い・親の段が合わない) / 503 |
| `PATCH /api/items/[id]` (ItemPatch) | 200 `{ item }` | 400 / 401 / 404 / 503 |
| `DELETE /api/items/[id]` | 204 | 400 / 401 / 404 / 503 |

`[perf]`: `db_ms`・`row_count`。タイトル・目標値・メールはログに出さない。

画面 (`app/components/PlanTree.tsx` と page の配線):
- `export function PlanTree(props: { items: PlanItem[]; lastParentId: string | null; onCreate(input: ItemInput): void; onUpdate(id: string, patch: ItemPatch): void; onDelete(id: string): void; onLastParentChange(id: string | null): void })`
- 階層を字下げで表示 (KGI → KPI → KDI → ToDo)。各行に段の名前・タイトル・目標値・期日・状態の選択 (6 つ)・「＋ 下に足す」(子の段で追加・KGI が無ければ「＋ KGI を作る」)・消す (2 回押し)
- 追加欄: 親を選べる (既定は `nextParentFor` = 前に足した親 = 同じ階層)・タイトル・目標値・期日。追加すると `onLastParentChange(親の id)`
- 状態の絞り込み (すべて / 6 つ) と、状態ごとの件数
- `export function useItems(projectId: string | null)` (同じファイル): 読み込み・追加・更新・削除 (API を呼ぶ)・lastParentId を端末の localStorage (`ai-planner:lastParent:<projectId>`・try/catch) に覚える
- page: 「📝 Plan」タブの上段に PlanTree、下段に今までの PlanFields (見出し「Plan の要点」)

## 3. 実験室の判定

| 規則 | 条件 |
|---|---|
| L1 | `parseItemInput` / `parseItemPatch`: 正しい値を通す・空のタイトル・201 字・知らない段と状態・kgi に親・kpi に親なし・UUID でない親・実在しない日付 → null・状態の既定は todo |
| L2 | `buildTree`: 4 段が親子に組まれる・親の無い項目は一番上・同じ親は古い順。`statusCounts`・`nextParentFor` (前の親が消えていれば null) |
| L3 | repo: 全問い合わせで owner が絞り込み・他人のプロジェクト / 他人の親 / 段が合わない親への作成は null・他人の項目の更新と削除は null / false |
| L4 | API: 表のとおりの status・`[perf]` 1 行・許可項目だけ・中身とメールがログに出ない |
| L5 | 画面: 段の名前・6 つの状態の選択にラベル・「＋ 下に足す」・追加欄の親の既定が前に足した親・状態の件数 |
| L6 | `npm test` 全件成功・`tsc` 0・lint 0 errors・`next build` 成功・会話のプロンプトの差分 0 行 |
| L7 | 本物の Neon で移行 (plan_items) → 階層を作って読み込み直すと残る (本人) |

## 4. 本人の判定

| 判定 | 条件 |
|---|---|
| **定着** | 本人が 1 つのプロジェクトに 3 段以上の階層を作り、状態を 1 回以上変え、一番の困りごとに「タスクの置き場所」「状態が分けられない」を挙げない |
| **巻き戻し** | 階層が使いにくい・消える・他のプロジェクトと混ざる、と本人が報告した (Human Gate) |
| **判定不能** | 14 日以内に使わない |
