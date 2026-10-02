# EXP-041 実験室の結果 — 右の列を「プロジェクト・スケジュール・手帳」の 3 つに分ける

Date: 2026-10-02 / 事前登録: `request.md` (変更より前に commit e229006)

## 変更

- `app/page.tsx`: 右の列のタブを 📁 プロジェクト (既定)・📅 スケジュール・📒 手帳 に
  - プロジェクト: 中のタブ ✅ タスク (既定)・📝 Plan・📓 ノート。タスク = 今日の ToDo (始める・完了・判定待ち・状態) と「今日のタスクの時刻 (スケジュールに出ます)」
  - スケジュール: アプリ内のカレンダー・選んだ日のタイムスケジュール・選んだ日の「🏠 日常の ToDo」
  - 手帳: 選んでいるプロジェクトの手帳 (日・週・月・これまでのデータ)。日のページは振り返りだけ。プロジェクトが無ければ案内
  - Google の「予定に入れる」の呼び出し (`useItemEvents`) を外した (画面に出していなかった・Google は後で)
- `app/components/DailyPanel.tsx`: `parts` (`todos` / `reflection`)・振り返りで見る「✅ この日の ToDo の結果」(見るだけ)
- `app/components/Schedule.tsx`: `AppCalendarView` が選んだ日の下に部品を置ける (children)・`AppCalendar` は日常の ToDo の欄を置く

## 判定 (事前登録の規則)

| 規則 | 結果 | 根拠 |
|---|---|---|
| L1 | 成立 | `app/components/DailyPanel.test.tsx` (右の列の 3 つ・既定はプロジェクト・中のタブ・タスクは todos・手帳は reflection・プロジェクトが無いときの案内) |
| L2 | 成立 | 同 (todos はボタンあり・振り返りなし / reflection は結果と振り返り・ボタンと状態の選択なし) |
| L3 | 成立 | `app/components/Schedule.test.tsx` (タイムスケジュールの下に日常の ToDo・作るは選んだ日) |
| L4 | 成立 | L1 の案内の文・手帳の中身は EXP-036 のテストのまま |
| L5 | 成立 | `npm test` 823 件合格・`tsc` 0・eslint 0 errors / 13 warnings (前と同じ)・`next build` 成功 |

わざと壊す 6 通り (todos でも振り返り・reflection でもボタン・結果を出さない・既定を手帳に・手帳で reflection を使わない・スケジュールに日常の欄を置かない) はすべて赤。

## 置き換えたテスト

- EXP-020 の「今日のタブが既定」・EXP-039 の「右の列のタブはカレンダー」を、本カードの並びに書き直した

## 残り

- ブラウザでは確かめていない・狭い画面の 2 列は前のまま
