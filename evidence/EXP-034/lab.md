# EXP-034 実験室の結果 — ToDo を「実行中」にし、「完了」で AI が判定の質問から C → A → 次の Plan へ

Date: 2026-10-02 / 事前登録: `request.md` (変更より前に commit 5cdae83)

## 変更

- `lib/plan-items.ts`: 状態 `doing` = 「実行中」(未実行 → 実行中 → 実行 → …)。「実行」は完了・判定待ちとして扱う
- `lib/judgement.ts` (新規・純粋): `pendingJudgement`・`parseJudgement`・`completeMessage`・`judgedNotice`・`JUDGEMENT_CHOICES`
- `lib/repo.ts`: `judgeItem` (持ち主の ToDo で今「実行」のときだけ判定の状態にする)・過去の傾向の数に `doing`
- `app/api/coach/route.ts`: 「### 判定を待っている ToDo」の節 (判定基準に沿った質問 1 つ・候補 3 つ・決まったら `judgement`・C → A → 次の Plan の順・判定待ちの間は items を足さない)・判定をその ToDo にだけ入れる・返事に `judged`
- `lib/perf.ts`: `judgement_applied` (真偽)
- `app/components/DailyPanel.tsx`: 今日の ToDo に「▶ 始める」(未実行)・「✓ 完了」(実行中)・「判定待ち・AI と判定する」(実行)。状態の選択は残す
- `app/page.tsx`: 「✓ 完了」で実行にしてから会話へ「『題』を完了しました。判定をお願いします」・判定のお知らせと階層の読み直し

## 判定 (事前登録の規則)

| 規則 | 結果 | 根拠 |
|---|---|---|
| L1 | 成立 | `lib/judgement.test.ts` 7 件 (実行中のラベルと順・一番新しく更新した「実行」・実行中 / 成功 / 未実行 / KDI は外す・6 日前は入れ 7 日前と未来は外す・判定の値・文) |
| L2 | 成立 | `app/components/DailyPanel.test.tsx` 未実行に「始める」・実行中に「完了」・実行に「判定待ち・AI と判定する」・判定済みはボタン無し・ラベルつき・記号は aria-hidden・状態の選択に「実行中」 |
| L3 | 成立 | `lib/hierarchy-coach.test.ts` 6 件 (節と候補 3 つと C → A → 次の Plan・判定待ちの間は items を足さない・判定は一番新しく完了した ToDo にだけ (値に その id と owner・`status = 'done'` の条件)・空 / 知らない値 / 無い → 更新しない・判定待ちが無ければ更新しない・`judgement_applied`・題とメールはログに無い) |
| L4 | 成立 | `npm test` 56 ファイル 740 件合格 (726 → 740)・`tsc` 0・eslint 0 errors / 10 warnings・`next build` 成功 |

## わざと壊して赤になるか (10/10)

M1 実行中も判定待ちにする・M2 古い方を選ぶ・M3 7 日前も入れる・M4 判定を検査しない・M5 判定待ちでも items を足す・M6 判定の節を入れない・M7 judgement_applied を出さない・M8 判定済みでも上書きできる・M9 始めるボタンを出さない・M10 完了ボタンを出さない → すべて赤

## 置き換えたテスト

- 「知らない状態」の例に使っていた `doing` は本カードで正しい状態になったので、例を `in_progress` に替えた (EXP-017 の 4 件)
- 状態の定数・過去の傾向の数・PlanTree の状態のラベルに「実行中」を足した

## 残り

- 本物の Gemini が「答えてから判定を入れる」を守るかは本人の利用で見る (巻き戻し: 答えていないのに判定が入る・違う ToDo に入る)
- 「✓ 完了」は状態の更新が終わってから会話に送る。更新が失敗したときは会話は送るが判定待ちにならない (その場合 AI は判定の節を出さない)
- ブラウザでは確かめていない
