# EXP-039 実験室の結果 — プロジェクトの ToDo をアプリ内の予定表 (タイムスケジュール・カレンダー) に入れる

Date: 2026-10-02 / 事前登録: `request.md` (変更より前に commit 35e820b・追記 2576a73)

## 変更

- `db/schema.sql`: `item_slots` (ToDo の時刻・1 つの ToDo に 1 つ)
- `lib/slots.ts` (新規・純粋): `parseSlot`・`slotLabel`・`timetable`・`parseItemSlots`
- `lib/repo.ts`: `upsertItemSlot` (持ち主の ToDo だけ)・`deleteItemSlot`・`listItemSlots`・`listScheduledTodos` (持ち主の全プロジェクト (しまっていない) の期日が期間の中の ToDo と時刻とプロジェクト名)
- API: `PUT /api/items/[id]/slot`・`GET /api/items/slots`・`GET /api/items/schedule?from=&to=` (62 日まで)・`lib/route-helpers.ts` (共通)
- `/api/coach`: 今日の ToDo の段で時刻を聞く文 (日常の予定と重ならないように)・items / candidates / pick の start・end を時刻として保存 (不正な時刻は時刻だけ捨てる)
- `lib/hierarchy-step.ts`: 候補に時刻 (`slotsByTitle`)
- `app/components/Schedule.tsx` (新規): `TimeSchedule` (6〜24 時の行・早い / 遅い予定で広げる・時刻なし)・`SlotEditor`・`AppCalendar` (月の表・選んだ日のタイムスケジュール・全プロジェクト + 日常・プロジェクトの印)
- `app/page.tsx`: 手帳の日のページにタイムスケジュールと ToDo の時刻の入力・右の列の「📅 カレンダー」をアプリ内のカレンダーに置き換え・Google の「予定に入れる」と Google の予定の一覧を画面から外した (コードは残す・Google カレンダーは後で実装)

## 判定 (事前登録の規則・追記を含む)

| 規則 | 結果 | 根拠 |
|---|---|---|
| L1 | 成立 | `lib/slots.test.ts` (正しい時刻・両方空は外す・null になる 8 通り・時刻順と時刻なし・ラベル) |
| L2 | 成立 | `lib/schedule-routes.test.ts` (401・400・upsert は ToDo だけで owner をパラメータ・外す・他人 / ToDo でない 404・slots は owner と projectId・schedule は owner と期間としまっていないプロジェクト・62 日を超える / 逆順 / 形違いは 400) |
| L3 | 成立 | `lib/hierarchy-coach.test.ts` (時刻を聞く文・AI の時刻を作った ToDo に保存・不正な時刻は ToDo だけ作る・候補の時刻も保存) |
| L4 | 成立 | `app/components/Schedule.test.tsx` (18 の時の行・その時の行に時刻順・時刻なしの見出しと中身・範囲を広げる・カレンダーの月の表と予定の数と選んだ日・プロジェクトと日常の印・右の列のタブの名前と Google の一覧を出さない) |
| L5 | 成立 | `npm test` 64 ファイル 820 件合格・`tsc` 0・eslint 0 errors / 13 warnings (Google の表示を外したので使わない 3 つが増えた・Google を実装するときに戻す)・`next build` 成功 |

わざと壊す 11 通り (EXP-040 と合わせて) はすべて赤 (時刻なしの見出しを消す 1 通りは最初は捕まえられず、テストを強めて赤になった)。

## 残り

- 移行: 本人が `node --env-file=.env.local scripts/db-migrate.mjs` を実行する (`item_slots`・`daily_tasks` が出れば成功)
- ブラウザでは確かめていない・重なった予定の警告は無い
