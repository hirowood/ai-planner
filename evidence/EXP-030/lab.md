# EXP-030 実験室の結果 — ToDo を予定 (Google カレンダー) に入れる

Date: 2026-10-02 / 事前登録: `request.md` (変更より前に commit 36742f6)

## 変更

- `db/schema.sql`: `item_events` (item_id 主キー → plan_items 消したら消える)・`scripts/db-migrate.mjs` の確認一覧に追加
- `lib/todo-event.ts` (新規・純粋): `parseTimeRange`・`todoToEvent`・`upcomingTodos`・`eventLabel`・`parseItemEvents`
- `lib/repo.ts`: `getItem`・`claimItemEvent` (先に枠を取る・2 分より古い作りかけの枠だけ取り直せる)・`confirmItemEvent`・`releaseItemEvent`・`listItemEvents`
- `app/api/items/[id]/calendar/route.ts` (新規 POST)・`app/api/items/events/route.ts` (新規 GET)
- `app/components/TodoSchedule.tsx` (新規): `useItemEvents`・`TodoScheduleView`
- `app/components/DailyPanel.tsx`: 今日の ToDo の行に予定の印 (`eventLabels`)
- `app/page.tsx`: 「☀️ 今日」タブの下に「📅 予定に入れる ToDo」

## 判定 (事前登録の規則)

| 規則 | 結果 | 根拠 |
|---|---|---|
| L1 | 成立 | `lib/todo-event.test.ts` 9 件 (終日・時刻つき・片方だけ / end ≤ start / 形違い → null・終日は翌日 (月末・年末)・+09:00・期日なし null・今日〜7 日先で KDI と過去と 8 日先は入れない) |
| L2 | 成立 | `lib/todo-calendar-route.test.ts` トークン無し 401 (DB・Google を呼ばない)・400 ×4・404・ToDo でない / 期日なし 400・画面の summary を使わず項目から作る・枠を取る値に owner と pending・event_id を保存・2 回目 409 で Google を 1 回だけ・Google 401 は「もう一度ログイン」で枠を消し 502・その後は入れ直せる・id が無い応答も 502・題・メール・トークンはログに無い |
| L3 | 成立 | 同 GET は owner・projectId・pending 除外で絞る・401・400 |
| L4 | 成立 | `app/components/TodoSchedule.test.tsx` 時刻の入力とボタンにラベル・予定のある ToDo は印だけ・ToDo 無しの案内・今日の ToDo の行にも印 |
| L5 | 成立 | `npm test` 52 ファイル 688 件合格 (662 → 688)・`tsc` 0・eslint 0 errors / 10 warnings (前と同じ)・`next build` 成功 |

## わざと壊して赤になるか (10/10)

M1 end ≤ start を通す・M2 片方だけの時刻を終日にする・M3 終日の end を同じ日にする・M4 +09:00 を付けない・M5 Google 失敗で枠を消さない・M6 二重を 409 にしない・M7 トークン無しを通す・M8 GET で作りかけも出す・M9 7 日先を 8 日に・M10 予定のある ToDo にも入力を出す → すべて赤

## 残り

- 移行: 本人が `node --env-file=.env.local scripts/db-migrate.mjs` を実行する (`item_events` が出れば成功)。移行前は「予定の一覧を読み込めませんでした」になるが、階層と今日の記録は動く
- 本物の Google との往復は本人の利用で確かめる (テストは fetch の差し替え)
- Google 側で予定を消しても、アプリの印は残る (同期は範囲外)
- 2 分の取り直しは DB の時刻で決まる (テストの差し替えでは確かめていない・SQL の文だけ)
- 安全と a11y のレビューは子 agent の上限解除 (2026-10-05) 後

## レビュー後の修正 (2026-10-02・安全レビュー W1)

指摘: Google の応答が 2 分以上止まると、別の要求が作りかけの枠を取り直して予定が 2 つできる / 片方の返却が相手の枠を消す / 記録の失敗で追えない予定が残り、入れ直すと 2 つになる。

直したこと:
- 枠の印を一度きりの `pending:<uuid>` にし、確定 (`confirmItemEvent`) と返却 (`releaseItemEvent`) は自分の印の枠だけに効かせる。確定できたかを返す
- 確定できなかった (取り直された) ときは、作った Google の予定を消して 409
- 確定の記録が失敗したときは、Google の予定を消して自分の枠を返し 500
- Google への問い合わせは 20 秒で打ち切る (取り直しの 2 分より短い)
- 一覧と取り直しは `pending` で始まる値を作りかけとして扱う

確かめたこと: `lib/todo-calendar-route.test.ts` に 4 件 (打ち切りの signal・取り直されたら Google を消して 409 で相手の枠は残る・記録の失敗で Google を消して枠を返す・古い作りかけは取り直せて作り終えた予定は取り直せない)。わざと壊す 7 通り (確定・返却で印を見ない・Google を消さない ×2・取り直されても 200・打ち切りなし・印を固定に) はすべて赤。`npm test` 699 件合格・`tsc` 0・eslint 0 errors / 10 warnings・`next build` 成功。

残り: 2 分の判定は DB の時刻で決まる (テストの差し替えでは時刻を進めていない)。Google の予定の削除が失敗したときはログに `google_removed=false` が出る (中身は出さない)。
