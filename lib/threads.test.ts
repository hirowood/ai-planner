import { describe, expect, it } from "vitest";
import { COACH_THREADS, THREAD_LABEL, isCoachThread, threadAllowsChange, threadStep } from "./threads";
import type { PlanItem } from "./plan-items";

const T = "2026-10-02";
let n = 0;
const item = (level: PlanItem["level"], parentId: string | null, extra: Partial<PlanItem> = {}): PlanItem => ({
  id: `id-${String(++n).padStart(3, "0")}`, projectId: "p", parentId, level, title: level, target: "", dueDate: null, status: "todo",
  createdAt: `2026-10-01T00:00:${String(n).padStart(2, "0")}.000Z`, updatedAt: "", ...extra,
} as PlanItem);

describe("目的ごとのチャット (EXP-043)", () => {
  it("5 つの会話に名前がある・それ以外は会話ではない", () => {
    expect(COACH_THREADS).toEqual(["chat", "kgi", "kpi", "kdi", "todo"]);
    for (const t of COACH_THREADS) expect(THREAD_LABEL[t].label.length).toBeGreaterThan(0);
    expect(isCoachThread("todo")).toBe(true);
    expect(isCoachThread("plan")).toBe(false);
    expect(isCoachThread(undefined)).toBe(false);
  });

  it("壁打ちと KGI は足す段を持たない", () => {
    const kgi = item("kgi", null);
    expect(threadStep("chat", [kgi], T)).toBeNull();
    expect(threadStep("kgi", [kgi], T)).toBeNull();
  });

  it("KGI が無ければ KPI・KDI・ToDo の会話も KGI から", () => {
    for (const t of ["kpi", "kdi", "todo"] as const) expect(threadStep(t, [], T)).toEqual({ level: "kgi" });
  });

  it("KPI の会話は KGI の下・KDI の会話は KDI の少ない KPI の下・3 つで止まる", () => {
    const kgi = item("kgi", null);
    const k1 = item("kpi", kgi.id);
    const k2 = item("kpi", kgi.id);
    const d1 = item("kdi", k1.id);
    expect(threadStep("kpi", [kgi, k1], T)).toMatchObject({ level: "kpi", parent: kgi });
    expect(threadStep("kdi", [kgi], T)).toBeNull();
    expect(threadStep("kdi", [kgi, k1, k2, d1], T)).toMatchObject({ level: "kdi", parent: k2, have: 1 });
    const d2 = item("kdi", k2.id);
    const d3 = item("kdi", k1.id);
    expect(threadStep("kdi", [kgi, k1, k2, d1, d2, d3], T)).toBeNull();
    // しまった KDI は数えない
    expect(threadStep("kdi", [kgi, k1, k2, d1, d2, { ...d3, status: "shelved" }], T)).toMatchObject({ level: "kdi", have: 2 });
  });

  it("ToDo の会話は今日の ToDo が 3 つ未満の最初の KDI の下", () => {
    const kgi = item("kgi", null);
    const k1 = item("kpi", kgi.id);
    const d1 = item("kdi", k1.id);
    const d2 = item("kdi", k1.id);
    const todos = [1, 2, 3].map(() => item("todo", d1.id, { dueDate: T }));
    const yesterday = item("todo", d2.id, { dueDate: "2026-10-01" });
    expect(threadStep("todo", [kgi, k1, d1, d2, ...todos, yesterday], T)).toMatchObject({ level: "todo", parent: d2, have: 0, today: T });
    expect(threadStep("todo", [kgi, k1], T)).toBeNull();
  });

  it("変えてよい番号は KPI の会話で K・KDI の会話で D だけ", () => {
    expect(threadAllowsChange("kpi", "K1")).toBe(true);
    expect(threadAllowsChange("kpi", "D1")).toBe(false);
    expect(threadAllowsChange("kdi", "D12")).toBe(true);
    expect(threadAllowsChange("kdi", "K1")).toBe(false);
    for (const t of ["chat", "kgi", "todo"] as const) {
      expect(threadAllowsChange(t, "K1")).toBe(false);
      expect(threadAllowsChange(t, "D1")).toBe(false);
    }
    expect(threadAllowsChange("kpi", "K1x")).toBe(false);
  });
});
