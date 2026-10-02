# 画面の崩れの修正 (2026-10-02・本人のスクリーンショット 2 枚)

## 観察 (スクリーンショット 14:52:23・14:52:40)
1. 右の列の今日の ToDo: 題と判定基準が 1 文字ずつ縦に並び、状態の選択が列の幅いっぱいに広がっている
2. 画面全体: アプリが画面の上 1/3〜1/2 にしか無く、下が白い。先頭の見出し「AI Planner」が見えない (ページが下へずれている)

## 原因 (コードを読んで確かめた)
1. `DailyPanel.tsx` の状態の選択に `w-full` (inputClass) と `w-auto` を同時に付けていた。`w-full` が効き、flex の中で題の幅がほぼ 0 になった
2. 〇△× のラジオは `sr-only` (position: absolute)。位置の基準 (relative) が無く、右の列 (overflow-y-auto) の外へ出てページの高さを伸ばしていた。〇△× を押すとそのラジオにフォーカスが移り、ブラウザがページを下へ動かす (本人の「なんかやったら崩れた」に合う)

## 直したこと
- 状態の選択は `selectClass` (`w-auto shrink-0`・`w-full` なし)。題は `min-w-0 flex-1 break-words`
- 〇△× のラベルに `relative`
- 画面の外枠に `overflow-hidden`、左右の列に `relative min-w-0` (列の中のほかの sr-only (KindPicker・NotesPanel・PlanTree) も列に留める)

## 確かめたこと
- `app/components/layout.test.tsx` 4 件 (選択の class・題の class・ラベルの relative・外枠と列の class)。直す前の形に戻す 5 通りはすべて赤
- `npm test` 726 件合格・`tsc` 0・eslint 0 errors / 10 warnings・`next build` 成功
- **ブラウザでは確かめていない** (拡張がつながらない)。本人の画面で確かめる

## 学び
- `sr-only` を使う部品は、位置の基準 (relative) の中に置く。テストは class の文字列しか見ていないので、見た目の崩れはブラウザで見るまで分からない
