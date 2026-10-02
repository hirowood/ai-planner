# EXP-030 事前登録 — ToDo を予定 (Google カレンダー) に入れる

Status: **登録済み (変更より前の commit)** / Date: 2026-10-01
仕様: `docs/product-spec.md` §0 差別化 (Do: ToDo を予定に入れ、次にやる行動を一緒に決める)
きっかけ: 本人「ToDo に落とし込んだことを予定に反映する」
**この文書の数値・規則は、測った後で変えない。**

## 1. 仮説と範囲

- H1: 階層で決めた ToDo を、時刻を選ぶ (または終日) だけで Google カレンダーに入れられれば、ToDo が「いつやるか」まで決まり、Do が実行に移りやすい
- 範囲: item_events 表 (ToDo と予定の対応)・`POST /api/items/[id]/calendar`・`GET /api/items/events`・「☀️ 今日」タブの「📅 予定に入れる ToDo」(今日から 7 日先までの ToDo)
- 範囲外: 予定の変更・取り消しの同期・AI が時刻を決める (後のカード)・KDI の繰り返し予定

## 2. 決まり

データ: `item_events` (item_id → plan_items 消したら消える・主キー・owner・event_id・start_time・end_time・created_at)。1 つの ToDo に予定は 1 つ

`lib/todo-event.ts` (純粋):
- `parseTimeRange(x)`: `{}` か start・end が両方無い → 終日 / 両方 "HH:MM" で end > start → 時刻つき / それ以外 → null
- `todoToEvent(item, range)`: 件名「✅ 題」・説明「ai-planner の ToDo」・終日は date (期日) 〜 翌日・時刻つきは期日の +09:00
- `upcomingTodos(items, today, days=7)`: 期日が今日〜7 日先の ToDo (期日→作った順)

`POST /api/items/[id]/calendar` (`{ start?, end? }`):
- ログインと Google のトークンが無ければ 401・id が UUID でない / 時刻が正しくない → 400
- 持ち主の ToDo で期日があるときだけ、先に予定の枠を取る (insert … on conflict do nothing)。他人・無い → 404・ToDo でない / 期日が無い → 400・もう予定がある → 409
- Google に作る。失敗したら取った枠を消して 502 (Google の 401 は「Google にもう一度ログインしてください」)。成功したら event_id を保存して 200
- 件名と説明はサーバが項目から作る (画面から受け取らない)
- `[perf]` は calendar_ms・db_ms。題・メール・トークンはログに出さない

`GET /api/items/events?projectId=` → 持ち主のプロジェクトの `{ itemId, start, end }` の一覧

画面: 「📅 予定に入れる ToDo」で、まだ予定の無い ToDo に 開始・終了 (空なら終日) と「予定に入れる」。入れた ToDo は「📅 予定 09:00〜09:30」/「📅 予定 (終日)」。今日の ToDo の行にも同じ印

## 3. 実験室の判定

| 規則 | 条件 |
|---|---|
| L1 | `parseTimeRange` (終日・時刻つき・片方だけ・end ≤ start・形違い)・`todoToEvent` (終日の翌日・+09:00・件名と説明)・`upcomingTodos` (今日〜7 日先・KDI は入れない) |
| L2 | POST: 401 (トークン無し)・400・404・409・ToDo でない 400・Google に送る中身はサーバが作る (画面の summary は使わない)・Google 失敗で枠を消して 502・成功で event_id を保存・owner をパラメータで・題・メール・トークンがログに無い |
| L3 | GET: owner と projectId で絞る |
| L4 | 画面の描画: 予定の無い ToDo に時刻の入力と「予定に入れる」(ラベルつき)・予定のある ToDo に印 |
| L5 | `npm test` 全件成功・`tsc` 0・`next build` 成功 |

## 4. 本人の判定

| 判定 | 条件 |
|---|---|
| **定着** | 本人が 7 日のうちに 3 つ以上の ToDo を予定に入れる (item_events の行数・中身は見ない)、かつ一番の困りごとに「予定に入れるのが面倒」を挙げない |
| **巻き戻し** | 違う日・時刻に入る・同じ予定が 2 つできる、と本人が報告した (Human Gate) |
| **判定不能** | 14 日以内に使わない |

## 5. 注意

- 移行 (`item_events`) は本人が実行する。移行前も階層と今日の記録はそのまま動く (別の表のため)
- Google の上限・トークン切れは今の予定の登録と同じ扱い
