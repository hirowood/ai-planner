import { describe, expect, it } from "vitest";
import { eventLabel, parseItemEvents, parseTimeRange, todoToEvent, upcomingTodos } from "./todo-event";
import type { PlanItem } from "./plan-items";

const PID = "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b";
const item = (n: number, due: string, level: PlanItem["level"] = "todo"): PlanItem => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, projectId: PID, parentId: null, level, title: `t${n}`, target: "",
  dueDate: due, status: "todo", createdAt: `2026-10-01T00:00:0${n}.000Z`, updatedAt: "",
});

describe("parseTimeRange (EXP-030 L1)", () => {
  it("無い・空 → 終日", () => {
    expect(parseTimeRange(undefined)).toEqual({ allDay: true });
    expect(parseTimeRange({})).toEqual({ allDay: true });
    expect(parseTimeRange({ start: "", end: "" })).toEqual({ allDay: true });
  });
  it("両方 HH:MM で end > start → 時刻つき", () => {
    expect(parseTimeRange({ start: "09:00", end: "09:30" })).toEqual({ allDay: false, start: "09:00", end: "09:30" });
  });
  it("片方だけ・end ≤ start・形違い → null", () => {
    expect(parseTimeRange({ start: "09:00" })).toBeNull();
    expect(parseTimeRange({ end: "09:00" })).toBeNull();
    expect(parseTimeRange({ start: "09:00", end: "09:00" })).toBeNull();
    expect(parseTimeRange({ start: "10:00", end: "09:00" })).toBeNull();
    expect(parseTimeRange({ start: "9:00", end: "10:00" })).toBeNull();
    expect(parseTimeRange({ start: "24:00", end: "24:30" })).toBeNull();
    expect(parseTimeRange([])).toBeNull();
    expect(parseTimeRange("09:00")).toBeNull();
  });
});

describe("todoToEvent (EXP-030 L1)", () => {
  it("終日は期日〜翌日 (月末・年末をまたぐ)", () => {
    expect(todoToEvent({ title: "単語", dueDate: "2026-10-31" }, { allDay: true })).toEqual({
      summary: "✅ 単語", description: "ai-planner の ToDo", start: { date: "2026-10-31" }, end: { date: "2026-11-01" },
    });
    expect(todoToEvent({ title: "x", dueDate: "2026-12-31" }, { allDay: true })?.end).toEqual({ date: "2027-01-01" });
  });
  it("時刻つきは期日の +09:00", () => {
    expect(todoToEvent({ title: "単語", dueDate: "2026-10-01" }, { allDay: false, start: "09:00", end: "09:30" })).toEqual({
      summary: "✅ 単語",
      description: "ai-planner の ToDo",
      start: { dateTime: "2026-10-01T09:00:00+09:00" },
      end: { dateTime: "2026-10-01T09:30:00+09:00" },
    });
  });
  it("期日が無ければ null", () => {
    expect(todoToEvent({ title: "x", dueDate: "" }, { allDay: true })).toBeNull();
  });
});

describe("upcomingTodos・eventLabel・parseItemEvents (EXP-030 L1)", () => {
  it("今日〜7 日先の ToDo だけ・期日→作った順・KDI と過去と 8 日先は入れない", () => {
    const got = upcomingTodos(
      [item(5, "2026-10-08"), item(1, "2026-10-01"), item(2, "2026-09-30"), item(3, "2026-10-09"), item(4, "2026-10-01", "kdi"), item(6, "2026-10-01"), item(7, "")],
      "2026-10-01",
    );
    expect(got.map((t) => t.title)).toEqual(["t1", "t6", "t5"]);
  });
  it("印の文", () => {
    expect(eventLabel({ itemId: "a", start: "09:00", end: "09:30" })).toBe("📅 予定 09:00〜09:30");
    expect(eventLabel({ itemId: "a", start: "", end: "" })).toBe("📅 予定 (終日)");
  });
  it("一覧の検査", () => {
    expect(parseItemEvents([{ itemId: "a", start: "09:00", end: "x" }, { start: "1" }, null])).toEqual([{ itemId: "a", start: "09:00", end: "" }]);
    expect(parseItemEvents(undefined)).toEqual([]);
  });
});
