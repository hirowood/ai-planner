import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TodoScheduleView } from "./TodoSchedule";
import { DailyView } from "./DailyPanel";
import type { PlanItem } from "../../lib/plan-items";

const P = "123e4567-e89b-12d3-a456-426614174000";
const TODAY = "2026-10-01";
const todo = (n: number, due: string): PlanItem => ({
  id: `aaaaaaaa-0000-4000-8000-00000000000${n}`, projectId: P, parentId: null, level: "todo", title: `単語 ${n}`, target: "",
  dueDate: due, status: "todo", createdAt: `2026-10-01T00:00:0${n}Z`, updatedAt: "",
});
const noop = () => {};

describe("「📅 予定に入れる ToDo」(EXP-030 L4)", () => {
  const items = [todo(1, TODAY), todo(2, "2026-10-03")];
  const html = renderToStaticMarkup(
    <TodoScheduleView today={TODAY} items={items} events={[{ itemId: items[1].id, start: "09:00", end: "09:30" }]} busyId={null} problem={null} done={null} onSchedule={noop} />,
  );
  it("予定の無い ToDo に時刻の入力 (ラベルつき) と「予定に入れる」", () => {
    expect(html).toContain('type="time" aria-label="『単語 1』の開始"');
    expect(html).toContain('aria-label="『単語 1』の終了"');
    expect(html).toContain('aria-label="『単語 1』を予定に入れる"');
    expect(html).toContain("時刻を空のままにすると終日");
  });
  it("予定のある ToDo には印だけ (入力は出さない)", () => {
    expect(html).toContain("📅 予定 09:00〜09:30");
    expect(html).not.toContain("『単語 2』を予定に入れる");
  });
  it("予定の印はフォーカスを受けられる (入れた後にフォーカスを移す先)・ボタンは disabled にしない (a11y レビュー)", () => {
    expect(html).toMatch(/<span tabindex="-1"[^>]*>📅 予定 09:00〜09:30<\/span>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""/);
    const busy = renderToStaticMarkup(
      <TodoScheduleView today={TODAY} items={items} events={[]} busyId={items[0].id} problem={null} done={null} onSchedule={noop} />,
    );
    expect(busy).toMatch(/<button type="submit" aria-disabled="true" aria-busy="true" aria-label="『単語 1』を予定に入れる"/);
    expect(busy).not.toMatch(/<button[^>]*disabled=""/);
  });
  it("7 日先までに ToDo が無ければ案内", () => {
    const empty = renderToStaticMarkup(
      <TodoScheduleView today={TODAY} items={[todo(1, "2026-12-01")]} events={[]} busyId={null} problem={null} done={null} onSchedule={noop} />,
    );
    expect(empty).toContain("7 日先までの ToDo はまだありません");
  });
  it("今日の ToDo の行にも印", () => {
    const daily = renderToStaticMarkup(
      <DailyView today={TODAY} items={[todo(1, TODAY)]} logs={[]} problem={null} saving={false} saved={false} onUpdateItem={noop} onSave={noop} onAsk={noop} eventLabels={{ [todo(1, TODAY).id]: "📅 予定 (終日)" }} />,
    );
    expect(daily).toContain("📅 予定 (終日)");
  });
});
