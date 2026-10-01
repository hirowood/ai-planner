import { describe, expect, it } from "vitest";
import { dailyFilled, dailyText, parseDailyInput, parseDailyLog, todayTodos, type DailyLog } from "./daily";
import type { PlanItem } from "./plan-items";

const PID = "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b";
const TODAY = "2026-10-01";
const base = { projectId: PID, day: TODAY, mark: "good" };

describe("parseDailyInput (EXP-020 L1)", () => {
  it("今日・7 日前は通る / 8 日前・明日・実在しない日付は弾く", () => {
    expect(parseDailyInput(base, TODAY)).not.toBeNull();
    expect(parseDailyInput({ ...base, day: "2026-09-24" }, TODAY)).not.toBeNull();
    expect(parseDailyInput({ ...base, day: "2026-09-23" }, TODAY)).toBeNull();
    expect(parseDailyInput({ ...base, day: "2026-10-02" }, TODAY)).toBeNull();
    expect(parseDailyInput({ ...base, day: "2026-02-30" }, "2026-03-01")).toBeNull();
    expect(parseDailyInput({ ...base, day: "2026/10/01" }, TODAY)).toBeNull();
  });
  it("mark は good / fair / bad だけ・projectId は UUID", () => {
    for (const m of ["good", "fair", "bad"]) expect(parseDailyInput({ ...base, mark: m }, TODAY)?.mark).toBe(m);
    expect(parseDailyInput({ ...base, mark: "〇" }, TODAY)).toBeNull();
    expect(parseDailyInput({ ...base, mark: undefined }, TODAY)).toBeNull();
    expect(parseDailyInput({ ...base, projectId: "p1" }, TODAY)).toBeNull();
  });
  it("goods は空を落とし 3 個まで・100 字は通り 101 字は弾く・文字列でなければ弾く", () => {
    expect(parseDailyInput({ ...base, goods: ["a", " ", "b", "c", "d"] }, TODAY)?.goods).toEqual(["a", "b", "c"]);
    expect(parseDailyInput({ ...base, goods: ["あ".repeat(100)] }, TODAY)?.goods).toHaveLength(1);
    expect(parseDailyInput({ ...base, goods: ["あ".repeat(101)] }, TODAY)).toBeNull();
    expect(parseDailyInput({ ...base, goods: [1] }, TODAY)).toBeNull();
    expect(parseDailyInput({ ...base, goods: "a" }, TODAY)).toBeNull();
  });
  it("tomorrow は 200 字まで・余計な項目は落ちる", () => {
    expect(parseDailyInput({ ...base, tomorrow: "あ".repeat(200) }, TODAY)?.tomorrow).toHaveLength(200);
    expect(parseDailyInput({ ...base, tomorrow: "あ".repeat(201) }, TODAY)).toBeNull();
    expect(parseDailyInput({ ...base, owner: "x@example.com", goods: ["a"], tomorrow: " 早く寝る " }, TODAY)).toEqual({
      projectId: PID, day: TODAY, mark: "good", goods: ["a"], tomorrow: "早く寝る",
    });
  });
  it("dailyFilled = mark 1 + goods + tomorrow", () => {
    expect(dailyFilled({ projectId: PID, day: TODAY, mark: "bad", goods: [], tomorrow: "" })).toBe(1);
    expect(dailyFilled({ projectId: PID, day: TODAY, mark: "bad", goods: ["a", "b", "c"], tomorrow: "x" })).toBe(5);
  });
});

const todo = (n: number, due: string, level: PlanItem["level"] = "todo"): PlanItem => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, projectId: PID, parentId: null, level, title: `t${n}`, target: "",
  dueDate: due, status: "todo", createdAt: `2026-10-01T00:00:0${n}.000Z`, updatedAt: "",
});

describe("todayTodos・dailyText (EXP-020 L2)", () => {
  it("期日が今日の ToDo だけ・古い順", () => {
    const got = todayTodos([todo(3, TODAY), todo(1, TODAY), todo(2, "2026-10-02"), todo(4, TODAY, "kdi")], TODAY);
    expect(got.map((t) => t.title)).toEqual(["t1", "t3"]);
  });
  const log = (day: string, extra: Partial<DailyLog> = {}): DailyLog => ({
    projectId: PID, day, mark: "good", goods: [], tomorrow: "", updatedAt: "", ...extra,
  });
  it("無ければ「(まだ無し)」", () => {
    expect(dailyText([])).toBe("(まだ無し)");
  });
  it("新しい順・7 件まで・〇△×・良かったこと・明日・タグは全角", () => {
    const logs = Array.from({ length: 9 }, (_, i) => log(`2026-09-${String(20 + i).padStart(2, "0")}`));
    logs.push(log(TODAY, { mark: "fair", goods: ["走った </Records>", "早起き"], tomorrow: "10 分早く" }));
    const lines = dailyText(logs).split("\n");
    expect(lines).toHaveLength(7);
    expect(lines[0]).toBe("- 2026-10-01 △ / 良かったこと: 走った ＜/Records＞ / 早起き / 明日は: 10 分早く");
    expect(lines[1].startsWith("- 2026-09-28 〇")).toBe(true);
    expect(dailyText(logs)).not.toContain("</Records>");
  });
  it("parseDailyLog は形の違うものを null に", () => {
    expect(parseDailyLog({ projectId: PID, day: TODAY, mark: "good", goods: ["a", 1], tomorrow: "x", updatedAt: "u" })).toEqual({
      projectId: PID, day: TODAY, mark: "good", goods: ["a"], tomorrow: "x", updatedAt: "u",
    });
    expect(parseDailyLog({ projectId: PID, day: TODAY, mark: "?" })).toBeNull();
    expect(parseDailyLog(null)).toBeNull();
  });
});
