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

const TODAY = "2026-10-02";

describe("nextHierarchyStep (EXP-019 L1 → EXP-031 L1)", () => {
  it("KGI が無い → kgi", () => {
    expect(nextHierarchyStep([], TODAY)).toEqual({ level: "kgi" });
  });
  it("KGI だけ → KGI の下に kpi", () => {
    const kgi = item(1, "kgi", null);
    expect(nextHierarchyStep([kgi], TODAY)).toEqual({ level: "kpi", parent: kgi });
  });
  it("KDI 0 → 古い順で最初の KPI の下に kdi", () => {
    const kgi = item(1, "kgi", null);
    const kpiA = item(2, "kpi", 1);
    const kpiB = item(3, "kpi", 1);
    // 並びを逆にしても古い方 (kpiA) を選ぶ
    expect(nextHierarchyStep([kpiB, kgi, kpiA], TODAY)).toEqual({ level: "kdi", parent: kpiA, have: 0 });
  });
  it("KDI 1 (KPI A の下) → KDI の少ない KPI B の下に kdi", () => {
    const kgi = item(1, "kgi", null);
    const kpiA = item(2, "kpi", 1);
    const kpiB = item(3, "kpi", 1);
    const kdi = item(4, "kdi", 2);
    expect(nextHierarchyStep([kgi, kpiA, kpiB, kdi], TODAY)).toEqual({ level: "kdi", parent: kpiB, have: 1 });
  });
  it("KDI 2 で ToDo があっても、3 つになるまで kdi (EXP-031)", () => {
    const kgi = item(1, "kgi", null);
    const kpi = item(2, "kpi", 1);
    const all = [kgi, kpi, item(3, "kdi", 2), item(4, "kdi", 2), item(5, "todo", 3, { dueDate: TODAY })];
    expect(nextHierarchyStep(all, TODAY)).toEqual({ level: "kdi", parent: kpi, have: 2 });
  });
  it("棚上げの KDI は数えない (EXP-031)", () => {
    const kgi = item(1, "kgi", null);
    const kpi = item(2, "kpi", 1);
    const all = [kgi, kpi, item(3, "kdi", 2), item(4, "kdi", 2), item(5, "kdi", 2, { status: "shelved" })];
    expect(nextHierarchyStep(all, TODAY)?.level).toBe("kdi");
  });
  it("KDI 3 で今日の ToDo 0 → 最初の KDI の下に todo (have 0)・別の日の ToDo は数えない (EXP-031)", () => {
    const kgi = item(1, "kgi", null);
    const kpi = item(2, "kpi", 1);
    const kdiA = item(3, "kdi", 2);
    const all = [kgi, kpi, kdiA, item(4, "kdi", 2), item(5, "kdi", 2), item(6, "todo", 3, { dueDate: "2026-10-01" })];
    expect(nextHierarchyStep(all, TODAY)).toEqual({ level: "todo", parent: kdiA, today: TODAY, have: 0 });
  });
  it("今日の ToDo が 2 → 同じ KDI (have 2)・3 になったら次の KDI (EXP-031)", () => {
    const kgi = item(1, "kgi", null);
    const kpi = item(2, "kpi", 1);
    const kdiA = item(3, "kdi", 2);
    const kdiB = item(4, "kdi", 2);
    const base = [kgi, kpi, kdiA, kdiB, item(5, "kdi", 2)];
    const two = [...base, item(6, "todo", 3, { dueDate: TODAY }), item(7, "todo", 3, { dueDate: TODAY })];
    expect(nextHierarchyStep(two, TODAY)).toEqual({ level: "todo", parent: kdiA, today: TODAY, have: 2 });
    const three = [...two, item(8, "todo", 3, { dueDate: TODAY })];
    expect(nextHierarchyStep(three, TODAY)).toEqual({ level: "todo", parent: kdiB, today: TODAY, have: 0 });
  });
  it("3 つの KDI に今日の ToDo が 3 つずつ (9 つ) → null (EXP-031)", () => {
    const all = [item(1, "kgi", null), item(2, "kpi", 1), item(3, "kdi", 2), item(4, "kdi", 2), item(5, "kdi", 2)];
    let n = 10;
    for (const k of [3, 4, 5]) for (let i = 0; i < 3; i++) all.push(item(n++, "todo", k, { dueDate: TODAY }));
    expect(nextHierarchyStep(all, TODAY)).toBeNull();
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
    expect(lines[1].startsWith("  - KPI: 模試 700 ＜/Records＞ / 判定基準 700 点 / 実行")).toBe(true);
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
    const out = parseProposedItems(Array.from({ length: 5 }, (_, i) => ({ title: `t${i}` })), { level: "kdi", parent: kpi, have: 0 }, PID);
    expect(out.map((o) => o.title)).toEqual(["t0", "t1", "t2"]);
  });
  it("空の題・201 字・実在しない日付・形の違うものは捨てる", () => {
    const out = parseProposedItems(
      [{ title: "" }, { title: "あ".repeat(201) }, { title: "ok", dueDate: "2026-02-30" }, "str", null],
      { level: "kdi", parent: kpi, have: 0 },
      PID,
    );
    expect(out).toEqual([]);
  });
  it("200 字は通る", () => {
    expect(parseProposedItems([{ title: "あ".repeat(200) }], { level: "kdi", parent: kpi, have: 0 }, PID)).toHaveLength(1);
  });
  it("step が kgi / null・配列でない → []", () => {
    expect(parseProposedItems([{ title: "x" }], { level: "kgi" }, PID)).toEqual([]);
    expect(parseProposedItems([{ title: "x" }], null, PID)).toEqual([]);
    expect(parseProposedItems({ title: "x" }, { level: "kdi", parent: kpi, have: 0 }, PID)).toEqual([]);
  });
});

describe("parseProposedItems — KDI は目安の 3 つまで (安全レビュー W5)", () => {
  const kpi = item(2, "kpi", 1);
  const many = [{ title: "a" }, { title: "b" }, { title: "c" }];
  it("今 2 つなら 1 つまで・3 つなら 0・0 なら 3 つ", () => {
    expect(parseProposedItems(many, { level: "kdi", parent: kpi, have: 2 }, PID).map((o) => o.title)).toEqual(["a"]);
    expect(parseProposedItems(many, { level: "kdi", parent: kpi, have: 3 }, PID)).toEqual([]);
    expect(parseProposedItems(many, { level: "kdi", parent: kpi, have: 0 }, PID)).toHaveLength(3);
  });
});

describe("parseProposedItems — 今日の ToDo (EXP-031 L2)", () => {
  const kdi = item(3, "kdi", 2);
  const step = (have: number) => ({ level: "todo" as const, parent: kdi, today: TODAY, have });
  it("期日が空なら今日・明日の期日は捨てる・今日はそのまま", () => {
    const out = parseProposedItems(
      [{ title: "a" }, { title: "b", dueDate: "2026-10-03" }, { title: "c", dueDate: TODAY, target: "単語 30 個を言える" }],
      step(0),
      PID,
    );
    expect(out.map((o) => [o.title, o.dueDate, o.parentId, o.level])).toEqual([
      ["a", TODAY, kdi.id, "todo"],
      ["c", TODAY, kdi.id, "todo"],
    ]);
    expect(out[1].target).toBe("単語 30 個を言える");
  });
  it("have 2 なら 1 つまで・have 3 なら 0", () => {
    const many = [{ title: "a" }, { title: "b" }, { title: "c" }];
    expect(parseProposedItems(many, step(2), PID).map((o) => o.title)).toEqual(["a"]);
    expect(parseProposedItems(many, step(3), PID)).toEqual([]);
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
