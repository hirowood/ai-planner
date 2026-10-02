# EXP-008 事前登録 — 土台: データベース・目的別プロジェクト・ノート

Status: **登録済み (変更より前の commit)** / Date: 2026-09-30
仕様: `docs/product-spec.md` (製品の形) / `docs/pdca-spec.md` / 作り方: `docs/parallel-cycle-spec.md` (計画 `docs/plans/EXP-008.json`)
きっかけ: 本人「ノートも作成する。事実などデータなど記録をとる。データベースも必要」「プロジェクトをいくつか作れるようにする。習慣や学習や仕事など目的によって作れるようにする」。決定: Vercel の Postgres (Neon)・データベースを先に
**この文書の数値・規則は、測った後で変えない。**

## 1. 仮説と狙う指標

- 動かしたい指標: **KGI (本人の点数)** — 目的ごとに記録が残れば、次の Plan・Check の材料になる (この段だけでは点数は動きにくい。土台のカード)
- H1: 目的別 (習慣・学習・仕事) にプロジェクトを作り、その中に事実・データ・考えをノートとして書けば、本人が記録を続けられる
- 範囲: データベース・プロジェクト (作る・一覧・選ぶ)・ノート (書く・一覧・消す)。**チャットのプロンプトは変えない**。Plan・Check・Act は含めない

## 2. 部品の受け渡しの形 (並列で作るための約束)

新しい依存: `@neondatabase/serverless@1.1.0` (MIT・`npm view` で確認・`--save-exact`)。使い方は tagged template (`sql\`... ${v}\``) だけ (値は必ずパラメータになる)。

`lib/projects.ts` (純粋な検査):

```ts
export type Category = "habit" | "learning" | "work";
export const CATEGORY_LABEL: Record<Category, string>; // 習慣 / 学習 / 仕事
export type NoteKind = "fact" | "data" | "thought";
export const NOTE_KIND_LABEL: Record<NoteKind, string>; // 事実 / データ / 考え
export type ProjectInput = { name: string; category: Category; purpose: string };
export type NoteInput = { projectId: string; kind: NoteKind; body: string };
export type Project = ProjectInput & { id: string; createdAt: string };
export type Note = NoteInput & { id: string; createdAt: string };
export function parseProjectInput(x: unknown): ProjectInput | null; // name 1〜60 字 (trim)・purpose 0〜500 字・category は 3 つのどれか
export function parseNoteInput(x: unknown): NoteInput | null;       // projectId は UUID・body 1〜2000 字 (trim)・kind は 3 つのどれか
export function isUuid(x: unknown): x is string;
```

`lib/db.ts`:

```ts
export type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;
export class DbNotConfigured extends Error {}
export function getSql(): Sql; // DATABASE_URL が無ければ DbNotConfigured を投げる。neon(DATABASE_URL) を 1 回だけ作る
```

`lib/repo.ts` (すべての問い合わせに `owner` を入れる):

```ts
export function listProjects(sql: Sql, owner: string): Promise<Project[]>;
export function createProject(sql: Sql, owner: string, input: ProjectInput): Promise<Project>;
export function listNotes(sql: Sql, owner: string, projectId: string): Promise<Note[]>;          // 新しい順
export function createNote(sql: Sql, owner: string, input: NoteInput): Promise<Note | null>;     // プロジェクトが owner のものでなければ null
export function deleteNote(sql: Sql, owner: string, id: string): Promise<boolean>;               // owner のものを消せたら true
```

API (どれもセッションの `user.email` を owner にする):

| 経路 | 成功 | 失敗 |
|---|---|---|
| `GET /api/projects` | 200 `{ projects }` | 401 / 503 |
| `POST /api/projects` `{ name, category, purpose }` | 201 `{ project }` | 400 / 401 / 503 |
| `GET /api/notes?projectId=` | 200 `{ notes }` | 400 / 401 / 503 |
| `POST /api/notes` `{ projectId, kind, body }` | 201 `{ note }` | 400 / 401 / 404 (他人・無いプロジェクト) / 503 |
| `DELETE /api/notes/[id]` | 204 | 400 / 401 / 404 / 503 |

503 = データベースが未設定 (`DbNotConfigured`)・本文 `{ error: "データベースが未設定です" }`。

`[perf]` の新しい項目 (数だけ): `db_ms` (データベースの待ち・`PerfPart`)・`row_count` (返した行の数)。名前・目的・本文は出さない。

`db/schema.sql`: `projects` と `notes` (`docs/product-spec.md` §2・`owner` に索引・notes は project を `on delete cascade`)。`scripts/db-migrate.mjs`: `DATABASE_URL` で schema.sql を流し、作った表の名前だけを出す (接続文字列は出さない)。

画面: 右の列に「📁 プロジェクト」と「📅 予定」の切り替え。プロジェクト: 一覧から選ぶ・「＋新しいプロジェクト」(名前・種類 [習慣/学習/仕事]・目的)。選んだプロジェクトのノート: 種類 [事実/データ/考え] と本文で書く・一覧 (新しい順)・消す (`confirm()` を使わず、ボタンを 2 回押す形)。

## 3. 実験室の判定 (機械的)

| 規則 | 条件 |
|---|---|
| L1 検査 | `parseProjectInput`・`parseNoteInput`: 正しい値を通し、空の名前・61 字の名前・501 字の目的・知らない種類・UUID でない projectId・空の本文・2001 字の本文・オブジェクトでない値を null にする |
| L2 持ち主 | 偽の `sql` で、`lib/repo.ts` の全関数の問い合わせの値に `owner` が入る。他人のプロジェクトへの `createNote` は null・他人のノートの `deleteNote` は false |
| L3 API | 表のとおりの status (401・400・201・200・204・404・503)。`[perf]` は 1 行・許可項目だけ。名前・目的・本文・メールがログに出ない |
| L4 画面 | プロジェクトの作成欄の 3 項目とノートの 2 項目にラベル・種類はラジオ (習慣/学習/仕事・事実/データ/考え)・「📁 プロジェクト」「📅 予定」の切り替え |
| L5 壊さない | `npm test` 全件成功・`tsc` 0・lint 0 errors・`next build` 成功・チャットのプロンプトの差分 0 行 |
| L6 DB | 本物の Neon で `db-migrate.mjs` が 2 つの表を作る (本人が接続を設定した後・ローカル確認の前に行う) |

## 4. 本人の判定 (本番 1〜2 回)

| 判定 | 条件 |
|---|---|
| **定着** | 本番でプロジェクトを 1 つ以上作り (`api/projects` 201)、ノートを 1 つ以上書き (`api/notes` 201)、本人が一番の困りごとに「プロジェクト・ノート」を挙げない |
| **巻き戻し** | 作れない・消える・他人のものが見える、と本人が報告した (Human Gate) |
| **判定不能** | 14 日以内に本番でプロジェクトかノートを作らない |

## 5. 本人にお願いする設定 (Human Gate)

1. Vercel の ai-planner → Storage → Neon (Postgres) を作成し、ai-planner の Production・Preview・Development につなぐ (`DATABASE_URL` が自動で入る)
2. ローカル用に、`DATABASE_URL` を `.env.local` へ本人が書き写す (Claude は `.env.local` を読まない)
3. `node --env-file=.env.local scripts/db-migrate.mjs` を本人が流す (表を作る)
