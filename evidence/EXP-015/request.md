# EXP-015 事前登録 — モデルを gemini-3.5-flash-lite にする (EXP-014 のやり直し)

Status: **登録済み (変更より前の commit)** / Date: 2026-09-30
きっかけ: EXP-014 の `gemini-2.5-flash-lite` が 404 (提供終了)。本人の実行で `gemini-3.5-flash-lite` が 200・846 ms を確認 (`evidence/EXP-014/result.md`)
**この文書の数値・規則は、測った後で変えない。**

- 仮説・本人の判定は EXP-014 と同じ (1 回の利用で 429 が 0 回・「返事が悪くなった」を挙げない)
- 名前が固定のモデルを選ぶ (`-latest` の別名は中身が替わり、比べられなくなるので使わない)

| 規則 | 条件 |
|---|---|
| L1 | `GEMINI_MODEL` = `gemini-3.5-flash-lite`・両 route がそれを使う (`lib/model.test.ts`) |
| L2 | プロンプトの差分 0 行・`npm test` 全件成功・`tsc` 0 |
| L3 | 本物の API で 1 回 200 (本人の実行で確認済み・`evidence/EXP-014/result.md`) |
