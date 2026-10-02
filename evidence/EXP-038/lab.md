# EXP-038 実験室の結果 — KPI と KDI を AI と話しながら変える

Date: 2026-10-02 / 事前登録: `request.md` (変更より前に commit 8151256・追記 e5bc0dd で KDI も対象に)

## 変更

- `lib/item-change.ts` (新規・純粋): `itemRefs` (KGI の下の KPI を K1…・その下の KDI を D1…・古い順・棚上げも含む)・`itemRefsText`・`parseItemChange` (知らない番号・変える欄なし・同じ値だけ・201 字・KGI の期限より後・実在しない日付 → null)・`itemChangedNotice`
- `app/api/coach/route.ts`: `<Records>` に「#### KPI と KDI の番号」・「### KPI と KDI を変える」の節 (KPI は仮置き・KDI は都度調整・KGI は変えない・根拠を添えて 1 つ提案・同意したら確認を重ねず `itemChange`)・同意した変更をその項目にだけ `updateItem` で入れる (判定待ちの間は変えない)・返事に `itemChanged`
- `lib/perf.ts`: `item_changed` (真偽)・`app/page.tsx`: 知らせて階層を読み直す

## 判定 (事前登録の規則・追記の KDI を含む)

| 規則 | 結果 | 根拠 |
|---|---|---|
| L1 | 成立 | `lib/item-change.test.ts` (番号 K1・K2・D1・D2・KGI と ToDo は入らない・全角化・KPI の判定基準だけ / KDI の題と期日を変えられる・小文字の番号・null になる 9 通り・お知らせ) |
| L2 | 成立 | `lib/hierarchy-coach.test.ts` (番号と変え方の文・KPI の変更がその KPI にだけ (値に その id と owner)・KDI の題も変えられる・知らない番号 / 期限より後 / 変える欄なし / 無い → 変えない・判定待ちの間は変えない・`item_changed`・中身とメールはログに無い) |
| L3 | 成立 | `npm test` 61 ファイル 795 件合格・`tsc` 0・eslint 0 errors / 10 warnings・`next build` 成功 |

わざと壊す 7 通り (期限より後を通す・変える欄なしでも通す・KDI に番号を付けない・判定待ちでも変える・番号をプロンプトに入れない・item_changed を出さない・検査しない) はすべて赤。

## 残り

- 本物の Gemini が「同意したときだけ」変えるかは本人の利用で見る (巻き戻し: 同意していないのに変わった・違う項目が変わった)
- KPI・KDI を消す・足すのは今の流れのまま (足すは EXP-035 の候補)
