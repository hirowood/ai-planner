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
    expect(src).toContain("['today', '☀️', '今日']");
  });
  it("〇△× は fieldset と legend のラジオ・良かったこと 3 つ・明日はこうする", () => {
    const html = render([]);
    expect(html).toMatch(/<fieldset[^>]*><legend[^>]*>今日はどうでしたか？<\/legend>/);
    expect((html.match(/type="radio"/g) ?? []).length).toBe(3);
    for (const l of ["〇 できた", "△ 少し", "× できなかった"]) expect(html).toContain(l);
    for (const i of [1, 2, 3]) expect(html).toContain(`aria-label="良かったこと ${i}"`);
    expect(html).toContain("明日はこうする");
    // 〇△× を選ぶまで保存できない
    expect(html).toMatch(/<button type="submit" disabled=""/);
  });
  it("今日の ToDo が無ければ案内と会話に送るボタン", () => {
    const html = render([todo(1, "2026-10-02")]);
    expect(html).toContain("今日が期日の ToDo はまだありません");
    expect(html).toContain(ASK_TODAY_TODOS);
    expect(html).not.toContain("『単語 1』の状態");
  });
  it("今日の ToDo が 4 つなら状態の選択と「3 つに絞ると」", () => {
    const html = render([todo(1), todo(2), todo(3), todo(4)]);
    expect(html).toContain("『単語 1』の状態");
    expect(html).toContain("3 つに絞ると回しやすいです");
    expect(render([todo(1), todo(2), todo(3)])).not.toContain("3 つに絞ると");
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
