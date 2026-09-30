# EXP-012 実験室の判定 — Date: 2026-09-30

小さなカードなので、子 agent を起動せず親が直接作った (起動の手間の方が大きいと判断・`docs/cycle-lessons.md` に記録する)。

| 規則 | 確認 | 結果 |
|---|---|---|
| L1 検査 | `lib/custom-kind.test.ts`: 既定の 6 つが通る・「健康」「読書メモ」が通り前後の空白を外す・20 字は通り 21 字は null・空・空白だけ・改行・タブ・数字・null は null・`toString` は既定の値と見なさない | **成立** |
| L2 表示 | `categoryLabel` / `noteKindLabel`: 既定は 習慣 / 考え、自由入力はそのまま | **成立** |
| L3 画面 | `KindPicker.test.tsx`: 既定の 3 つ + 「その他」のラジオが同じ name・既定を選んでいる間は入力欄なし・「その他」でラベルつきの入力欄 (20 字まで) | **成立** |
| L4 壊さない | `npm test` 193 件合格 (持ち主の絞り込みのテストを含む)・`tsc` 0・lint 0 errors (10 warnings・前と同じ)・`next build` 成功 | **成立** |
| L5 本物の DB | 移行を流し直して制約を外し、自由入力の種類で作る | **未実施** (本人のローカル確認) |

EXP-008 の「知らない種類は null / 400」を確かめていたテスト 4 件は、このカードで置き換えた規則なので「21 字の種類」に書き換えた (EXP-008 の判定は当時のまま)。

計器の確認 (変異):
- 自由入力を全部 null にする → 3 件が赤
- 制御文字の検査を外す → 2 件が赤 (改行・タブ)
- 戻すと 193 件合格

表: `db/schema.sql` の create から check 制約を外し、既にある表向けに `alter table ... drop constraint if exists projects_category_check / notes_kind_check` を足した (何度流しても同じ)。字数の上限は API の検査で守る (表では守らない)。
