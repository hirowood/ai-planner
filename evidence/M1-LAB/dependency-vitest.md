# 新規依存: vitest (T-010)

`rules/security.md` の「新規 Dependency は Source / Version / Risk / Verification を残す」に従う記録。
M2 の PR 本文へ同じ内容を転記する。Date: 2026-09-29

## Source
- npm パッケージ: `vitest` (devDependency のみ・本番バンドルには入らない)
- 公式リポジトリ: https://github.com/vitest-dev/vitest (`npm view vitest repository.url`)
- ライセンス: MIT
- 取得元: `https://registry.npmjs.org/vitest/-/vitest-4.1.11.tgz` (package-lock.json の `resolved`)

## Version
- `vitest` **4.1.11** (`--save-exact`・lock 上も 4.1.11)。4.x の最新 (2026-09-25 公開)
- 連れて入った主要依存: `vite` 8.3.1
- **5.0.2 (最新) を選ばなかった理由**: `@types/node` の peer 範囲が `^22 || >=24` で、この repo の `@types/node@^20` と衝突した (ERESOLVE)。`--legacy-peer-deps` で押し通すのと、既存依存 (`@types/node`) の版上げはどちらも避け、`^20` を範囲に含む 4.1.11 にした

## Risk
- 供給網: devDependency なので本番の実行時には読まれない。`npm install` 時に lifecycle script の承認待ち警告が出たが、対象は `sharp` / `unrs-resolver` (Next 側に以前からある依存) で、vitest 由来ではない
- Next 16 との互換: route handler が使う `next/server` をテストから import して `NextResponse.json` が動くことを確認 (下記)。route handler 本体の import は T-011 で確認する (import 時に環境変数を要求するため)
- Node: 実行環境は v24.19.0 で、vitest 4.1.11 の engines (`^20 || ^22 || >=24`) に含まれる
- 設定: `vitest.config.mts` (`.ts` だと CommonJS として読まれる警告が出たため `.mts` にした)

## Verification
- `npm test`: exit 0 — 1 file / 3 tests passed
  - 遮断の対照: 差し替えていない `fetch("https://example.com")` が `[no-network] blocked: fetch example.com` で失敗し、試行回数が 1 増える。`http.get` / `net.connect` も例外になる。この文言は遮断からしか出ないので、遮断が効いていることの証拠になる
  - 互換: `next/server` の `NextResponse.json` で status と本文が期待どおり
- `npm run lint`: 0 errors (warning 9 件は変更前と同じ)
- `npm run build`: exit 0 (テストファイルを足しても Next のビルドは通る)

## 遮断の範囲 (`test/setup/no-network.ts`)
- global `fetch` (テストが `vi.stubGlobal` で差し替えたときだけ通る)
- `net.Socket.prototype.connect` (http / https / Node の undici fetch はここを通る)
- `tls.connect`
- 試行は `globalThis.__networkGuard.attempts` に接続先 (host:port) だけを記録する (本文・ヘッダは記録しない)。T-012 のベンチはこれを `network_calls` として JSON に書く
