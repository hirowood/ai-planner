# EXP-021 事前登録 — 時間帯の挨拶と、何をするかの選択肢ボタン

Status: **登録済み (変更より前の commit)** / Date: 2026-09-30
仕様: `docs/product-spec.md` v2 §2 (チャットは 1 つ・AI が誘導)
きっかけ: 本人「チャットで AI でどのようなことをするかなど、質問や提案や予定や新規プロジェクトや前回の続きなど選択肢ボタンを出して選ばすか、壁打ちや相談などするか。アプリから時間なりの挨拶をして話すようにしてください」(H-11 の延長)
**この文書の数値・規則は、測った後で変えない。**

## 1. 仮説と範囲

- 動かしたい指標: KGI (本人の点数)。最初の一歩で迷わなくなる
- H1: アプリが時間帯の挨拶をして、することを選択肢のボタンで示せば、本人は何を打てばよいか迷わずに始められる
- 範囲: 挨拶と選択肢の純粋な関数・ボタンの部品・画面の配線。挨拶と選択肢は画面で作る (Gemini を使わない)。ボタンを押したときだけ、決まった最初の一言を `/api/coach` (プロジェクトを選んでいる時) に送る
- 範囲外: AI の返事ごとに次の選択肢を出す (後のカード)・`/api/coach` と `/api/chat` のプロンプト

## 2. 決まり (受け渡しの形)

`lib/greeting.ts` (純粋):

```ts
export type ChoiceId = "resume" | "new_project" | "calendar" | "brainstorm" | "suggest" | "ask_next" | "plan_today";
export type Choice = { id: ChoiceId; label: string; message?: string }; // message があるものは押すと会話に送る
export function greetingFor(d: Date): string;  // 5:00〜9:59 おはようございます / 10:00〜16:59 こんにちは / 17:00〜4:59 こんばんは (端末の時刻)
export function startMessage(p: { greeting: string; userName?: string | null; projectName?: string | null; hasHistory: boolean }): string;
export function startChoices(p: { projectSelected: boolean; hasLastProject: boolean }): Choice[];
```

- `startMessage`: 名前があれば「{挨拶}、{名前}さん。」。プロジェクト無し →「今日は何をしますか？」。プロジェクトあり → 会話があれば「『{名}』の続きから始めますか？」、無ければ「『{名}』の PDCA を一緒に始めましょう。何からしますか？」。**「？」は 1 つだけ**
- `startChoices` (プロジェクト無し): 前回の続き (`resume`・最後に開いたプロジェクトがある時だけ)・新しいプロジェクト (`new_project`)・予定を見る (`calendar`)・壁打ち・相談 (`brainstorm`)
- `startChoices` (プロジェクトあり): 前回の続き (`resume`・message「前回の続きから、今の状況をまとめて次にすることを 1 つ教えてください。」)・提案がほしい (`suggest`・message「今の記録から、次に取り組むとよいことを提案してください。」)・質問に答えて決める (`ask_next`・message「Plan の次に決める欄を質問してください。」)・今日の予定を決める (`plan_today`・message「今日やることを 3 つ決めるのを手伝ってください。」)・壁打ち・相談 (`brainstorm`・message「少し相談したいことがあります。聞いてもらえますか。」)
- 画面の動き: `new_project` → プロジェクトの作成欄の名前へフォーカス / `calendar` → 右の列を「📅 予定」に / `resume` (プロジェクト無し) → 最後に開いたプロジェクトを選ぶ (端末の localStorage に id だけ・読めなければ出さない) / message のある選択肢 → その文を送る (本人の発言として表示) / `brainstorm` (プロジェクト無し) → 入力欄へフォーカス
- 表示: 会話がまだ無い時は挨拶と選択肢を会話欄の最初に出す。会話がある時も、会話欄の一番下に「何をしますか」の選択肢を出す (送信中は押せない)
- ボタン: `<button>` の並び・`role="group"` と名前「次にすること」・24px 以上・キーボードで押せる

## 3. 実験室の判定

| 規則 | 条件 |
|---|---|
| L1 | `greetingFor`: 4:59 こんばんは・5:00 おはようございます・9:59 おはようございます・10:00 こんにちは・16:59 こんにちは・17:00 こんばんは |
| L2 | `startMessage`: 名前あり・無し / プロジェクトあり (会話あり・無し)・無しの 4 通りで決まった文・どれも「？」は 1 つ |
| L3 | `startChoices`: プロジェクト無しで 4 つ (最後に開いたプロジェクトが無ければ 3 つ・resume が無い)・ありで 5 つ・message のある選択肢は決まった文 |
| L4 | 部品: `role="group"` と名前・選択肢の数だけの button・送信中は aria-disabled |
| L5 | `npm test` 全件成功・`tsc` 0・lint 0 errors・`next build` 成功・2 つの route のプロンプトの差分 0 行 |

## 4. 本人の判定

| 判定 | 条件 |
|---|---|
| **定着** | 本人が選択肢のボタンから 1 回以上始め、一番の困りごとに「何をすればよいか分からない」「会話が来ない」を挙げない |
| **巻き戻し** | ボタンが邪魔・押しても思った動きをしない、と本人が報告した (Human Gate) |
| **判定不能** | 14 日以内に使わない |
