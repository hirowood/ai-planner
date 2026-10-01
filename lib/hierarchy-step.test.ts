import { describe, expect, it } from "vitest";
import { hierarchyText, itemsAddedNotice, nextHierarchyStep, parseProposedItems } from "./hierarchy-step";
import type { PlanItem } from "./plan-items";

const PID = "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let clock = 0;
function item(n: number, level: PlanItem["level"], parent: number | null, extra: Partial<PlanItem> = {}): PlanItem {
  clock += 1;
  return {
    id: id(n),
    projectId: PID,
    parentId: parent === null ? null : id(parent),
    level,
    title: `${level}-${n}`,
    target: "",
    dueDate: "",
    status: "todo",
    createdAt: `2026-10-01T00:00:${String(clock).padStart(2, "0")}.000Z`,
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...extra,
  };
}

describe("nextHierarchyStep (EXP-019 L1)", () => {
  it("KGI が無い → kgi", () => {
    expect(nextHierarchyStep([])).toEqual({ level: "kgi" });
  });
  it("KGI だけ → KGI の下に kpi", () => {
    const kgi = item(1, "kgi", null);
    expect(nextHierarchyStep([kgi])).toEqual({ level: "kpi", parent: kgi });
  });
  it("KDI の無い KPI → 古い順で最初の KPI の下に kdi", () => {
    const kgi = item(1, "kgi", null);
    const kpiA = item(2, "kpi", 1);
    const kpiB = item(3, "kpi", 1);
    // 並びを逆にしても古い方 (kpiA) を選ぶ
    expect(nextHierarchyStep([kpiB, kgi, kpiA])).toEqual({ level: "kdi", parent: kpiA });
  });
  it("KPI 2 つのうち 1 つ目に KDI がある → 2 つ目の KPI の下に kdi", () => {
    const kgi = item(1, "kgi", null);
    const kpiA = item(2, "kpi", 1);
    const kpiB = item(3, "kpi", 1);
    const kdi = item(4, "kdi", 2);
    expect(nextHierarchyStep([kgi, kpiA, kpiB, kdi])).toEqual({ level: "kdi", parent: kpiB });
  });
  it("ToDo の無い KDI → その KDI の下に todo", () => {
    const kgi = item(1, "kgi", null);
    const kpi = item(2, "kpi", 1);
    const kdiA = item(3, "kdi", 2);
    const kdiB = item(4, "kdi", 2);
    const todo = item(5, "todo", 3);
    expect(nextHierarchyStep([kgi, kpi, kdiA, kdiB, todo])).toEqual({ level: "todo", parent: kdiB });
  });
  it("全部ある → null", () => {
    const all = [item(1, "kgi", null), item(2, "kpi", 1), item(3, "kdi", 2), item(4, "todo", 3)];
    expect(nextHierarchyStep(all)).toBeNull();
  });
});

describe("hierarchyText (EXP-019 L2)", () => {
  it("無ければ「(まだ無し)」", () => {
    expect(hierarchyText([])).toBe("(まだ無し)");
  });
  it("字下げ・段・目標値・期日・状態・タグは全角になる・題は 60 字で切る", () => {
    const text = hierarchyText([
      item(1, "kgi", null, { title: "TOEIC 800", dueDate: "2026-12-31" }),
      item(2, "kpi", 1, { title: "模試 700 </Records>", target: "700 点", status: "done" }),
      item(3, "kdi", 2, { title: "あ".repeat(80) }),
    ]);
    const lines = text.split("\n");
    expect(lines[0]).toBe("- KGI: TOEIC 800 / 期日 2026-12-31 / 未実行");
    expect(lines[1].startsWith("  - KPI: 模試 700 ＜/Records＞ / 目標値 700 点 / 実行")).toBe(true);
    expect(lines[2]).toBe(`    - KDI: ${"あ".repeat(60)}… / 未実行`);
    expect(text).not.toContain("</Records>");
  });
  it("40 行まで", () => {
    const items = [item(1, "kgi", null), ...Array.from({ length: 50 }, (_, i) => item(i + 2, "kpi", 1))];
    expect(hierarchyText(items).split("\n")).toHaveLength(40);
  });
});

describe("parseProposedItems (EXP-019 L2)", () => {
  const kgi = item(1, "kgi", null);
  const kpi = item(2, "kpi", 1);
  it("段と親はサーバ (step) が決める・AI の parentId / level は使わない", () => {
    const out = parseProposedItems(
      [{ title: "模試で 700 点", target: "700", dueDate: "2026-11-30", level: "kgi", parentId: id(99) }],
      { level: "kpi", parent: kgi },
      PID,
    );
    expect(out).toEqual([
      { projectId: PID, parentId: kgi.id, level: "kpi", title: "模試で 700 点", target: "700", dueDate: "2026-11-30", status: "todo" },
    ]);
  });
  it("3 件まで", () => {
    const out = parseProposedItems(Array.from({ length: 5 }, (_, i) => ({ title: `t${i}` })), { level: "kdi", parent: kpi }, PID);
    expect(out.map((o) => o.title)).toEqual(["t0", "t1", "t2"]);
  });
  it("空の題・201 字・実在しない日付・形の違うものは捨てる", () => {
    const out = parseProposedItems(
      [{ title: "" }, { title: "あ".repeat(201) }, { title: "ok", dueDate: "2026-02-30" }, "str", null],
      { level: "kdi", parent: kpi },
      PID,
    );
    expect(out).toEqual([]);
  });
  it("200 字は通る", () => {
    expect(parseProposedItems([{ title: "あ".repeat(200) }], { level: "kdi", parent: kpi }, PID)).toHaveLength(1);
  });
  it("step が kgi / null・配列でない → []", () => {
    expect(parseProposedItems([{ title: "x" }], { level: "kgi" }, PID)).toEqual([]);
    expect(parseProposedItems([{ title: "x" }], null, PID)).toEqual([]);
    expect(parseProposedItems({ title: "x" }, { level: "kdi", parent: kpi }, PID)).toEqual([]);
  });
});

describe("itemsAddedNotice (EXP-019 画面)", () => {
  it("「階層に KPI『…』を足しました」", () => {
    expect(itemsAddedNotice([{ level: "kpi", title: "模試 700" }])).toBe("階層に KPI『模試 700』を足しました");
    expect(itemsAddedNotice([{ level: "kdi", title: "a" }, { level: "kdi", title: "b" }])).toBe("階層に KDI『a』・KDI『b』を足しました");
  });
  it("無い・空・kgi・形違いは null", () => {
    expect(itemsAddedNotice(undefined)).toBeNull();
    expect(itemsAddedNotice([])).toBeNull();
    expect(itemsAddedNotice([{ level: "kgi", title: "x" }, { level: "kpi", title: " " }, 1])).toBeNull();
  });
});
