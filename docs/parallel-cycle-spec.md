# ai-planner 並列開発サイクルの仕様 (親 Agent + 並列 SubAgent + PERT)

Date: 2026-09-30 / 上位: `docs/pdca-spec.md` (何を試すか・どう判定するか)。本書は **1 枚のカードをどう速く作るか** だけを決める。
道具: `D:/CLAUDE-CODE/skills/project-pert-planner/scripts/` (`pert.py`・`dispatch.py`・`crew.py`・`replan.py`・`retro.py`・`calibrate.py`)。数字は必ずこれらの出力から引く (図や感想で要約しない)。

## 1. 役割

| 誰 | すること | しないこと |
|---|---|---|
| **親** (メインのセッション) | WBS を作る・PERT で臨界経路と並列幅を決める・子へ task_card を渡す・結果を統合する・時刻を記録する・commit・振り返り | 子の仕事をやり直す / 待ち時間に同じ調査を自分でもする |
| **子** (SubAgent) | 自分の task_card の `files` だけを書く・`done_when` を満たしたら短く報告する | commit・push・他のタスクのファイルを書く・範囲外の改善 |
| **本人** | ローカル確認・点数と一番困ったこと・push / マージ / 巻き戻しの承認 | — |

子の agent の種類は task の `owner` (例 `test-writer`・`frontend-implementer`・`backend-implementer`・`harness-test-runner`・`a11y-reviewer`)。

## 2. 1 枚のカードの WBS (雛形 `docs/plans/cycle-template.json`)

```text
1 計画     1.1 PRE   事前登録 (親)
2 作る     2.1 TST   テストを先に書く (test-writer・L 規則だけを見て書く)
           2.2 LIB   純粋な関数 (lib/)
           2.3 SRV   サーバ・計測 (route.ts・perf.ts)
           2.4 UI    画面の部品・page の配線
3 確かめる 3.1 RUN   test / tsc / lint / build を実行 (生の結果だけ)
           3.2 REV   a11y・安全のレビュー (読み取り専用)
           3.3 MUT   わざと壊して赤になるか (親)
4 記録     4.1 LAB   lab.md と commit (親)
5 出す     5.1 LOCAL 本人のローカル確認 → 5.2 SHIP push・PR・Preview (承認後)
6 学ぶ     6.1 RETRO 振り返り・教訓・見積りの校正
```

依存と並列 (雛形を `dispatch.py` にかけた結果・2026-09-30):

```text
PRE ─┬─ LIB ─┬─ SRV ─┬─ RUN ─ MUT ─ LAB ─ LOCAL ─ SHIP ─ RETRO
     │       └─ UI  ─┤     └─ REV ─┘
     └─ TST ─────────┘
同時に走る本数: PRE 後 2 本 (LIB・TST) → LIB 後 3 本 (UI・SRV・TST)
臨界経路: PRE → LIB → UI → RUN → MUT → LAB → LOCAL → SHIP → RETRO
```

カードに合わない工程は消す (例: 画面だけのカードなら SRV を消す)。**工程を足すなら `files` と `reads` を必ず書く** — 書かないと `dispatch.py` は衝突を見られず、並列幅が実態より大きく出る。

## 3. 1 サイクルの手順 (親)

1. **複製**: `cycle-template.json` → `docs/plans/EXP-xxx.json`。`EXP-XXX`・`FEATURE` をカードの名前へ置き換え、要らない工程を消す
2. **見積り**: 三点見積り (楽観・最頻・悲観) を書く。`docs/plans/calibration.json` の `factor` があれば掛ける (実績 5 件未満のうちは掛けない)
3. **現在地**: `python pert.py docs/plans/EXP-xxx.json` → 臨界経路・ready を確認
4. **配る**: `python dispatch.py docs/plans/EXP-xxx.json --max 3 --json` → `chosen` の本数だけ、**1 つのメッセージで同時に** Agent を起動する。プロンプトは task_card (`crew.py` の出力) をそのまま使い、下の §4 の指示を足す
5. **時刻**: 起動した時刻を `started_at`、報告を受けた時刻を `ended_at` に書く (UTC)。`actual_duration` = 差 (時間)。**記録していない工程に actual_duration を書かない**
6. **統合**: 結果を読む → `status: done` にする → 3. に戻る (新しく ready になった工程を配る)。子の報告が `done_when` を満たさなければ、同じ子へ差分だけを送り返す (1 回まで。2 回目は親が原因を調べる)
7. **遅れたら**: 見積りの悲観を超えた工程が出たら `python replan.py docs/plans/EXP-xxx.json` で短縮案 (実差つき) を見て、臨界経路上のものだけ手を打つ
8. **出す**: LAB まで終わったら本人へ LOCAL を頼む。承認後に SHIP
9. **学ぶ**: §5

## 4. 速く終わらせる指示の出し方 (task_card に必ず足す)

- **書いてよいファイル**を列挙し、それ以外は書かない、と明記する
- **完了条件** (`done_when`) は機械的に確かめられる形にする (「tsc が通る」「L2 のテストが 1 件以上」)
- **報告の形**を決める: 「変えたファイル / 満たした完了条件 / 満たせなかったこと (理由)」だけ・20 行以内。途中経過や全文は送らない
- **前提は渡す**: request.md の該当節・関係する型・既存の決まり (ログは数と真偽だけ・`.env.local` を読まない・ai-planner の commit は親) を貼る。子に探させない
- **子へ渡さない**: push・マージ・本人への質問・範囲の拡張の判断
- 同じ種類の工程 (例 REV の a11y と安全) は別の子にして同時に走らせる

## 5. 振り返りと改善 (毎サイクル・RETRO)

1. 全工程が done になったら `python retro.py docs/plans/EXP-xxx.json` を実行し、出力を `evidence/EXP-xxx/retro.md` に貼る (完走前は exit 3 で出ない。途中の反省は感想になるため)
2. 次の 3 つを 1 行ずつ `docs/cycle-lessons.md` に足す:
   - **遅かった工程**: 実績 / 見積りの比が 1.5 を超えた工程と原因
   - **分け方**: 衝突で保留された工程・子の報告のやり直し・親が自分でやり直した工程
   - **計画**: 依存の誤り (待たなくてよいのに待った・待つべきなのに走った)
3. 教訓ごとに **次にどこを変えるか** を 1 つ決める。優先順: `cycle-template.json` (工程・依存・files/reads) → 本書 §4 (指示) → テスト・lint で機械的に止める。文章の注意書きを足すのは最後
4. 実績が 5 件以上たまったら `python calibrate.py docs/plans/EXP-*.json` で `docs/plans/calibration.json` を作り直す。以後の見積りに `factor` を掛ける
5. 次のサイクルの 1. (複製) の前に、`docs/cycle-lessons.md` の「採用」の行を雛形へ反映済みか確かめる

## 6. 置き場所

| もの | 場所 |
|---|---|
| WBS の雛形 | `docs/plans/cycle-template.json` |
| カードごとの計画と実績 | `docs/plans/EXP-xxx.json` |
| 見積りの校正 | `docs/plans/calibration.json` (実績 5 件から) |
| 振り返り | `evidence/EXP-xxx/retro.md` |
| 工程の教訓 (次に生かす) | `docs/cycle-lessons.md` |
