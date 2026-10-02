import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { AppCalendarView, DailyTasksView, TimeSchedule, daySchedule, gridRange, hourRange } from "./Schedule";
import { TechoView } from "./Techo";
import type { DailyTask } from "../../lib/daily-tasks";

const TODAY = "2026-10-02";
const task = (n: number, extra: Partial<DailyTask> = {}): DailyTask => ({ id: `t${n}`, day: TODAY, title: `日常 ${n}`, start: "", end: "", status: "todo", createdAt: "", ...extra });
const todo = (n: number, extra: Record<string, unknown> = {}) => ({ itemId: `i${n}`, projectName: "英語", title: `ToDo ${n}`, dueDate: TODAY, status: "todo" as const, start: "", end: "", ...extra });
const noop = () => {};

describe("タイムスケジュール (EXP-039 L4)", () => {
  it("6〜24 時の行・時刻のある予定はその時の行に時刻順・時刻なしは下に", () => {
    const html = renderToStaticMarkup(
      <TimeSchedule headingId="h" items={[
        { key: "a", title: "単語", start: "09:30", end: "10:00", badge: "[ToDo]", status: "未実行" },
        { key: "b", title: "買い物", start: "09:00", end: "09:20", badge: "[日常]", status: "未実行" },
        { key: "c", title: "時刻の無い ToDo", start: "", end: "", badge: "[ToDo]", status: "未実行" },
      ]} />,
    );
    expect(html).toContain("🕘 タイムスケジュール");
    expect((html.match(/tabular-nums">\d{2}:00</g) ?? []).length).toBe(18);
    const nine = html.indexOf(">09:00<");
    const ten = html.indexOf(">10:00<");
    expect(html.indexOf("09:00〜09:20")).toBeGreaterThan(nine);
    expect(html.indexOf("09:30〜10:00")).toBeGreaterThan(html.indexOf("09:00〜09:20"));
    expect(html.indexOf("09:30〜10:00")).toBeLessThan(ten);
    // 「時刻なし」の見出しがあり、その下に時刻の無い予定 (M10 を捕まえるため見出しそのものを確かめる)
    const untimedHeading = html.indexOf(">時刻なし</h4>");
    expect(untimedHeading).toBeGreaterThan(-1);
    expect(html.indexOf("時刻の無い ToDo")).toBeGreaterThan(untimedHeading);
    expect(html).toContain("[日常]");
  });
  it("早い / 遅い予定があれば範囲を広げる", () => {
    expect(hourRange([])).toEqual({ from: 6, to: 24 });
    expect(hourRange([{ start: "05:00", end: "05:30" }])).toEqual({ from: 5, to: 24 });
  });
});

describe("日常の ToDo の欄 (EXP-040 L4)", () => {
  it("ラベルつきの入力・状態のボタン (aria-pressed)・消す", () => {
    const html = renderToStaticMarkup(
      <DailyTasksView day={TODAY} tasks={[task(1, { start: "10:00", end: "11:00", status: "doing" }), task(2, { day: "2026-10-03" })]} problem={null} onCreate={noop} onUpdate={noop} onRemove={noop} />,
    );
    expect(html).toContain("🏠</span> 日常の ToDo");
    expect(html).toContain("10:00〜11:00 </span>日常 1");
    expect(html).not.toContain("日常 2");
    expect(html).toContain('role="group" aria-label="『日常 1』の状態"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>実行中</);
    expect(html).toContain("『日常 1』を消す");
    expect(html).toMatch(/<label[^>]*>日常 の? ?ToDo<input|日常の ToDo<input/);
    expect(html).toContain(">開始<input");
    expect(html).toContain(">終了<input");
  });
});

describe("アプリ内のカレンダー (EXP-039 L4)", () => {
  it("月の表 (th に曜日)・日付の数・選んだ日のタイムスケジュール・プロジェクトの印", () => {
    const html = renderToStaticMarkup(
      <AppCalendarView today={TODAY} date={TODAY} todos={[todo(1, { start: "09:00", end: "09:30" })]} tasks={[task(1)]} problem={null} onChange={noop} />,
    );
    expect(html).toContain("2026年10月");
    expect(html).toContain('<th scope="col" class="text-xs font-bold text-gray-700">月</th>');
    expect(html).toContain("10月2日 (金) 今日、予定 2");
    expect(html).toContain("10月2日 (金) のタイムスケジュール");
    expect(html).toContain("[英語]");
    expect(html).toContain("[日常]");
    expect(html).toContain('aria-label="前の月"');
  });
  it("daySchedule と gridRange", () => {
    expect(daySchedule([todo(1), todo(2, { dueDate: "2026-10-03" })], [task(1)], TODAY).map((x) => x.key)).toEqual(["i-i1", "t-t1"]);
    expect(gridRange(TODAY)).toEqual({ from: "2026-09-28", to: "2026-11-01" });
  });
  it("右の列の「スケジュール」でアプリ内のカレンダーを出す (Google の予定の一覧は出さない・EXP-041 でタブの名前を変えた)", () => {
    const src = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
    expect(src).toContain("['schedule', '📅', 'スケジュール']");
    expect(src).toContain("<AppCalendar today={daily.today} />");
    expect(src).not.toContain("<TodoScheduleView");
    expect(src).not.toContain("{todayEvents.map(");
  });
});

describe("スケジュールの欄に日常の ToDo (EXP-041 L3)", () => {
  it("カレンダーの下に選んだ日の欄を置ける", () => {
    const html = renderToStaticMarkup(
      <AppCalendarView today={TODAY} date={TODAY} todos={[]} tasks={[]} problem={null} onChange={noop}>
        <DailyTasksView day={TODAY} tasks={[]} problem={null} onCreate={noop} onUpdate={noop} onRemove={noop} />
      </AppCalendarView>,
    );
    const cal = html.indexOf("のタイムスケジュール");
    expect(cal).toBeGreaterThan(-1);
    expect(html.indexOf("🏠</span> 日常の ToDo")).toBeGreaterThan(cal);
    const src = readFileSync(new URL("./Schedule.tsx", import.meta.url), "utf8");
    expect(src).toContain("onCreate={(title, s, e) => create(date, title, s, e)}");
  });
});

describe("手帳の週に日常の数 (EXP-040 L4)", () => {
  it("日常のタスクがある日は「日常 N」", () => {
    const html = renderToStaticMarkup(
      <TechoView today={TODAY} mode="week" date={TODAY} items={[]} logs={[]} notes={[]} tasks={[{ day: TODAY }, { day: TODAY }]} onChange={noop} renderDay={() => null} />,
    );
    expect(html).toContain("ToDo 0/0・日常 2");
  });
});
