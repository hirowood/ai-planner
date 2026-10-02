# EXP-010 事前登録 — 会話をプロジェクトごとに保存して続きから・Plan の自動保存・チャットの壁打ちを Plan に反映

Status: **登録済み (変更より前の commit)** / Date: 2026-09-30
仕様: `docs/product-spec.md` / 作り方: `docs/parallel-cycle-spec.md` (計画 `docs/plans/EXP-010.json`)
きっかけ: 本人「会話も継続して続きからできるようにしたい」「壁打ちはチャットでもできるようにしてください」→ H-19・H-17。ログでも、読み込み直すと Plan の会話と欄が最初に戻った (EXP-009 local-check)
**この文書の数値・規則は、測った後で変えない。**

## 1. 仮説

- 動かしたい指標: KGI (本人の点数)
- H1 (H-19): 会話 (Plan の会話・通常のチャット) をプロジェクトごとに保存し、開いたら続きを出せば、途中でやめても再開できる
- H2 (H-19): Plan の欄を変わるたびに自動で保存すれば、保存を押し忘れても消えない
- H3 (H-17): 通常のチャットで壁打ちした内容を、ボタン 1 つで Plan の欄に反映できれば、話す場所を選ばなくてよい
- 範囲外: `/api/chat` と `/api/plan/chat` のプロンプトは変えない。過去のデータの活用 (EXP-013)・Do/Check/Act (EXP-011) は含めない

## 2. 部品の受け渡しの形

`lib/messages.ts` (純粋):

```ts
export type Thread = "plan" | "chat";
export type StoredMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string };
export type MessagesInput = { projectId: string; thread: Thread; messages: { role: "user" | "assistant"; content: string }[] };
export const MESSAGE_MAX = 8000;      // 1 件の字数の上限 ([...s] で数える)
export const BATCH_MAX = 20;          // 1 回に保存できる件数
export const HISTORY_LIMIT = 100;     // 読み出す件数 (新しい 100 件を古い順に)
export function isThread(x: unknown): x is Thread;
export function parseMessagesInput(x: unknown): MessagesInput | null; // projectId は UUID・thread・1〜20 件・各 content は空でなく 8000 字まで (中身は trim しない)
```

`lib/repo.ts` に足す (owner で絞る・tagged template だけ):

```ts
export function listMessages(sql: Sql, owner: string, projectId: string, thread: Thread): Promise<StoredMessage[]>; // 新しい 100 件を古い順に
export function appendMessages(sql: Sql, owner: string, input: MessagesInput): Promise<number | null>;          // 入れた件数。プロジェクトが owner のものでなければ null
```

表 `messages`: id・owner・project_id (projects を on delete cascade)・thread・role・content・created_at。索引 (owner, project_id, thread, created_at)。

API `/api/messages`:
- `GET ?projectId=&thread=` → 200 `{ messages: StoredMessage[] }` / 400 / 401 / 503
- `POST { projectId, thread, messages }` → 201 `{ count }` / 400 / 401 / 404 (他人・無いプロジェクト) / 503
- `[perf]`: `db_ms`・`row_count`。会話の中身・メールはログに出さない

画面:
- `PlanPanel`: 開いたら thread `plan` の会話を読み込み、あれば続きを表示 (無ければ今までどおり最初の一言)。1 往復ごとに本人の発言と AI の返事を保存。Plan の欄は変わってから 1 秒後に自動で保存 (`PUT /api/cycles`・最初の保存で cycle を作る)。「保存済み / 保存中 / 保存できませんでした」を `role="status"` で出す
- 「💬 チャットの壁打ちを Plan に反映」ボタン: thread `chat` の直近の会話を history にして `/api/plan/chat` に `message: "ここまでの壁打ちの内容から、Plan の欄を埋めてください。"` を送り、返った Plan を欄に重ねる
- 通常のチャット (`app/page.tsx`): プロジェクトを選んでいる間は、そのプロジェクトの thread `chat` を読み込んで続きを出し、1 往復ごとに保存する。選んでいない間は今までどおり (保存しない)

## 3. 実験室の判定

| 規則 | 条件 |
|---|---|
| L1 | `parseMessagesInput`: 正しい値を通す・UUID でない・知らない thread・0 件・21 件・空の content・8001 字・知らない role・オブジェクトでない → null。中身の空白は変えない |
| L2 | `listMessages` / `appendMessages`: 全問い合わせで owner が絞り込みに使われる (`owner =` の直後に owner の値)・他人のプロジェクトへの追加は null |
| L3 | `/api/messages`: 表のとおりの status・`[perf]` 1 行・許可項目だけ・会話の中身とメールがログに出ない |
| L4 | 画面: 保存された会話があれば最初の一言ではなく続きが出る・反映のボタンがある・保存の状態が `role="status"` に出る |
| L5 | `npm test` 全件成功・`tsc` 0・lint 0 errors・`next build` 成功・2 つの route のプロンプトの差分 0 行 |
| L6 | 本物の Neon で移行 (messages) → 会話して読み込み直すと続きが出る (本人のローカル確認) |

## 4. 本人の判定

| 判定 | 条件 |
|---|---|
| **定着** | 本人が読み込み直した後に続きから会話し (`/api/plan/chat` の history_len > 0 が再開後の最初の送信で出る)、一番の困りごとに「消える・続きからできない」を挙げない |
| **巻き戻し** | 会話が消える・ほかのプロジェクトの会話が混ざる・遅くなった、と本人が報告した (Human Gate) |
| **判定不能** | 14 日以内に使わない |
