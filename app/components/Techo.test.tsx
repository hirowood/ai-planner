import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TechoView } from "./Techo";
import { DailyView } from "./DailyPanel";
import type { PlanItem } from "../../lib/plan-items";
import type { DailyLog } from "../../lib/daily";

const P = "123e4567-e89b-12d3-a456-426614174000";
const TODAY = "2026-10-02";
const todo = (n: number, due: string, status: PlanItem["status"] = "todo"): PlanItem => ({
  id: `aaaaaaaa-0000-4000-8000-00000000000${n}`, projectId: P, parentId: null, level: "todo", title: `ToDo ${n}`, target: "",
  dueDate: due, status, createdAt: `2026-10-01T00:00:0${n}Z`, updatedAt: "",
});
const noop = () => {};
const render = (mode: "day" | "week" | "month", date = TODAY, items: PlanItem[] = [], logs: DailyLog[] = []) =>
  renderToStaticMarkup(
    <TechoView today={TODAY} mode={mode} date={date} items={items} logs={logs} notes={[]} onChange={noop} renderDay={(d) => <p>DAY-PAGE {d}</p>} />,
  );

describe("📒 手帳 (EXP-036 L4)", () => {
  it("日・週・月の切り替え (aria-pressed)・前 / 今日 / 次", () => {
    const html = render("week");
    expect(html).toContain('role="group" aria-label="手帳の表示"');
    expect(html).toMatch(/aria-pressed="false"[^>]*>日</);
    expect(html).toMatch(/aria-pressed="true"[^>]*>週</);
    expect(html).toContain('aria-label="前の週"');
    expect(html).toContain('aria-label="次の週"');
    expect(html).toContain(">今日</button>");
  });
  it("週は 7 日の一覧・今日に印・日付のボタン", () => {
    const html = render("week", TODAY, [todo(1, TODAY, "succeeded"), todo(2, "2026-10-03")], [{ projectId: P, day: TODAY, mark: "good", goods: [], tomorrow: "", updatedAt: "" }]);
    expect((html.match(/のページを開く/g) ?? []).length).toBe(7);
    expect(html).toContain('aria-label="10/2 (金) のページを開く (今日)" aria-current="date"');
    expect(html).toContain("ToDo 1/1");
    expect(html).toContain("[成功]</span> ToDo 1");
    expect(html).toContain("〇 できた");
    expect(html).not.toContain("DAY-PAGE");
  });
  it("月は表 (th に曜日)・その月の 31 日と前後の日", () => {
    const html = render("month");
    expect(html).toContain("<table");
    for (const w of ["月", "火", "水", "木", "金", "土", "日"]) expect(html).toContain(`<th scope="col" class="text-xs font-bold text-gray-700">${w}</th>`);
    expect((html.match(/のページを開く/g) ?? []).length).toBe(35);
    expect(html).toContain("2026年10月");
  });
  it("日は日のページを出す・これまでのデータ欄はどの表示にもある", () => {
    const day = render("day", "2026-10-01");
    expect(day).toContain("DAY-PAGE 2026-10-01");
    expect(day).toContain("10月1日 (木)");
    for (const m of ["day", "week", "month"] as const) {
      const html = render(m);
      expect(html).toContain("これまでのデータ");
      expect(html).toContain("できた割合");
      expect(html).toContain("1 日の記録");
      expect(html).toContain("AI と決めた判定・仮説");
    }
  });
});

describe("日のページを今日以外で開く (EXP-036 L4)", () => {
  const base = { today: TODAY, logs: [] as DailyLog[], problem: null, saving: false, saved: false, onUpdateItem: noop, onSave: noop, onAsk: noop };
  it("昨日は見る + 書き直せる・始める / 完了のボタンは出さない", () => {
    const html = renderToStaticMarkup(<DailyView {...base} date="2026-10-01" items={[todo(1, "2026-10-01")]} />);
    expect(html).toContain("この日の ToDo (2026-10-01)");
    expect(html).not.toContain("を始める");
    expect(html).toContain("この日はどうでしたか？");
    expect(html).not.toContain("今日の ToDo を KDI ごとに");
  });
  it("明日は見るだけ (振り返りは書けない)", () => {
    const html = renderToStaticMarkup(<DailyView {...base} date="2026-10-03" items={[todo(1, "2026-10-03")]} />);
    expect(html).toContain("ToDo 1");
    expect(html).toContain("まだ先の日です");
    expect(html).not.toContain('type="radio"');
  });
  it("8 日以上前は記録を見るだけ", () => {
    const logs: DailyLog[] = [{ projectId: P, day: "2026-09-20", mark: "bad", goods: ["散歩"], tomorrow: "早く寝る", updatedAt: "" }];
    const html = renderToStaticMarkup(<DailyView {...base} logs={logs} date="2026-09-20" items={[]} />);
    expect(html).toContain("× できなかった");
    expect(html).toContain("散歩");
    expect(html).toContain("早く寝る");
    expect(html).not.toContain('type="radio"');
  });
});
