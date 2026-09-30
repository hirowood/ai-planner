# 新しい依存: @neondatabase/serverless — Date: 2026-09-30

| 項目 | 内容 |
|---|---|
| 目的 | Vercel の Postgres (Neon) へ route handler から問い合わせる (EXP-008) |
| 出所 | npm `@neondatabase/serverless` / repository `github.com/neondatabase/serverless` (Neon 公式) |
| 版 | **1.1.0** (`--save-exact`・`npm view` の最新・更新 2026-04-17) |
| ライセンス | MIT |
| 依存の広がり | 直接の依存なし (`dependencies` 無し)・package-lock の追加は 10 行 |
| 既存で代わりになるもの | なし (repo に DB クライアントが無い)。Vercel の Neon 連携が案内する標準の driver |
| リスク | SQL の組み立て: tagged template だけを使う (値は必ずパラメータ)。`sql.query()` に文字列を連結して渡さない (request.md §2) |
| 確認 | `npm ls` で 1.1.0・`npm test` 73 件合格のまま (入れる前と同じ) |
