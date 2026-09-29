# M0-E1 計測点の置き方 (T-001)

PRD: `D:/CLAUDE-CODE/docs/prd/2026-09-29--app-measure-improve-loop--prd.md` (US1)
Date: 2026-09-29 / branch `perf/loop-1`

## 仕組み

`lib/perf.ts` の `startPerf(route, parts)` を、各 route の export された関数の 1 か所で使う。
既存の処理は `handle()` に移し、分岐には手を入れていない。

```text
export POST/GET
  → perf = startPerf(...)
  → perf.finish(await handle(...))      // handle のどの return でも 1 行出る
  → handle が throw したら status 500 で 1 行出してから再 throw
```

外部呼び出しは `perf.time("gemini_ms" | "calendar_ms", fn)` で囲み、所要時間を加算する。

## ログに出る値 (これ以外は出ない)

`[perf] {"route":…,"status":…,"total_ms":…,"gemini_ms":…,"calendar_ms":…}`

| 項目 | 由来 |
|---|---|
| `route` | 呼び出し側が渡す固定文字列 (`api/chat` / `api/calendar/get` / `api/calendar/create` / `page:/ initial-calendar`) |
| `status` | 返した Response の status |
| `total_ms` | export 関数の入口から `finish` まで |
| `gemini_ms` | `chat.sendMessage` の前後 (chat のみ) |
| `calendar_ms` | Calendar への `fetch` と `response.json()` の前後。create はイベント数ぶんの合計 |

- `PerfLine` 型はこの 5 項目しか持たない。本文・予定・セッション・トークンを渡す引数は無い。
- `Server-Timing` ヘッダには `total` / `gemini` / `calendar` の値だけを載せる。

## route × return 経路

| route | 経路 | `[perf]` 行 | 確認方法 |
|---|---|---|---|
| `api/chat` | 401 未ログイン | 出る | **実測** (`next start` + curl。status 401・`Server-Timing` あり) |
| `api/chat` | 400 (JSON 不正・body 不正・message / history 不正・空・2000 字超) / 429 / 500 (catch) / 200 | 出る | コード構造 (全て `handle` の return → `finish`)。実測は M1 のテストで |
| `api/chat` | handle の外への throw | status 500 で出る | コード構造 |
| `api/calendar/get` | 401 未ログイン | 出る | **実測** |
| `api/calendar/get` | 401 token 期限切れ / Google の非 2xx / 502 形式不正 / 500 / 200 | 出る | コード構造 |
| `api/calendar/create` | 401 未ログイン | 出る | **実測** |
| `api/calendar/create` | 400 (JSON 不正・events 無し・構造不正・21 件以上) / 500 / 200 | 出る | コード構造 |
| `page:/ initial-calendar` | 最初の `/api/calendar/get` 完了時に 1 回 (ブラウザの console) | 出る | コード構造。`total_ms` はナビゲーション開始からの経過時間 |

実測時の値 (2026-09-29, ローカル `next start`, 未ログイン):

```text
[perf] {"route":"api/chat","status":401,"total_ms":5.1,"gemini_ms":0}
[perf] {"route":"api/calendar/get","status":401,"total_ms":0.7,"calendar_ms":0}
[perf] {"route":"api/calendar/create","status":401,"total_ms":0.7,"calendar_ms":0}
```

本文の漏れの確認: chat へ `secret-body-canary` を含む body を送り、サーバログに 0 件だった。
ただし 401 の経路は body を読む前に返るので、この確認は弱い。本文の非出力は型の構造で担保し、
ログイン後の経路の確認は M1 (T-011) のテストで行う。

## token refresh の時間 (OQ: どこに数えるか)

`getServerSession(authOptions)` は jwt callback 経由で `refreshAccessToken` (`app/api/auth/[...nextauth]/route.ts` の `fetch`) を同じリクエストの中で呼ぶことがある。

- **どの項目にも振り分けず、`total_ms` にだけ入る。** 「自分のコード」の時間 = `total_ms - gemini_ms - calendar_ms` とすると、refresh が起きたリクエストではこの値が refresh 分だけ大きく出る。
- 頻度は access token の期限切れごと ([推測] Google の既定で約 1 時間に 1 回・ユーザーごと)。
- 5 項目の制約を保つため `auth_ms` は足していない。M0-E2 の内訳で自分のコードの時間に外れ値が出たら、まず refresh を疑う。

## 同時に行ったログの修正 (tasks.md R-003)

実行ログを回収する前提になったので、予定の内容が入るログを外した:
- `app/api/calendar/create/route.ts`: `Failed to create event "<summary>"` と `Network error for event "<summary>"` を、タイトルを含まない文言に変更
- `app/api/calendar/get/route.ts`: 形式不正時の `console.error(..., data)` (Google の応答全文) を、形 (`kind` と key 名) だけの出力に変更

## 検証

- `npx tsc --noEmit`: exit 0
- `npm run lint`: 0 errors / 9 warnings。9 件とも変更前からあるコード (未使用変数・`<img>`) で、今回の差分からは 0 件
- `npm run build`: exit 0
