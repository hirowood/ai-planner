# EXP-038 事前登録 — KPI を AI と話しながら変える (期限や状況に合わせて)

Status: **登録済み (変更より前の commit)** / Date: 2026-10-02
仕様: `docs/product-spec.md` §0 (KPI は仮置き・期限までに KGI に届かなそうなら壁打ちしながら変える)
きっかけ: 本人「KPI は変更可 (期限など状況で AI と話しながら変えてよい)」
今の状態: AI は KPI の見直しを相談できるが、階層の KPI を書き換えられない (手で直すしかない)
**この文書の数値・規則は、測った後で変えない。**

## 1. 仮説と範囲

- H1: AI が進み具合と期限を見て KPI の変え方を提案し、本人が同意したら AI がその KPI を書き換えれば、KPI を手で直す手間なく、期限に合わせて調整できる
- 範囲: AI に KPI を番号つき (K1・K2…) で渡す・AI の返す `kpiChange` を検査してその KPI だけを更新する・画面に知らせる
- 範囲外: KPI を消す・KGI を変える (KGI は固定のまま)・KPI を足す (今の段の決め方のまま)

## 2. 決まり

`lib/kpi-change.ts` (純粋):
- `kpiRefs(items)`: KGI の下の KPI を古い順に K1・K2…と番号づけ
- `parseKpiChange(x, refs, kgiDue)`: `{ ref, title?, target?, dueDate? }`・ref が無い / 知らない → null・変える欄が 1 つも無い → null・title 1〜200・target 0〜200・dueDate は "" か実在の日付で KGI の期限以下・通らなければ null
- `kpiChangeNotice(before, after)`: 「KPI『前』を『後』に変えました」など

`/api/coach`:
- 「#### KPI の番号」を `<Records>` の中に入れる (K1: 題 / 判定基準 / 期日)
- 調整の節に: 期限までに KGI に届かなそうなとき、KPI の変え方 (数・判定基準・期日) を根拠と一緒に 1 つ提案し、**本人が同意したら** `"kpiChange": {"ref": "K1", ...変える欄}` に入れる (確認を重ねない・EXP-035 と同じ)
- サーバは持ち主の KPI だけを `updateItem` で更新する (KGI は変えない)。返事に `kpiChanged: { before, after }`・`[perf]` に `kpi_changed` (真偽)
- 判定待ちの間 (EXP-034) は変えない

画面: `kpiChanged` があれば知らせ、階層を読み直す

## 3. 実験室の判定

| 規則 | 条件 |
|---|---|
| L1 | `kpiRefs` (古い順・KGI の下の KPI だけ)・`parseKpiChange` (知らない ref・変える欄なし・201 字・KGI の期限より後・実在しない日付 → null・期日だけ / 判定基準だけの変更は通る)・`kpiChangeNotice` |
| L2 | `/api/coach`: プロンプトに KPI の番号と変え方の文・kpiChange がその KPI だけに入る (update の値に その id と owner)・不正なら更新しない・KGI は変えない・判定待ちの間は変えない・`kpi_changed`・中身とメールはログに無い |
| L3 | `npm test` 全件成功・`tsc` 0・eslint 0 errors・`next build` 成功 |

## 4. 本人の判定

| 判定 | 条件 |
|---|---|
| **定着** | 本人の使った 14 日のうち 1 回以上 `kpi_changed: true` があり、一番の困りごとに「KPI を直すのが面倒」を挙げない |
| **巻き戻し** | 同意していないのに KPI が変わった・違う KPI が変わった、と本人が報告した (Human Gate) |
| **判定不能** | 14 日以内に使わない |

## 5. 追記 (変更より前・2026-10-02・本人「PDCA で毎日 ToDo を設定して調整して、KDI も都度調整する。評価と調整をして ToDo や KDI など AI と一緒に仮説とデータを取っていく」)

- 変えられるものを **KPI と KDI** にする (KGI は固定のまま)
- 番号: KPI は K1・K2…・KDI は D1・D2…(KDI は棚上げも含め古い順)
- `parseKpiChange` を `parseItemChange(x, refs, kgiDue)` とし、ref が K か D の番号・KDI の期日も KGI の期限以下
- 調整の節: 判定と振り返り (EXP-032・034) の後、伸長 / 改善に合わせて KDI (行動の量・頻度) を変える提案もする。同意したら `"itemChange": {"ref": "D1", ...}` (KPI も同じ形で `"ref": "K1"`)
- 返事は `itemChanged: { level, before, after }`・`[perf]` は `item_changed` (真偽)
- L1・L2 は KPI と KDI の両方で確かめる
