# EXP-009 事前登録 — AI が誘導して、プロジェクトの Plan を一緒に決める (PDCA の P)

Status: **登録済み (変更より前の commit)** / Date: 2026-09-30
仕様: `docs/product-spec.md` / 作り方: `docs/parallel-cycle-spec.md` (計画 `docs/plans/EXP-009.json`)
きっかけ: 本人 (EXP-008/012 ローカル確認・点数 2)「PDCA が決められない点と、相手から会話が来ないから誘導してほしい」→ H-10・H-11。取り下げた EXP-007 (Plan の欄) の中身を、データベース保存と AI の誘導つきで登録し直す
**この文書の数値・規則は、測った後で変えない。**

## 1. 仮説と狙う指標

- 動かしたい指標: **KGI (本人の点数)**
- H1 (H-11): プロジェクトを選んだら AI が先に話しかけ、次に決める欄を 1 つだけ聞けば、本人は何を書けばよいか迷わない
- H2 (H-10): 答えるたびに Plan の欄 (目的・目標 KGI・途中の指標 KPI・行動 KDI・判定基準・成果物) が埋まり、直接直すこともでき、保存できれば、本人が Plan を決め切れる

範囲:
- プロジェクトを選んだ画面に「📝 Plan」と「📓 ノート」の切り替え。既定は Plan
- Plan 用の会話 (`/api/plan/chat`)。**今のチャット (`/api/chat`) とそのプロンプトは変えない** (EXP-004・EXP-006 の本番判定と混ぜない)
- Plan の保存 (`cycles` 表・`/api/cycles`)。行動をカレンダーへ登録するボタン
- Check・Act は含めない

## 2. 部品の受け渡しの形

`lib/pdca-plan.ts` (純粋):

```ts
export type Kpi = { name: string; target: string };
export type Kdi = { action: string; date: string; start: string; end: string }; // "YYYY-MM-DD" / "HH:MM" (時刻は空でもよい)
export type PlanDraft = { purpose: string; kgi: string; kpis: Kpi[]; kdis: Kdi[]; criteria: string; deliverable: string };
export type PlanField = "purpose" | "kgi" | "kpis" | "kdis" | "criteria" | "deliverable";
export const PLAN_FIELDS: PlanField[];                 // 聞く順: 目的 → 目標 → KPI → 行動 → 判定基準 → 成果物
export const PLAN_FIELD_LABEL: Record<PlanField, string>; // 目的 / 目標 (KGI) / 途中の指標 (KPI) / 行動 (KDI) / 判定基準 / 成果物
export const EMPTY_PLAN: PlanDraft;
export function parsePlanDraft(x: unknown): PlanDraft | null; // 文字列は trim・500 字まで・KPI 3 件・行動 5 件まで・形の合わない要素は捨てる
export function mergePlan(base: PlanDraft, patch: unknown): PlanDraft; // AI の返した欄だけを上書き (空の値では上書きしない)
export function nextField(d: PlanDraft): PlanField | null;   // まだ空の最初の欄 (全部埋まれば null)
export function filledCount(d: PlanDraft): number;           // 埋まっている欄の数 (0〜6)
export function openingMessage(p: { name: string; purpose: string }, d: PlanDraft): string; // AI の最初の一言 (画面で作る・Gemini を使わない)
export function planToEvents(d: PlanDraft, cycleId: string): CalendarEventInput[]; // 日付と開始・終了がそろった行動だけ。+09:00 の ISO・説明に Plan の要点と最終行 PDCA-CYCLE:<id>
```

`openingMessage`: 目的が空なら、プロジェクト名 (と、あればプロジェクトの目的) に触れて目的を聞く。途中まで埋まっていれば `nextField` の欄を聞く。全部埋まっていれば「保存しますか」と聞く。**質問は 1 つだけ**。

`/api/plan/chat`: `POST { project: { name, category, purpose }, plan: PlanDraft, history: {role, content}[], message: string }` → `200 { reply: string, plan: PlanDraft, next: PlanField | null }`。
- Gemini は `generateContent` で JSON を返させる (`responseMimeType: "application/json"`)。返った `plan` は `mergePlan` で今の Plan に重ねる。`next` はサーバで `nextField` から決め直す
- プロンプトの約束: 1 回に質問は 1 つ・次に決める欄を聞く・本人の言葉から欄の値を抜き出す・分からなければ例を 2〜3 個示して選んでもらう・値をでっち上げない
- 429 は `lib/quota.ts` の `quotaBody(quotaKind(e))`。401 / 400 / 500 は今までどおり
- `[perf]` (数と真偽だけ): route `api/plan/chat`・`gemini_ms`・`fields_filled` (返した Plan の埋まった欄の数)・`history_len`

`cycles` 表と `/api/cycles`:
- 表: id・owner・project_id (projects を on delete cascade)・phase (`plan` / `do`)・plan (jsonb)・created_at・updated_at
- `GET /api/cycles?projectId=` → 200 `{ cycle: Cycle | null }` (そのプロジェクトの最新 1 件)
- `PUT /api/cycles` `{ projectId, cycleId?, plan, phase }` → 200 `{ cycle }` (cycleId が無ければ作る・あれば更新)。プロジェクトも cycle も owner のものに限る (他人・無い → 404)
- すべての問い合わせに owner (EXP-008 の決まりと同じ・tagged template だけ)
- `[perf]`: `db_ms`・`row_count`

画面 (`app/components/PlanPanel.tsx` と page の配線):
- 左に会話 (AI の最初の一言が最初から出ている・入力欄・送信)、または縦に並べる。右の列の中に収まる形でよい
- Plan の 6 つの欄 (ラベルつき・直接書ける・KPI と行動は行を足せる)。次に聞く欄を強調表示 (`aria-current="step"`)
- 「保存」(`PUT /api/cycles`)・「行動をカレンダーに登録」(日付と時刻がそろった行動がある時だけ押せる)。保存・登録の結果は `role="status"` で知らせる
- 上限 (429) は EXP-005 と同じお知らせ

## 3. 実験室の判定 (機械的)

| 規則 | 条件 |
|---|---|
| L1 | `parsePlanDraft`・`mergePlan`・`nextField`・`filledCount`: 境界 (501 字・KPI 4 件・行動 6 件・形の合わない要素)・空の値で上書きしない・聞く順どおりの `nextField` |
| L2 | `openingMessage`: 空の Plan でプロジェクト名が入り「？」が 1 つ・目的まで埋まっていれば目標を聞く・全部埋まれば保存を促す。どの場合も「？」は 1 つだけ |
| L3 | `planToEvents`: 日付と時刻がそろった行動だけが予定になる・+09:00・説明の最終行 `PDCA-CYCLE:<id>` |
| L4 | `/api/plan/chat`: 401・400・200 (`reply`・`plan`・`next`)・AI の返した欄だけが重なる・1 日の上限 429 は `quota_daily`。`[perf]` 1 行・許可項目だけ・会話の本文・Plan の中身がログに出ない |
| L5 | `/api/cycles`: 401・400・200・404 (他人のプロジェクト・他人の cycle)・503 (未設定)。全問い合わせで owner が絞り込みに使われる (EXP-008 L2 と同じ検査) |
| L6 | 画面: 6 つの欄にラベル・最初から AI の一言が出ている・次の欄に `aria-current="step"`・保存と登録のボタン |
| L7 | `npm test` 全件成功・`tsc` 0・lint 0 errors・`next build` 成功・`/api/chat` のプロンプトの差分 0 行 |
| L8 | 本物の Neon で移行を流し、Plan を保存・読み直しできる (本人のローカル確認) |

## 4. 本人の判定

| 判定 | 条件 |
|---|---|
| **定着** | 本人が AI の誘導で Plan を 1 つ以上保存し (`/api/cycles` PUT 200 で `fields_filled` 相当が 5 以上)、一番の困りごとに「決められない」「誘導が無い」を挙げない |
| **巻き戻し** | 誘導が邪魔・欄が埋まらない・保存できない、と本人が報告した (Human Gate) |
| **判定不能** | 14 日以内に Plan の画面を使わない |

点数 (KGI) は記録するが判定には使わない。Plan の会話は 1 往復で Gemini を 1 回使う (1 日 20 回の枠)。最初の一言は使わない。
