# EXP-042 実験室の結果 — 手帳にノート (仮説・検証結果) を入れる

Date: 2026-10-02 / 事前登録: `request.md` (変更より前に commit bc70367)

## 変更

- `lib/projects.ts`: `HYPOTHESIS_NOTE` (仮説)・`RESULT_NOTE` (検証結果)・`TECHO_NOTE_KINDS` (仮説・検証結果・事実・データ・考え)
- `app/components/NotesPanel.tsx`: `presets`・`defaultKind`・`filters` (すべて / 種類で絞る・件数・aria-pressed)・`initialFilter`
- `app/components/Techo.tsx`: `beforeStats` (これまでのデータの前に置くもの)
- `app/page.tsx`: 手帳の欄に「📓 ノート (仮説・検証結果)」(既定は仮説・絞り込みは 仮説 / 検証結果)・プロジェクトの中のタブは ✅ タスク・📝 Plan の 2 つ

## 判定 (事前登録の規則)

| 規則 | 結果 | 根拠 |
|---|---|---|
| L1 | 成立 | `app/components/NotesPanel.techo.test.tsx` (選択肢の順は 仮説・検証結果・事実・データ・考え・既定で選ばれているのは仮説だけ・検証結果は文字のまま通る・手帳は defaultKind に仮説) |
| L2 | 成立 | 同 (すべて 4・仮説 2・検証結果 1・仮説で絞ると仮説だけと見出し・絞り込みが無ければボタンなし) |
| L3 | 成立 | 同 (手帳の日のページ → ノート → これまでのデータの順・page に見出しと絞り込み)・`app/components/DailyPanel.test.tsx` (プロジェクトの中はタスク・Plan・ノートの欄が無い) |
| L4 | 成立 | `npm test` 826 件合格・`tsc` 0・eslint 0 errors / 13 warnings (前と同じ)・`next build` 成功 |

わざと壊す 5 通り (仮説を選択肢に入れない・既定を事実のまま・絞り込みを効かせない・ノートを手帳に置かない・件数を数えない) はすべて赤。最初は 2 通り (既定・絞り込み) を捕まえられず、テストを強めた (page の既定を確かめる・最初の絞り込みで一覧を確かめる)。

## 置き換えたテスト

- EXP-041 の「プロジェクトの中は タスク・Plan・ノート」を「タスク・Plan」に

## 残り

- ブラウザでは確かめていない・仮説と検証結果を結びつける仕組みは無い
