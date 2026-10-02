# EXP-044 実験室の結果 — 会話の質: チャットによってモデルを分ける・返答の形・繰り返しの禁止

Date: 2026-10-02 / 事前登録: `request.md` (変更より前に commit cf194fa)

## 変更

- `lib/model.ts`: `GEMINI_MODEL_DEEP = "gemini-3.5-flash"`・`DEEP_MODEL_VERIFIED = false`・`modelFor(use, verified)`
- `lib/gemini-retry.ts`: `withModelFallback(run, primary, fallback)` (404 / 429 で今のモデルに 1 回だけ・status と文の番号の両方を見る)
- `lib/question-repeat.ts` (新): `lastQuestion`・`isRepeatQuestion`
- `lib/perf.ts`: `model_fallback`・`question_repeat` (真偽だけ)
- `app/api/coach/route.ts`: 返答の形 ①受け止め ②記録に基づく所見 ③提案を 1 つか質問を 1 つ・「### 会話の質」(同じ質問をしない・具体的に・記録に結びつける)・モデルは `modelFor(thread)` を替えつきで
- `app/api/setup/route.ts`: `modelFor("setup")` を替えつきで・決まり 8 (同じ質問をしない)
- `scripts/probe-model.mjs` (新): モデルの名前と ok / failed (状態) だけを出す

## 判定 (事前登録の規則)

| 規則 | 結果 | 根拠 |
|---|---|---|
| L1 | 成立 | `lib/model-deep.test.ts` (確かめたら chat / kgi / kpi / setup は上位・kdi / todo は今のモデル・既定は未確認で全部今のモデル・404 / 429 を status と文の両方で 1 回だけ替える・500 は投げる・同じモデルなら 1 回)・`lib/hierarchy-coach.test.ts` (5 つの会話で lastModel が今のモデル・`model_fallback: false`) |
| L2 | 成立 | `lib/question-repeat.test.ts`・`lib/hierarchy-coach.test.ts` (同じ質問で `question_repeat: true`・違えば false・中身はログに出ない) |
| L3 | 成立 | `lib/coach-persona.test.ts` (返答の形)・`lib/hierarchy-coach.test.ts` (会話の質の 3 つの文)・`lib/model-deep.test.ts` (setup の決まり 8) |
| L4 | 成立 | `lib/model-deep.test.ts` (道具の出力の行にキー・返事の中身が無い) |
| L5 | 成立 | `npm test` 863 件合格・`tsc` 0・eslint 0 errors / 13 warnings (前と同じ)・`next build` 成功 |

わざと壊す 6 通り (繰り返しを測らない・既定を確認済みに・status の道を外す・文の番号の道を外す・会話の質の節を消す・setup の決まり 8 を消す) はすべて赤。最初は「替える条件を status だけ壊す」を捕まえられず (テストの失敗の文に番号が入っていた)、status だけ・文だけの失敗を分けて確かめるようにした。

## 置き換えたテスト

- EXP-022 の返答の形「③次の一歩の問い」を「③提案を 1 つか質問を 1 つ」に (`lib/coach-persona.test.ts`)

## 残り

- **上位のモデルはまだ使っていない** (`DEEP_MODEL_VERIFIED = false`)。本人が `node --env-file=.env.local scripts/probe-model.mjs` を実行し、`gemini-3.5-flash: ok (200)` なら true にする (事前登録どおりの手順・その変更は別の commit で記録する)
- 本人の判定 (点数・`question_repeat` の割合) は `[perf]` を集めてから
