# EXP-001 事前登録 — `api/chat` のストリーミング化

Status: **登録済み (改善の変更より前の commit)** / Date: 2026-09-29
PRD: `D:/CLAUDE-CODE/docs/prd/2026-09-29--app-measure-improve-loop--prd.md` / tasks: T-020
根拠: `evidence/M0-E2/breakdown.md` (T-005 の決定)・`evidence/M1-LAB/variance.md` (閾値)

**この文書の数値・規則は、測った後で変えない。** 変える必要が出たら EXP-002 として登録し直す。

## 1. 仮説

`api/chat` の返答を全文生成を待ってから返すのをやめ、Gemini の生成分を順に送る (ストリーミング) にすれば:

- **H1 (主)**: 最初の文字がクライアントへ届くまでの時間 (`first_chunk_ms`) が、全体の時間 (`total_ms`) より大きく短くなる
- **H2 (副・悪化しないこと)**: 全体の時間 (`total_ms`) は変わらない
- **H3 (振る舞い)**: 返答の中身は変わらない (チャンクをつなげた文字列 = これまでの `reply`)。予定 JSON の抽出と登録の流れも変わらない

根拠 (M0-E2, ローカル, n=5): chat の `total_ms` 中央値 8,283.9ms のうち gemini 8,250.5ms (99.6%)。本人は毎回 3.3〜9.4 秒、何も表示されないまま待っている。

範囲: **呼び方だけを変える。** モデル (`gemini-2.5-flash`)・プロンプト・履歴の上限 (10 件) は変えない (PRD の範囲)。

## 2. 対象と指標

- 対象 route: `app/api/chat/route.ts` と、その表示側 `app/page.tsx` (受け取ったチャンクを順に表示する)
- 指標 (`[perf]` 行):
  - `total_ms`: handler の入口から、ストリームを閉じるまで
  - `gemini_ms`: Gemini のストリームを読み切るまでの時間
  - **`first_chunk_ms` (新規の所要時間の項目)**: handler の入口から、最初のチャンクをレスポンスへ書き出すまで
    - 改善前は全文を 1 回で返すので、定義上 `first_chunk_ms = total_ms` になる。比較にはこの値を使う
    - 値は時間だけ。本文を出さない制約 (PRD US1) は変わらない。`[perf]` の許可項目は 6 つになる
- `Server-Timing` (契約の変更):
  - ストリームではヘッダが本文より先に出るので、全体の時間は載せられない
  - chat だけ `Server-Timing: headers;dur=<ヘッダを送るまでの ms>` にする
  - 全体・最初のチャンクは `[perf]` 行で測る
  - 他の route は変えない

## 3. 実験室 (M1 のベンチ) の判定

条件 (固定):
- `npm run bench`、n=20・warm-up 3
- Gemini の差替えはストリーム版: **10 チャンクを 10ms 間隔 = 合計 100ms**。改善前の 100ms 一括と同じ合計時間にする
- ベースラインは `evidence/M1-LAB/bench-run-a.json` の `api/chat` (commit `3f43c3c` 相当の条件)
- 候補は改善後の commit で `--label exp001-candidate`
- **閾値 = 2.12ms** (T-013 の chat `total_ms` の 2 × stdev)。`first_chunk_ms` の改善前は `total_ms` と同じなので、同じ閾値を使う

判定 (`npm run bench:compare`, 機械的):

| 規則 | 条件 | 結果 |
|---|---|---|
| R1 (H1) | ベースライン `total_ms` median − 候補 `first_chunk_ms` median > 2.12ms | 満たせば H1 を支持。満たさなければ **不採用** |
| R2 (H2) | 候補 `total_ms` median − ベースライン `total_ms` median ≤ 2.12ms | 超えたら **worse** (ストリーミングの上乗せが大きすぎる) → 不採用 |
| R3 (H3) | `npm test` 全件成功 + 「チャンクをつなげた返答 = 差替えの全文」のテスト | 1 件でも赤なら不採用 |

R1〜R3 がすべて満たされたときだけ PR に進む (T-022)。

## 4. 現場 (本番) の判定

- 本番には改善前の `[perf]` の値が無い (R-008)。そこで絶対値では比べず、**本番の中での比 `first_chunk_ms / total_ms` で判定する**。改善前は定義上この比が 1.0 なので、改善前の本番データは要らない
- 件数基準 (OQ-4 を 1 周目の値として確定): **status 200 の `api/chat` 行 20 件**。本人の利用で約 5 件/回なので [推測] 約 4 回分
- 監視窓: マージ (本番反映) から **14 日**。20 件に届かなければ判定不能

| 判定 | 条件 (20 件以上の時点で評価) |
|---|---|
| **定着** | 比 `first_chunk_ms / total_ms` の中央値 ≤ 0.5、かつ status 5xx の割合 ≤ 10% |
| **巻き戻し** | 比の中央値 > 0.8、または 5xx の割合 > 10% |
| **判定不能** | 14 日で 20 件に届かない、または 0.5 < 比の中央値 ≤ 0.8 |

- 巻き戻しは本番への作用なので Human Gate。Claude は提案まで (PRD Open Question)
- `total_ms` の本番値は参考として記録するだけ (M0-E2 はローカル・n=5 で本番の基準にならない)

## 5. P2-A (US6)

Preview の画面に対して A11Y_AUTOMATED の 1 レーンだけを行う (OQ-6 を 1 周目の値として確定)。結果は `D:/CLAUDE-CODE/schemas/design-verification-result.schema.json` に適合させる (T-022)。

## 6. カードの置き場所 (OQ-6)

`ai-planner/evidence/EXP-001/` (このディレクトリ)。
- `request.md`: 本書
- `order.txt`: commit 順の証拠 (T-021)
- `result.md`: 判定 (T-024・T-034)
- `field.jsonl`: 本番から回収した `[perf]` 行

CLAUDE-CODE 側は P2-A の型付き判定とリンクだけを持つ。
