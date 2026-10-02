# EXP-035 実験室の結果 — 確認の繰り返しをやめ、候補をボタン 1 回で足す・すぐ ToDo へ・過去のデータから自分から提案する

Date: 2026-10-02 / 事前登録: `request.md` (変更より前に commit 7503d35・追記 c99623e)

## 変更

- `lib/hierarchy-step.ts`: 段の順を「KDI 0 → kdi / KDI があれば今日の ToDo (3 つずつ) / そろったら KDI を 3 つまで」に (EXP-031 の「KDI 3 つ → ToDo」を置き換え)・`parseCandidates`・`parseCandidateList`・`pickBody`・`choiceButtons`
- `app/api/coach/route.ts`:
  - 本文の `pick` (候補のボタン) は、AI に聞く前に今の段として検査して足す (親と段はサーバ)・足した後の段で決め直す・プロンプトに「### いまユーザーが選んで足した項目」と「確認の質問はせず、次へ」
  - 段の決め方の文: 候補は `candidates` に・記録から根拠を添えて自分から提案・鬼速PDCA の **伸長** (できたことを少し増やす・続ける) と **改善** (できなかったことを小さくする・やり方を変える)・**「よろしいですか」「登録しますか」と確認しない**
  - 返事に `candidates` (足した後の段で検査)・判定待ちの間は pick も候補も無し
- `lib/perf.ts`: `pick_added` (真偽)
- `app/page.tsx`: 候補をボタンの先頭に出し、押すと「『題』にします」と `pick` を送る
- `docs/product-spec.md` §0 の先頭に本人の目的 (PDCA を素早く・挫折せず・コーチとメンター・素早く KGI)

## 判定 (事前登録の規則)

| 規則 | 結果 | 根拠 |
|---|---|---|
| L1 | 成立 | `lib/hierarchy-step.test.ts` (KDI 1 で ToDo 0 → todo・その KDI に 3 つ → kdi (have 1)・KDI 2 で今日 1 → 最初の KDI に todo (have 1)・棚上げの KDI は除く・9 つ → null) |
| L2 | 成立 | 同 `parseCandidates` (have 1 で 2 つまで・明日と空の題は捨てる・kgi / null / 上限は [])・`parseCandidateList`・`pickBody` |
| L3 | 成立 | `lib/hierarchy-coach.test.ts` (pick を AI の前に KGI の下の KPI として足す (値に KGI の id・段・題・判定基準・owner)・足した項目と「確認の質問はせず」・足した後の段で KDI に進む・`pick_added`・不正な pick (空・201 字) は足さない・配列 / 文字列の pick は 400・判定待ちは pick も候補も無し・題とメールはログに無い) |
| L4 | 成立 | 同 「よろしいですか」「登録しますか」と確認しない・「根拠を添えて、自分から提案」・**伸長**・**改善**・`candidates` が返る |
| L5 | 成立 | `app/choice-buttons.test.ts` (候補が先・同じ文は 1 つ・画面は pick を付けて送る)・`npm test` 57 ファイル 753 件合格・`tsc` 0・eslint 0 errors / 10 warnings・`next build` 成功 |

## わざと壊して赤になるか (11/11)

M1 KDI 3 つまで ToDo に行かない・M2 ToDo がそろっても KDI を足さない・M3 pick を足さない・M4 判定待ちでも pick を足す・M5 足した後に段を決め直さない・M6 確認しない約束を外す・M7 伸長と改善を外す・M8 候補を検査しない・M9 pick_added を出さない・M10 pick の形を見ない・M11 候補を先に並べない → すべて赤

## 置き換えたテスト

- EXP-031 の段の順のテスト 3 件・W5 のコーチのテスト・EXP-019 の「同意したときだけ」の確認を、本カードの順と文に書き直した

## 残り

- 本物の Gemini が確認を重ねなくなるか・候補を記録から作るかは本人の利用で見る (定着: `pick_added: true`・巻き戻し: 選んでいない項目が足される)
- ブラウザでは確かめていない
