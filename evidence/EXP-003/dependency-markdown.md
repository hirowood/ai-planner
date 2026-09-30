# 新規依存: react-markdown / remark-gfm (EXP-003)

`rules/security.md` の「新規 Dependency は Source / Version / Risk / Verification を残す」に従う。Date: 2026-09-30

## Source
| パッケージ | 役割 | 公式リポジトリ | ライセンス |
|---|---|---|---|
| `react-markdown` | Markdown → React 要素 | https://github.com/remarkjs/react-markdown | MIT |
| `remark-gfm` | 表・取り消し線・チェックリスト (GitHub 流の Markdown) | https://github.com/remarkjs/remark-gfm | MIT |

取得元: `https://registry.npmjs.org/react-markdown/-/react-markdown-10.1.0.tgz`・`https://registry.npmjs.org/remark-gfm/-/remark-gfm-4.0.1.tgz` (package-lock.json の `resolved`)

## Version
- `react-markdown` **10.1.0**・`remark-gfm` **4.0.1** (`--save-exact`、lock 上も同じ)。いずれも現時点の最新
- peer: `react >=18` (この repo は 19.2.3)
- 本番のバンドルに入る (dependencies)。表示の部品として画面で使うため

## Risk
- **安全 (XSS)**: 返答の HTML を HTML として出さない。
  - `react-markdown` の既定のまま使い、生の HTML を通す `rehype-raw` 等は入れていない。
  - `javascript:` 等の URL は、既定の `urlTransform` が取り除く。
  - 下記のテストで確認し、危険な表示との対照でも判定が効くことを確かめた。
- **供給網**: 導入後、インストールスクリプトを持つパッケージは `fsevents` (macOS のみ) / `sharp` / `unrs-resolver` で、いずれも以前からある。今回の 2 つの依存は、インストールスクリプトを持ち込んでいない。
- **表示量**: 返答ごとに全文を再描画する (ストリーミング中も)。返答は数 KB 程度なので問題にならない見込み ([推測]。本人のローカル確認で見る)。

## Verification
- `npm test`: 41 件合格 (新規 7 件: `app/components/MessageContent.test.tsx`)
- `tsc --noEmit`: 0 / `npm run lint`: 0 errors (既存の 9 warnings) / `next build`: 0
