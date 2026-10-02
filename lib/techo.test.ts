import { describe, expect, it } from "vitest";
import { addDays, addMonths, dayInfo, monthGrid, periodLabel, shiftDate, techoStats, weekDates } from "./techo";
import type { DailyLog } from "./daily";
import type { PlanItem } from "./plan-items";

const PID = "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b";
const TODAY = "2026-10-02"; // 金曜
let n = 0;
const item = (level: PlanItem["level"], extra: Partial<PlanItem> = {}): PlanItem => {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, projectId: PID, parentId: null, level, title: `${level}-${n}`, target: "",
    dueDate: "", status: "todo", createdAt: `2026-10-01T00:00:${String(n % 60).padStart(2, "0")}.000Z`, updatedAt: `2026-10-02T00:${String(n % 60).padStart(2, "0")}:00.000Z`, ...extra,
  };
};
const log = (day: string, mark: DailyLog["mark"] = "good"): DailyLog => ({ projectId: PID, day, mark, goods: [], tomorrow: "", updatedAt: "" });

describe("日付 (EXP-036 L1)", () => {
  it("addDays: 月末・年末・うるう年", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
  });
  it("addMonths: 末日に丸める", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
  });
  it("weekDates: 月曜はじまり・日曜を含む週", () => {
    expect(weekDates(TODAY)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(weekDates("2026-10-04")[0]).toBe("2026-09-28");
    expect(weekDates("2026-10-05")[0]).toBe("2026-10-05");
  });
  it("monthGrid: 2026-10 は 9/28 から 11/1 までの 5 行・その月の印", () => {
    const g = monthGrid(TODAY);
    expect(g).toHaveLength(5);
    expect(g[0][0]).toEqual({ date: "2026-09-28", inMonth: false });
    expect(g[0][3]).toEqual({ date: "2026-10-01", inMonth: true });
    expect(g[4][6]).toEqual({ date: "2026-11-01", inMonth: false });
    expect(g.flat().filter((c) => c.inMonth)).toHaveLength(31);
  });
  it("見出しと前後への移動", () => {
    expect(periodLabel("day", TODAY)).toBe("10月2日 (金)");
    expect(periodLabel("week", TODAY)).toBe("9月28日〜10月4日");
    expect(periodLabel("month", TODAY)).toBe("2026年10月");
    expect(shiftDate("day", TODAY, -1)).toBe("2026-10-01");
    expect(shiftDate("week", TODAY, 1)).toBe("2026-10-09");
    expect(shiftDate("month", TODAY, 1)).toBe("2026-11-02");
  });
});

describe("dayInfo・techoStats (EXP-036 L2)", () => {
  it("その日の ToDo・状態の数・〇△×", () => {
    const items = [item("todo", { dueDate: TODAY, status: "succeeded" }), item("todo", { dueDate: TODAY, status: "todo" }), item("todo", { dueDate: "2026-10-03" }), item("kdi", { dueDate: TODAY })];
    const info = dayInfo(items, [log(TODAY, "fair")], TODAY);
    expect(info.todos).toHaveLength(2);
    expect(info.doneCount).toBe(1);
    expect(info.counts.succeeded).toBe(1);
    expect(info.mark).toBe("fair");
    expect(dayInfo(items, [], "2026-10-05").mark).toBeNull();
  });
  it("達成の数・できた割合 7 日 / 30 日・記録の日数・続けている日数・KGI のあと N 日・KPI", () => {
    const kgi = item("kgi", { title: "TOEIC 800", dueDate: "2026-10-31" });
    const kpi = item("kpi", { parentId: kgi.id, title: "模試", target: "700", dueDate: "2026-10-20" });
    const items = [
      kgi, kpi,
      item("todo", { dueDate: TODAY, status: "succeeded" }),
      item("todo", { dueDate: "2026-09-30", status: "failed" }),
      item("todo", { dueDate: "2026-09-20", status: "done" }), // 30 日以内・7 日の外
      item("todo", { dueDate: "2026-08-01", status: "succeeded" }), // 30 日の外
      item("todo", { dueDate: TODAY, status: "shelved" }),
    ];
    const s = techoStats(items, [log(TODAY), log("2026-10-01"), log("2026-09-30"), log("2026-09-28")], [], TODAY);
    expect(s.totals).toEqual({ succeeded: 2, done: 1, failed: 1, adjusted: 0, shelved: 1 });
    expect(s.rate7).toEqual({ done: 1, judged: 2 });
    expect(s.rate30).toEqual({ done: 2, judged: 3 });
    expect(s.loggedDays30).toBe(4);
    expect(s.streak).toBe(3);
    expect(s.kgi).toEqual({ title: "TOEIC 800", dueDate: "2026-10-31", daysLeft: 29 });
    expect(s.kpis).toEqual([{ title: "模試", target: "700", dueDate: "2026-10-20" }]);
  });
  it("続けている日数: 今日が無ければ昨日から・途切れたら 0", () => {
    expect(techoStats([], [log("2026-10-01"), log("2026-09-30")], [], TODAY).streak).toBe(2);
    expect(techoStats([], [log("2026-09-29")], [], TODAY).streak).toBe(0);
    expect(techoStats([], [], [], TODAY).kgi).toBeNull();
    expect(techoStats([], [], [], TODAY).rate7).toBeNull();
  });
  it("AI の評価: 判定済みの新しい 5 件・仮説の新しい 3 件", () => {
    const judged = Array.from({ length: 7 }, (_, i) => item("todo", { status: i % 2 ? "failed" : "succeeded", updatedAt: `2026-10-0${i + 1}T00:00:00.000Z`, title: `j${i}` }));
    const notes = Array.from({ length: 5 }, (_, i) => ({ kind: i === 4 ? "fact" : "仮説", body: `h${i}`, createdAt: `2026-10-0${i + 1}T00:00:00.000Z` }));
    const s = techoStats(judged, [], notes, TODAY);
    expect(s.recentJudged.map((j) => j.title)).toEqual(["j6", "j5", "j4", "j3", "j2"]);
    expect(s.hypotheses.map((h) => h.body)).toEqual(["h3", "h2", "h1"]);
  });
});
