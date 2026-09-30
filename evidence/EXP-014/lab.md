# EXP-014 実験室の判定 — Date: 2026-09-30

| 規則 | 確認 | 結果 |
|---|---|---|
| L1 | `lib/model.test.ts` (3 件): `GEMINI_MODEL` = `gemini-2.5-flash-lite`・`/api/chat` と `/api/plan/chat` の両方で getGenerativeModel に渡った model が `GEMINI_MODEL` (偽の Gemini に lastModel を足して確かめた) | **成立** |
| L2 | 差分は import 1 行とモデル名の 1 行だけ (両 route)。プロンプトの差分 0 行 | **成立** |
| L3 | chat・plan/chat・model のテスト 38 件合格・`tsc` 0 (全体の実行は EXP-010 と一緒に行う) | **成立** (全体は EXP-010 の RUN で再確認) |

実験室の Gemini は差し替えなので、軽いモデルで返事の質・JSON の読み取りがどうなるかは測れない。本人の利用で見る (本物の 1 日の上限も、ここでは分からない)。
