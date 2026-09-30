# EXP-018 事前登録 — 新しいプロジェクトを、会話で SMART を決めて作る (KGI になる)

Status: **登録済み (変更より前の commit)** / Date: 2026-09-30
仕様: `docs/product-spec.md` v2 / 作り方: `docs/parallel-cycle-spec.md` (計画 `docs/plans/EXP-018.json`)
きっかけ: 本人「プロジェクトを新しく作る時は、会話をしながらいつ達成したいかなど SMART を設定して、それに合わせて KPI などを立てて KDI や ToDo を日々設定できるようにしたい」(後半の KPI・KDI・ToDo は EXP-019)
**この文書の数値・規則は、測った後で変えない。**

## 1. 仮説と範囲

- 動かしたい指標: KGI (本人の点数)・KPI-4 (「計画が漠然」の再発)
- H1: 新しいプロジェクトを作るときに、AI が SMART の 5 項目を 1 つずつ聞いて埋め、それが固定の KGI になれば、ゴールが最初から具体になる
- 範囲: SMART の下書きの純粋な関数・会話 API (`/api/setup`)・作成 API (`/api/setup/create`)・SMART カードの画面・「新しいプロジェクト」の選択肢からの流れ・Plan の要点の KGI を階層の KGI の表示にまとめる
- 範囲外: AI が KPI・KDI・ToDo を階層に足す / 毎日の ToDo (EXP-019)。今の作成欄 (手で作る) は残す

## 2. 部品の受け渡しの形

`lib/smart.ts` (純粋):

```ts
export type SmartField = "name" | "category" | "specific" | "measurable" | "achievable" | "relevant" | "timeBound";
export type SmartDraft = Record<SmartField, string>; // timeBound は "YYYY-MM-DD" か ""
export const SMART_FIELDS: SmartField[];              // 聞く順: specific → measurable → timeBound → relevant → achievable → name → category
export const SMART_LABEL: Record<SmartField, string>; // 具体的に何を (S) / どう測るか (M) / いつまでに (T) / なぜやるか (R) / 達成できるか (A) / プロジェクトの名前 / 種類
export const EMPTY_SMART: SmartDraft;
export function parseSmartDraft(x: unknown): SmartDraft | null; // 文字列は trim・name 60 字・category 20 字 (既定の 3 つか自由入力)・他 300 字まで・timeBound は実在する日付か ""。オブジェクトでなければ null・無いキーは ""
export function mergeSmart(base: SmartDraft, patch: unknown): SmartDraft; // 埋まった欄だけ上書き (空で上書きしない)
export function nextSmartField(d: SmartDraft): SmartField | null;
export function isSmartReady(d: SmartDraft, today: string): boolean; // 全部埋まり、timeBound が today (YYYY-MM-DD) 以降
export function smartToKgi(d: SmartDraft): { title: string; target: string; dueDate: string }; // title = specific (200 字まで)・target = measurable (200 字まで)・dueDate = timeBound
```

`/api/setup`: `POST { draft, history, message }` → `200 { reply, draft, next, choices, ready }`
- データベースに書かない (作るまでは画面が下書きと会話を持つ)。Gemini は `GEMINI_MODEL`・JSON
- プロンプト: コーチとして新しい目標づくりを手伝う・SMART を `nextSmartField` の順に 1 つずつ聞く・漠然とした答えには数と期日の入った言い直しを 2〜3 個示す・答えの候補を `choices` に 2〜4 個 (EXP-023 と同じ決まり)・ユーザーが言っていない値で埋めない・今日の日付を渡し、期限は今日以降・出力は JSON `{"reply","draft","choices"}` (今決まった欄だけ)
- 返す `draft` は `mergeSmart`・`ready` は `isSmartReady`・429 は quotaBody・`[perf]`: route `api/setup`・gemini_ms・history_len・fields_filled (埋まった数)・choices_count

`/api/setup/create`: `POST { draft }` → `201 { project, kgi }`
- `isSmartReady` でなければ 400
- プロジェクト (name・category・purpose = relevant) を作り、階層に KGI (`smartToKgi`) を作り、cycle を作って Plan の `purpose` = relevant・`kgi` = 「{specific}（{measurable}）{timeBound} まで」を入れる。すべて owner で
- `[perf]`: route `api/setup/create`・db_ms・row_count。中身とメールはログに出さない

画面:
- `app/components/SmartPanel.tsx`: `export function SmartPanel(props: { draft: SmartDraft; onChange(d: SmartDraft): void; ready: boolean; creating: boolean; onCreate(): void; onCancel(): void })` — 7 つの欄 (ラベル・次に聞く欄に aria-current="step")・「このゴールで作る」(ready の時だけ押せる・押せない理由を aria-describedby で)・「やめる」
- page: 選択肢「新しいプロジェクト」(プロジェクト無しの時) で**会話の作成モード**に入る: 左の会話は `/api/setup` を使い (履歴は画面だけ・保存しない)、右の列は SmartPanel。AI の最初の一言は画面で作る (「新しい目標を一緒に決めましょう。まず、具体的に何をしたいですか？」・Gemini を使わない)。作ると、そのプロジェクトを選んだ状態になり、作成モードを抜ける。答えの候補 (AnswerChoices) も出す
- Plan の要点の「目標 (KGI)」: 階層に KGI があれば、その内容を読み取り専用で出す (EXP-024 の残り)

## 3. 実験室の判定

| 規則 | 条件 |
|---|---|
| L1 | `parseSmartDraft`・`mergeSmart`・`nextSmartField`・`isSmartReady` (昨日の期限は false・今日は true・欄が 1 つでも空は false)・`smartToKgi` |
| L2 | `/api/setup`: 401・400・200 (reply・draft・next・choices・ready)・欄の重ね合わせ・プロンプトに SMART の順と今日の日付・データベースを呼ばない・429・`[perf]` 1 行・中身がログに出ない |
| L3 | `/api/setup/create`: ready でない下書きは 400・201 でプロジェクト・KGI・cycle を作る (問い合わせの文で確かめる)・全問い合わせで owner・401・503・中身とメールがログに出ない |
| L4 | 画面: SmartPanel の 7 つのラベル・次の欄の aria-current・ready でなければ作るボタンは aria-disabled で理由が出る |
| L5 | `npm test` 全件成功・`tsc` 0・lint 0 errors・`next build` 成功・`/api/coach` のプロンプトの差分 0 行 |

## 4. 本人の判定

| 判定 | 条件 |
|---|---|
| **定着** | 本人が会話で SMART を決めてプロジェクトを 1 つ以上作り (`api/setup/create` 201)、一番の困りごとに「ゴールが漠然」「作り方が分からない」を挙げない |
| **巻き戻し** | 会話で作るのが遠回り・欄が埋まらない、と本人が報告した (Human Gate) |
| **判定不能** | 14 日以内に使わない |
