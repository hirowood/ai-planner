import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { ASK_COMMENT, ASK_TODAY_TODOS, DailyView } from "./DailyPanel";
import type { PlanItem } from "../../lib/plan-items";
import type { DailyLog } from "../../lib/daily";

const P = "123e4567-e89b-12d3-a456-426614174000";
const TODAY = "2026-10-01";
const todo = (n: number, due = TODAY): PlanItem => ({
  id: `aaaaaaaa-0000-4000-8000-00000000000${n}`, projectId: P, parentId: null, level: "todo", title: `単語 ${n}`, target: "",
  dueDate: due, status: "todo", createdAt: `2026-10-01T00:00:0${n}Z`, updatedAt: "",
});
const noop = () => {};
const render = (items: PlanItem[], logs: DailyLog[] = [], saved = false) =>
  renderToStaticMarkup(
    <DailyView today={TODAY} items={items} logs={logs} problem={null} saving={false} saved={saved} onUpdateItem={noop} onSave={noop} onAsk={noop} />,
  );

describe("「☀️ 今日」のタブ (EXP-020 L5)", () => {
  it("今日のタブが既定 (page.tsx)", () => {
    const src = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
    expect(src).toContain("useState<'today' | 'plan' | 'notes'>('today')");
    // EXP-036 でタブの名前を「📒 手帳」に (中身は手帳の日のページ)
    expect(src).toContain("['today', '📒', '手帳']");
  });
  it("〇△× は fieldset と legend のラジオ・良かったこと 3 つ・明日はこうする", () => {
    const html = render([]);
    expect(html).toMatch(/<fieldset[^>]*><legend[^>]*>今日はどうでしたか？<\/legend>/);
    expect((html.match(/type="radio"/g) ?? []).length).toBe(3);
    for (const l of ["〇 できた", "△ 少し", "× できなかった"]) expect(html).toContain(l);
    for (const i of [1, 2, 3]) expect(html).toContain(`aria-label="良かったこと ${i}"`);
    expect(html).toContain("明日はこうする");
    // 〇△× を選ぶまで保存できない
    // 押せない理由は aria-disabled と説明で伝え、フォーカスは外さない (disabled にしない・a11y レビュー)
    expect(html).toMatch(/<button type="submit" aria-disabled="true" aria-describedby="daily-save-hint"/);
    expect(html).not.toMatch(/<button type="submit"[^>]*disabled=""/);
    expect(html).toContain('id="daily-save-hint"');
    expect((html.match(/type="radio"[^>]*required=""/g) ?? []).length).toBe(3);
  });
  it("今日の ToDo が無ければ案内と会話に送るボタン", () => {
    const html = render([todo(1, "2026-10-02")]);
    expect(html).toContain("今日が期日の ToDo はまだありません");
    expect(html).toContain(ASK_TODAY_TODOS);
    expect(html).not.toContain("『単語 1』の状態");
  });
  it("目安は 1 日 9 つほど: 10 で案内・9 では出さない・9 未満なら会話に送るボタン (EXP-031 L4 が EXP-020 の 3 つを置き換え)", () => {
    const ten = Array.from({ length: 10 }, (_, i) => todo(i + 1));
    const html = render(ten);
    expect(html).toContain("『単語 1』の状態");
    expect(html).toContain("9 つほどに絞ると回しやすいです");
    expect(html).not.toContain(ASK_TODAY_TODOS);
    expect(render(ten.slice(0, 9))).not.toContain("に絞ると");
    expect(render(ten.slice(0, 4))).toContain(ASK_TODAY_TODOS);
    expect(render(ten.slice(0, 4))).toContain("目安: KDI ごとに 3 つ・1 日 9 つほど (今 4 つ)");
    expect(ASK_TODAY_TODOS).toBe("今日の ToDo を KDI ごとに 3 つずつ決めたい");
  });
  it("今日の ToDo を KDI ごとにまとめ、判定基準を出す (EXP-031 L4)", () => {
    const kdi = (n: number, title: string): PlanItem => ({
      id: `bbbbbbbb-0000-4000-8000-00000000000${n}`, projectId: P, parentId: null, level: "kdi", title, target: "", dueDate: "",
      status: "todo", createdAt: `2026-09-30T00:00:0${n}Z`, updatedAt: "",
    });
    const a = kdi(1, "単語 毎日 30 分");
    const b = kdi(2, "文法");
    const t1 = { ...todo(1), parentId: b.id, title: "文法 p.10" };
    const t2 = { ...todo(2), parentId: a.id, title: "単語 1〜30", target: "30 個を言える" };
    const html = render([a, b, t1, t2]);
    // KDI の古い順 (a → b) に見出し・その下に ToDo
    const ia = html.indexOf("KDI: 単語 毎日 30 分");
    const ib = html.indexOf("KDI: 文法");
    expect(ia).toBeGreaterThan(-1);
    expect(ib).toBeGreaterThan(ia);
    expect(html.indexOf("単語 1〜30")).toBeGreaterThan(ia);
    expect(html.indexOf("単語 1〜30")).toBeLessThan(ib);
    expect(html).toContain("判定基準: 30 個を言える");
    expect(html).toMatch(/<h4[^>]*>KDI: 単語 毎日 30 分<\/h4>/);
  });
  it("ToDo の状態ごとのボタン: 未実行 → 始める・実行中 → 完了・実行 → 判定待ち・判定済みは無し (EXP-034 L2)", () => {
    const t = (n: number, status: PlanItem["status"]) => ({ ...todo(n), title: `T${n}`, status });
    const html = render([t(1, "todo"), t(2, "doing"), t(3, "done"), t(4, "succeeded"), t(5, "failed")]);
    expect(html).toContain('aria-label="『T1』を始める"');
    expect(html).toContain('aria-label="『T2』を完了にする"');
    expect(html).toContain('aria-label="『T3』を AI と判定する (判定待ち)"');
    expect(html).not.toContain("『T4』を");
    expect(html).not.toContain("『T5』を始める");
    expect(html).not.toContain("『T5』を完了");
    // 記号は読み上げない
    expect(html).toContain('<span aria-hidden="true">▶</span> 始める');
    expect(html).toContain('<span aria-hidden="true">✓</span> 完了');
    // 状態の選択も残る (手で直せる)・実行中が選べる
    expect(html).toContain('aria-label="『T1』の状態"');
    expect(html).toContain('<option value="doing">実行中</option>');
  });
  it("今日の記録があれば入れておき「上書き」・保存後は AI にひとこと", () => {
    const log: DailyLog = { projectId: P, day: TODAY, mark: "fair", goods: ["早起き"], tomorrow: "10 分早く", updatedAt: "u" };
    const html = render([], [log], true);
    expect(html).toContain('value="早起き"');
    expect(html).toContain('value="10 分早く"');
    expect(html).toMatch(/checked="" value="fair"/);
    expect((html.match(/checked=""/g) ?? []).length).toBe(1);
    expect(html).toContain("今日の記録を上書きする");
    expect(html).toContain("今日の記録を保存しました");
    expect(html).toContain("AI にひとことをもらう");
    expect(ASK_COMMENT).toContain("ひとこと");
  });
});
