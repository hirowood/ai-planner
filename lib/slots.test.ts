import { describe, expect, it } from "vitest";
import { parseItemSlots, parseSlot, slotLabel, timetable } from "./slots";
import { parseTaskInput, parseTaskList, parseTaskPatch, tasksText } from "./daily-tasks";

describe("時刻 (EXP-039 L1)", () => {
  it("parseSlot: 正しい時刻・両方空は外す・それ以外は null", () => {
    expect(parseSlot({ start: "09:00", end: "09:30" })).toEqual({ start: "09:00", end: "09:30" });
    expect(parseSlot({ start: "", end: "" })).toBe("clear");
    expect(parseSlot({})).toBe("clear");
    for (const x of [{ start: "09:30", end: "09:00" }, { start: "09:00", end: "09:00" }, { start: "09:00" }, { start: "9:00", end: "10:00" }, { start: "24:00", end: "24:30" }, null, "x", { start: 9, end: 10 }]) {
      expect(parseSlot(x)).toBeNull();
    }
  });
  it("timetable: 時刻順・時刻なしは後ろに元の順で", () => {
    const e = (key: string, start = "", end = "") => ({ key, start, end, value: key });
    const { timed, untimed } = timetable([e("a", "13:00", "14:00"), e("b"), e("c", "09:00", "10:00"), e("d", "09:00", "09:30"), e("f")]);
    expect(timed.map((x) => x.key)).toEqual(["d", "c", "a"]);
    expect(untimed.map((x) => x.key)).toEqual(["b", "f"]);
    expect(slotLabel("09:00", "09:30")).toBe("09:00〜09:30");
  });
  it("parseItemSlots は形の違うものを捨てる", () => {
    expect(parseItemSlots([{ itemId: "a", start: "09:00", end: "10:00" }, { itemId: "b", start: "x", end: "10:00" }, null])).toEqual([{ itemId: "a", start: "09:00", end: "10:00" }]);
  });
});

describe("日常のタスク (EXP-040 L1)", () => {
  const TODAY = "2026-10-02";
  it("parseTaskInput: 通るもの", () => {
    expect(parseTaskInput({ day: TODAY, title: " 買い物 " }, TODAY)).toEqual({ day: TODAY, title: "買い物", start: "", end: "", status: "todo" });
    expect(parseTaskInput({ day: "2026-09-25", title: "x", start: "10:00", end: "11:00" }, TODAY)?.start).toBe("10:00");
    expect(parseTaskInput({ day: "2026-12-03", title: "x" }, TODAY)).not.toBeNull();
  });
  it("parseTaskInput: 101 字・8 日前・63 日後・実在しない日付・時刻の不正・知らない状態 → null", () => {
    for (const x of [
      { day: TODAY, title: "あ".repeat(101) },
      { day: TODAY, title: "" },
      { day: "2026-09-24", title: "x" },
      { day: "2026-12-04", title: "x" },
      { day: "2026-02-30", title: "x" },
      { day: TODAY, title: "x", start: "10:00" },
      { day: TODAY, title: "x", status: "shelved" },
    ]) expect(parseTaskInput(x, TODAY)).toBeNull();
  });
  it("parseTaskPatch: 1 つ以上・時刻は組で・外せる", () => {
    expect(parseTaskPatch({ status: "done" })).toEqual({ status: "done" });
    expect(parseTaskPatch({ start: "", end: "" })).toEqual({ start: "", end: "" });
    expect(parseTaskPatch({ start: "10:00", end: "11:00", title: "通院" })).toEqual({ title: "通院", start: "10:00", end: "11:00" });
    expect(parseTaskPatch({})).toBeNull();
    expect(parseTaskPatch({ start: "10:00" })).toBeNull();
    expect(parseTaskPatch({ status: "x" })).toBeNull();
  });
  it("一覧の検査と AI に渡す文 (時刻順・全角化)", () => {
    const list = parseTaskList([{ id: "1", day: TODAY, title: "b", start: "13:00", end: "14:00", status: "todo" }, { id: "2", day: TODAY, title: "a <x>", start: "", end: "", status: "done" }, { id: 3 }]);
    expect(list).toHaveLength(2);
    expect(tasksText(list, (s) => s.replace(/</g, "＜").replace(/>/g, "＞"))).toBe("- 13:00〜14:00 b [未実行]\n- 時刻なし a ＜x＞ [完了]");
    expect(tasksText([], (s) => s)).toBe("(まだ無し)");
  });
});
