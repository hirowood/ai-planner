# EXP-040 実験室の結果 — 日常のタスクを手帳に足し、時間割に入れる

Date: 2026-10-02 / 事前登録: `request.md` (変更より前に commit 35e820b)

## 変更

- `db/schema.sql`: `daily_tasks` (持ち主ごと・日付・題・時刻・状態)
- `lib/daily-tasks.ts` (新規・純粋): `parseTaskInput` (過去 7 日〜未来 62 日・題 1〜100 字・時刻は組で)・`parseTaskPatch`・`parseTaskList`・`tasksText`
- `lib/repo.ts`: `listTasks`・`createTask`・`updateTask`・`deleteTask` (すべて owner で)
- API: `GET/POST /api/tasks`・`PATCH/DELETE /api/tasks/[id]`
- `/api/coach`: `<Records>` に「#### 今日の日常の予定」(表がまだ無いときは無しで続ける)
- `app/components/Schedule.tsx`: `useTasks`・`DailyTasksView` (足す・状態のボタン・2 回押しで消す)・タイムスケジュールとカレンダーに [日常]
- `app/components/Techo.tsx`: 週の表示に「日常 N」

## 判定 (事前登録の規則)

| 規則 | 結果 | 根拠 |
|---|---|---|
| L1 | 成立 | `lib/slots.test.ts` (通るもの 3 通り・null になる 7 通り・変える入力・一覧と AI の文) |
| L2 | 成立 | `lib/schedule-routes.test.ts` (作るは owner をパラメータで 201・不正は 400 で DB を呼ばない・一覧は owner と期間・63 日は 400・変える / 消すは持ち主だけ・無い 404・401・中身とメールはログに無い) |
| L3 | 成立 | `lib/hierarchy-coach.test.ts` (`<Records>` に今日の日常の予定) |
| L4 | 成立 | `app/components/Schedule.test.tsx` (日常の ToDo の欄・ラベル・状態のボタン・消す・タイムスケジュールとカレンダーに [日常]・週の「日常 2」) |
| L5 | 成立 | EXP-039 と同じ |

## 残り

- 移行は EXP-039 と同じ 1 回
- 繰り返しのタスクは無い
