# EXP-043 実験室の結果 — 目的ごとのチャット

Date: 2026-10-02 / 事前登録: `request.md` (変更より前に commit cf194fa)

## 変更

- `lib/threads.ts` (新): `COACH_THREADS`・`THREAD_LABEL`・`THREAD_ROLE`・`isCoachThread`・`threadStep`・`threadAllowsChange`
- `lib/messages.ts`: thread に `kgi`・`kpi`・`kdi`・`todo` を足す (`plan`・`chat` はそのまま)
- `app/api/coach/route.ts`: 本文の `thread` (無ければ chat・知らない値は 400)・その会話の履歴だけを読み書き・判定は todo だけ・段は `threadStep`・変更は `threadAllowsChange` で絞る・「### この会話の役割」の文
- `app/page.tsx`: 会話の上にタブ (💬 壁打ち・相談 / 🎯 KGI / 📈 KPI / 🧭 KDI / ✅ ToDo / 🆕 プロジェクト作成・role="tab")。プロジェクトを選んでいなければ作成だけ。タブを替えるとその会話を読み直す。ToDo の相談・「✓ 完了」の判定・手帳の相談は ✅ ToDo の会話へ (切り替えてから、読み終えたあとに送る)

## 判定 (事前登録の規則)

| 規則 | 結果 | 根拠 |
|---|---|---|
| L1 | 成立 | `lib/threads.test.ts` (5 つの会話・chat / kgi は null・KGI が無ければ kgi・KDI の少ない KPI の下・3 つで止まる・しまった KDI は数えない・今日 3 つ未満の最初の KDI・K / D の変更の可否) |
| L2 | 成立 | `lib/hierarchy-coach.test.ts` (読む・保存する値に thread・知らない thread と plan は 400・無ければ chat)・`lib/messages.test.ts` (`/api/messages` の isThread が 4 つを通し、ほかは通さない) |
| L3 | 成立 | `lib/hierarchy-coach.test.ts` (kpi は KPI を足し D を変えない・todo は ToDo を足し K を変えない・chat / kgi は足さず変えない・判定は todo だけ (chat / kgi / kpi / kdi では更新しない)・役割の文) |
| L4 | 成立 (source で) | `app/chat-tabs.test.ts` (tablist・プロジェクトを選んだときだけ 5 つ・作成のタブ・thread で読む・送るとき thread・ToDo へ送る 3 か所) |
| L5 | 成立 | `npm test` 863 件合格・`tsc` 0・eslint 0 errors / 13 warnings (前と同じ)・`next build` 成功 |

わざと壊す 8 通り (履歴を chat に固定・chat でも足す・kpi で D も変えられる・todo の 3 つの上限を外す・画面が thread を送らない・判定をどの会話でも・messages の kdi を外す・役割の文を消す) はすべて赤。

## 事前登録との違い

- タブの見出しは事前登録どおり 6 つ。ただし `thread` は 5 つ (作成は今の作る会話で、thread を持たない)
- 既存のテストは thread を明示する形に直した (`autoThread()`: 階層の状態に合う会話 = 前の「次の段」と同じ)。pick のテストの期待は「この会話は「KPI」です」を足しただけ

## 残り

- ブラウザでは確かめていない (Chrome の拡張がつながらなかった)。画面の配線は source のテストだけ
- 狭い画面でタブが折り返すことは確かめていない
