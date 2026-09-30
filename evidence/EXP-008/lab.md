# EXP-008 実験室の判定 — Date: 2026-09-30

最初の並列サイクル (計画と実績: `docs/plans/EXP-008.json`)。

| 規則 | 確認 | 結果 |
|---|---|---|
| L1 検査 | `lib/projects.test.ts` 48 件 (境界値・知らない種類・UUID・オブジェクトでない値・trim) | **成立** |
| L2 持ち主 | `lib/repo.test.ts` 14 件: 全関数で owner がパラメータ・`owner =` の直後に owner の値 (絞り込み)・createNote は projects の副問い合わせの中で絞る・他人は null / false | **成立** (下の計器の確認で穴を 1 つ埋めた後) |
| L3 API | `app/api/projects`・`app/api/notes` の route テスト (401・400・201・200・204・404・503)・`[perf]` 1 行・許可項目だけ・名前・目的・本文・メールがログに出ない | **成立** |
| L4 画面 | `ProjectPanel.test.tsx` 7 件 (作成欄のラベル・種類のラジオ・ノートの欄)。「📁 プロジェクト」「📅 予定」の切り替えは page.tsx にあり、テストは無い (a11y レビューで確認) | **成立** |
| L5 壊さない | `npm test` 173 件合格・`tsc` 0・lint 0 errors (10 warnings: 既存 9 + `app/api/projects/route.ts` の未使用引数 `_req` 1)・`next build` 成功・チャットのプロンプトの差分 0 行 | **成立** |
| L6 DB | 本物の Neon で移行 | **未実施** (本人が接続を設定した後) |

## 計器の確認 (わざと壊して赤になるか)

| 壊した箇所 | 赤 |
|---|---|
| M1 `deleteNote` から `and owner = ${owner}` を外す | 4 件 |
| M2 `listNotes` から `owner = ${owner}` を外す | 2 件 |
| M3 `createNote` の projects の副問い合わせから `and owner = ${owner}` を外す | **最初は 0 件 (穴)** → テストを足して 2 件 |

M3 の穴: owner は insert の値にも入るので「owner がパラメータに入る」だけの検査では、他人のプロジェクトへ書ける変更 (IDOR) を見逃していた。実装は正しかった (安全レビューでも ok) が、将来の変更を止められなかった。

## レビュー

- 安全 (generic-security-reviewer): blocking 0。warn: DB のエラー文をそのままログに出す → **直した** (エラー名と Postgres の code だけ)。本文の大きさの上限なし・CSRF は SameSite=Lax で悪用不可・トークン更新失敗の扱いは範囲外 → 残す
- a11y (a11y-reviewer): blocking 2 → **直した** (削除・取り消し後のフォーカスの行き先・入力欄の枠 gray-300 → gray-500)。warn のうち成功の読み上げ・削除待ちの読み上げ・Escape で取り消し・絵文字を読ませない を直した。残す: 入力エラーと欄の結び付け (aria-describedby)・タブの矢印キー・選択中の見た目の印
- ブラウザと読み上げソフトでの実際の動きは未確認 (本人のローカル確認で見る)
