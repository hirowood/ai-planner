# EXP-020 実験室の結果 — 1 日の記録 (今日の ToDo・〇△×・良かったこと 3 つ・明日はこうする)

Date: 2026-10-01 / 事前登録: `request.md` (変更より前に commit 3c64c78)

## 変更

- `db/schema.sql`: `daily_logs` (1 日 1 件・unique (owner, project_id, day))・`scripts/db-migrate.mjs` の確認一覧に追加
- `lib/daily.ts` (新規・純粋): `parseDailyInput`・`dailyFilled`・`todayTodos`・`dailyText`・`parseDailyLog`・`MARK_LABEL`
- `lib/repo.ts`: `listDailyLogs`・`upsertDailyLog` (持ち主のしまっていないプロジェクトのときだけ・on conflict で上書き)
- `app/api/daily/route.ts` (新規): GET / PUT
- `app/components/DailyPanel.tsx` (新規): `useDaily`・`DailyView`
- `app/page.tsx`: プロジェクトのタブ「☀️ 今日」を最初に置き既定にする・「会話に送る」ボタンは今の送信を使う
- `app/api/coach/route.ts`: `<Records>` に「#### 毎日の記録」・`context_days`。指示の文は変えていない
- `lib/perf.ts`: `context_days`

## 判定 (事前登録の規則)

| 規則 | 結果 | 根拠 |
|---|---|---|
| L1 | 成立 | `lib/daily.test.ts` parseDailyInput 5 件 (今日・7 日前は通る / 8 日前・明日・実在しない日付・形違い・mark 違い・goods 3 個まで・100/101 字・tomorrow 200/201 字・余計な項目は落ちる) |
| L2 | 成立 | 同 todayTodos・dailyText (新しい順・7 件・全角化・「(まだ無し)」)・parseDailyLog |
| L3 | 成立 | `lib/daily-route.test.ts` 401・400 ×5・PUT は on conflict と archived_at の確認で owner をパラメータに・他人 404・GET は owner と projectId で絞る・`[perf]` 1 行で許可項目だけ・中身とメールはログに無い |
| L4 | 成立 | 同 `<Records>` の中に「- 2026-09-30 × / 良かったこと: … / 明日は: …」・context_days 1 |
| L5 | 成立 | `app/components/DailyPanel.test.tsx` 既定のタブ (page.tsx の文で確かめる・弱い)・fieldset と legend のラジオ 3 つ・選ぶまで保存できない・ToDo 無しの案内とボタン・4 つで「3 つに絞ると」・今日の記録を入れておく・保存後のボタン |
| L6 | 成立 | `npm test` 49 ファイル 662 件合格 (638 → 662)・`tsc` 0・eslint 0 errors / 10 warnings (前と同じ)・`next build` 成功 (`/api/daily`) |

## わざと壊して赤になるか (10/10)

M1 未来の日付を通す・M2 8 日前も通す・M3 goods を 3 個で切らない・M4 101 字を通す・M5 プロジェクトの持ち主を確かめない・M6 GET を owner で絞らない・M7 記録を neutralize しない・M8 coach に記録を渡さない・M9 3 つを超えても案内しない・M10 新しい順にしない → すべて赤

## 残り

- 移行: 本人が `node --env-file=.env.local scripts/db-migrate.mjs` を実行する (`daily_logs` が出れば成功)。移行前は「今日」タブで「記録を読み込めませんでした」になる
- 「今日」は日本時間の日付。日付をまたいで開いたままの画面は読み直すまで前の日のまま
- 週末の Check・Action 欄 (NOLTY の型) は次のカード
- 安全と a11y のレビューは子 agent の上限解除 (2026-10-05) 後
