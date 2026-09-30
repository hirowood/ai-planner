# EXP-007 事前登録 — Plan を入力欄と壁打ちで一緒に決める (PDCA の P)

Status: **登録済み (変更より前の commit)** / Date: 2026-09-30
仕様: `docs/pdca-spec.md` / 作り方: `docs/parallel-cycle-spec.md` (このカードが最初の並列サイクル・計画 `docs/plans/EXP-007.json`)
きっかけ: 本人 (2026-09-30・点数 3)「目標と目的を入力欄に入力、わからなければ壁打ちでチャットする。入力するか会話を反映するかで Plan を一緒に決める。行動まで落とせたら実際に仮説をもとに行動する」。続く Check・Act は別カード (本人の選択: Plan から 1 段ずつ・保存先は Google カレンダー)
**この文書の数値・規則は、測った後で変えない。**

## 1. 仮説と狙う指標

- 動かしたい指標: **KGI (本人の点数)**。副に KPI-2 (往復数): 入力欄に直接書ければ、聞かれるのを待たずに済む
- H1: Plan を「目的・目標 (KGI)・途中の指標 (KPI)・行動 (KDI)・判定基準・成果物」の欄に分けて見せ、直接書くか、会話から反映するかを選べれば、本人が行動まで落とした Plan をカレンダーに登録できる
- H2: 登録した予定の説明欄に Plan (判定基準と成果物) が残るので、次の Check のカードで読み返せる

範囲:
- 画面: 右の列に「📝 Plan」と「📅 予定」の切り替えを足す。Plan の欄・「会話から反映」「壁打ちする」「カレンダーに登録」
- サーバ: 会話から Plan の欄を埋める API (`/api/plan/extract`)。カレンダー登録の API に「Plan の欄から登録した」の印
- **チャットのプロンプトは変えない** (EXP-004・EXP-006 の判定と混ぜない)。Plan の欄を聞く会話にするのは次のカード
- Check・Act の画面は含めない

## 2. 部品の受け渡しの形 (並列で作るための約束)

`lib/pdca-plan.ts`:

```ts
export type Kpi = { name: string; target: string };
export type Kdi = { action: string; date: string; start: string; end: string }; // "YYYY-MM-DD" / "HH:MM"
export type PlanDraft = {
  purpose: string;   // 目的 (なぜやるか)
  kgi: string;       // 目標 (期限までにどうなっていたいか)
  kpis: Kpi[];       // 途中で測る指標 (0〜3)
  kdis: Kdi[];       // 行動 (0〜5)
  criteria: string;  // 判定基準 (Check で何を見ればできたと言えるか)
  deliverable: string; // 成果物
};
export type CalendarEventInput = { summary: string; description: string; start: { dateTime: string }; end: { dateTime: string }; colorId?: string };
export const EMPTY_PLAN: PlanDraft;
export function planMissing(d: PlanDraft): string[];          // 足りない欄の日本語名 (空なら登録できる)
export function planToEvents(d: PlanDraft, planId: string): CalendarEventInput[];
export function parsePlanDraft(x: unknown): PlanDraft | null; // AI・リクエストの値を検査して整える
export function filledCount(d: PlanDraft): number;            // 埋まっている欄の数 (0〜6)
export function newPlanId(): string;
```

- `planMissing` の必須: 目的・目標・行動 1 つ以上 (時刻が正しく、終了 > 開始)・判定基準・成果物。KPI は任意
- `planToEvents`: 行動 1 つ = 予定 1 件。`summary` = `🎯 ` + 行動。`dateTime` = `YYYY-MM-DDTHH:MM:00+09:00`。`description` に 目的・目標・KPI・判定基準・成果物 を見出しつきで入れ、最終行を `PDCA-PLAN:<planId>` にする
- `parsePlanDraft`: オブジェクトでなければ null。文字列は trim・500 文字で切る。KPI 3 件・行動 5 件まで。形の合わない要素は捨てる

`/api/plan/extract`: `POST { history: {role, content}[] }` → `200 { draft: PlanDraft }`。Gemini は `getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: { responseMimeType: "application/json" } }).generateContent(prompt)`・`result.response.text()` を JSON として読む。429 は `lib/quota.ts` の `quotaBody(quotaKind(e))`。

`/api/calendar/create`: body に `source: "plan_form"` があれば `[perf]` に `from_plan_form: true`。

`[perf]` の新しい項目 (数と真偽だけ): `fields_filled` (extract が埋めた欄の数)・`from_plan_form`。

## 3. 実験室の判定 (機械的)

| 規則 | 条件 |
|---|---|
| L1 | `planToEvents`: 行動 2 つ → 予定 2 件・時刻が +09:00 の ISO・説明に 5 つの見出しと最終行 `PDCA-PLAN:<id>`。`planMissing`: 空の Plan で 5 つ全部・終了 ≦ 開始の行動だけなら「行動」が残る・全部そろえば空 |
| L2 | `parsePlanDraft`: 配列・文字列・null → null。501 文字 → 500 文字。KPI 4 件 → 3 件・行動 6 件 → 5 件。形の合わない要素を捨てる |
| L3 | `/api/plan/extract`: セッション無し 401・壊れた JSON 400・成功 200 で `draft` を返す・1 日の上限 429 は `kind: quota_daily`。`[perf]` は 1 行・許可項目だけ・`fields_filled` が数。会話の本文・AI の返答はログに出ない |
| L4 | `/api/calendar/create`: `source: "plan_form"` で `from_plan_form: true`、無ければ項目が出ない |
| L5 | Plan の欄: 6 つの欄すべてにラベル・「カレンダーに登録」は足りない欄があれば押せず、足りない欄の名前が `role="status"` で出る・「会話から反映」「壁打ちする」がある |
| L6 | `npm test` 全件成功・`tsc` 0・lint 0 errors・`next build` 成功 |
| L7 | チャットのプロンプトの差分が 0 行・既存のチャット・予定案の登録・上限のお知らせ・時間の入力画面のテストが通る |

## 4. 本人の判定 (本番 1〜2 回)

| 判定 | 条件 |
|---|---|
| **定着** | 本番で Plan の欄から 1 回以上登録し (`from_plan_form: true` かつ create 200)、本人が一番の困りごとに「Plan の入力」を挙げない |
| **巻き戻し** | Plan の欄が邪魔・登録できない・会話の反映が使えない、と本人が報告した (Human Gate。Claude は提案まで) |
| **判定不能** | 14 日以内に本番で Plan の欄を使わない |

点数 (KGI) は記録するが判定には使わない。「会話から反映」は Gemini を 1 回使う (1 日 20 回の枠を減らす) ことを本人に伝える。
