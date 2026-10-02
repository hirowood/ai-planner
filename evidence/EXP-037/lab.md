# EXP-037 実験室の結果 — 作るときに SMART の KGI に続けて KPI も仮置きする・候補は過去のデータから

Date: 2026-10-02 / 事前登録: `request.md` (変更より前に commit 8151256)

## 変更

- `lib/setup-kpi.ts` (新規・純粋): `parseKpiDrafts` (3 個まで・題 1〜200・判定基準 0〜200・期日は "" か今日〜KGI の期限)・`mergeKpiDrafts`・`setupKpisReady`
- `app/api/setup/route.ts`: 本文の `kpis`・SMART がそろうと「KPI (仮置き)」の段 (仮置き・あとで AI と話しながら変えられる・候補は choices・決まったら確認を重ねず kpis)・過去のプロジェクト (owner の 5 件・`summarizePast`) を `<Past>` として渡す (DB が無い・読めないときは「(まだ無し)」)・返事に `kpis`・ready は KPI 1 つ以上
- `app/api/setup/create/route.ts`: KPI が 1〜3 個で全部が通らなければ 400 (DB より前)・KGI の下に KPI を作る・row_count に足す
- `app/components/SmartPanel.tsx`: 「KPI (仮置き・あとで AI と話しながら変えられます)」の欄 (題・判定基準・期日 (KGI の期限まで)・消す・足す)
- `app/page.tsx`: KPI の下書きを持ち、送る・受け取る・作る
- `lib/setup-start.ts`: 作った直後の一言を KDI へ (EXP-029 の「KPI へ」を置き換え)

## 判定 (事前登録の規則)

| 規則 | 結果 | 根拠 |
|---|---|---|
| L1 | 成立 | `lib/setup-kpi.test.ts` (3 個まで・空の題・201 字・昨日・期限より後・2/30 は捨てる・期日なしと期限の日は通る・merge・作れるか) |
| L2 | 成立 | 同 (SMART がそろうと KPI (仮置き) の段・「仮置き」「AI と話しながら変えられます」・過去のプロジェクトが入り owner で読む・AI の kpis が入り期限より後は捨てる・ready・DB が無くても 200・メールはログに無い) |
| L3 | 成立 | `lib/smart.test.ts` (KPI 無し・空・期限より後・題の空を含む → 400 で DB を呼ばない・KGI の下に KPI を作る (値に "kpi" と KGI の id)・row_count 4) |
| L4 | 成立 | `lib/setup-kpi.test.ts` (KPI の欄・仮置きの文・次に決める・足す・消す・期日の max は KGI の期限)・`lib/smart.test.ts` (作れない理由の文) |
| L5 | 成立 | `npm test` 783 件合格・`tsc` 0・eslint 0 errors / 10 warnings・`next build` 成功 |

わざと壊す 9 通り (期限より後を通す・昨日を通す・3 個で切らない・KPI 無しでも ready・仮置きの文を外す・過去のデータを渡さない・KPI 無しでも作る・KPI を作らない・作った後の一言が KPI のまま) はすべて赤。

## 置き換えたテスト

- EXP-029 の「階層の順の文」と「作った直後は KPI へ」・EXP-018 の作る API (KPI を足して送る) と作れない理由の文

## 残り

- 本物の Gemini が KPI を気軽に決めさせるか・候補が過去のデータを使うかは本人の利用で見る
- ブラウザでは確かめていない
