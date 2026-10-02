import { describe, expect, it } from "vitest";
import {
  buildTree,
  CHILD_LEVEL,
  LEVEL_LABEL,
  nextParentFor,
  parseItemInput,
  parseItemPatch,
  STATUS_LABEL,
  STATUS_ORDER,
  statusCounts,
  type ItemStatus,
  type PlanItem,
} from "./plan-items";

const PROJECT_ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b";
const PARENT_ID = "5b6c7d8e-1f2a-4b3c-8d4e-5f6a7b8c9d0e";

const kgiInput = {
  projectId: PROJECT_ID,
  parentId: null,
  level: "kgi",
  title: "10 月末に 5km 歩ける",
  target: "5km",
  dueDate: "2026-10-31",
  status: "todo",
};
const kpiInput = { ...kgiInput, parentId: PARENT_ID, level: "kpi", title: "週 5 日歩く", target: "週 5 日", dueDate: "" };

describe("定数 (EXP-017 L1)", () => {
  it("段と状態のラベル・順番・子の段 (EXP-017 L1)", () => {
    expect(LEVEL_LABEL).toEqual({ kgi: "KGI (ゴール)", kpi: "KPI (途中の指標)", kdi: "KDI (行動の目標)", todo: "ToDo" });
    expect(STATUS_LABEL).toEqual({
      todo: "未実行", doing: "実行中", done: "実行", shelved: "棚上げ", failed: "失敗", succeeded: "成功", adjusted: "調整",
    });
    // EXP-034 で「実行中」(doing) を足した
    expect(STATUS_ORDER).toEqual(["todo", "doing", "done", "shelved", "failed", "succeeded", "adjusted"]);
    expect(CHILD_LEVEL).toEqual({ kgi: "kpi", kpi: "kdi", kdi: "todo", todo: null });
  });
});

describe("parseItemInput (EXP-017 L1)", () => {
  it.each([
    ["kgi (親なし・期日あり)", kgiInput],
    ["kpi (UUID の親・期日なし)", kpiInput],
    ["kdi", { ...kpiInput, level: "kdi" }],
    ["todo・状態 失敗", { ...kpiInput, level: "todo", status: "failed" }],
    ["200 字のタイトル・200 字の目標値", { ...kgiInput, title: "あ".repeat(200), target: "い".repeat(200) }],
    ["目標値が空", { ...kgiInput, target: "" }],
    ["うるう日", { ...kgiInput, dueDate: "2028-02-29" }],
  ])("正しい値を通す: %s (EXP-017 L1)", (_label, input) => {
    expect(parseItemInput(input)).toEqual(input);
  });

  it.each(STATUS_ORDER)("状態 %s を通す (EXP-017 L1)", (status) => {
    expect(parseItemInput({ ...kgiInput, status })?.status).toBe(status);
  });

  it("状態を省くと todo (EXP-017 L1)", () => {
    const rest: Record<string, unknown> = { ...kgiInput };
    delete rest.status;
    expect(parseItemInput(rest)).toEqual({ ...rest, status: "todo" });
  });

  it.each([
    ["空のタイトル", { ...kgiInput, title: "" }],
    ["空白だけのタイトル", { ...kgiInput, title: "   " }],
    ["201 字のタイトル", { ...kgiInput, title: "あ".repeat(201) }],
    ["201 字の目標値", { ...kgiInput, target: "い".repeat(201) }],
    ["知らない段", { ...kgiInput, level: "okr" }],
    ["知らない状態", { ...kgiInput, status: "in_progress" }],
    ["kgi に親", { ...kgiInput, parentId: PARENT_ID }],
    ["kpi に親なし", { ...kpiInput, parentId: null }],
    ["UUID でない親", { ...kpiInput, parentId: "not-a-uuid" }],
    ["実在しない日付 (2/30)", { ...kgiInput, dueDate: "2026-02-30" }],
    ["実在しない日付 (13 月)", { ...kgiInput, dueDate: "2026-13-01" }],
    ["うるう年でない 2/29", { ...kgiInput, dueDate: "2026-02-29" }],
    ["YYYY-MM-DD でない日付", { ...kgiInput, dueDate: "2026/10/31" }],
    ["オブジェクトでない", "kgi"],
    ["null", null],
    ["配列", [kgiInput]],
  ])("%s は null (EXP-017 L1)", (_label, input) => {
    expect(parseItemInput(input)).toBeNull();
  });
});

describe("parseItemPatch (EXP-017 L1)", () => {
  it.each([
    ["状態だけ", { status: "shelved" }],
    ["タイトルと期日", { title: "朝の散歩", dueDate: "2026-10-01" }],
    ["期日を消す", { dueDate: "" }],
    ["目標値を空に", { target: "" }],
    ["4 つ全部", { title: "t", target: "u", dueDate: "2026-12-31", status: "adjusted" }],
  ])("正しい値を通す: %s (EXP-017 L1)", (_label, patch) => {
    expect(parseItemPatch(patch)).toEqual(patch);
  });

  it.each([
    ["項目が 1 つも無い", {}],
    ["変えられない項目だけ", { level: "kpi" }],
    ["空のタイトル", { title: "" }],
    ["201 字のタイトル", { title: "あ".repeat(201) }],
    ["201 字の目標値", { target: "い".repeat(201) }],
    ["知らない状態", { status: "in_progress" }],
    ["実在しない日付", { dueDate: "2026-02-30" }],
    ["オブジェクトでない", "done"],
    ["null", null],
  ])("%s は null (EXP-017 L1)", (_label, patch) => {
    expect(parseItemPatch(patch)).toBeNull();
  });
});

// --- L2 ---

const T = (n: number) => `2026-09-30T0${n}:00:00.000Z`;

function item(id: string, level: PlanItem["level"], parentId: string | null, createdAt: string, status: ItemStatus = "todo"): PlanItem {
  return { id, projectId: PROJECT_ID, parentId, level, title: `title-${id}`, target: "", dueDate: "", status, createdAt, updatedAt: createdAt };
}

describe("buildTree (EXP-017 L2)", () => {
  it("4 段が親子に組まれる (EXP-017 L2)", () => {
    const items = [
      item("t1", "todo", "d1", T(4)),
      item("d1", "kdi", "p1", T(3)),
      item("p1", "kpi", "k1", T(2)),
      item("k1", "kgi", null, T(1)),
    ];
    const tree = buildTree(items);
    expect(tree.map((n) => n.id)).toEqual(["k1"]);
    const [k1] = tree;
    expect(k1.children.map((n) => n.id)).toEqual(["p1"]);
    expect(k1.children[0].children.map((n) => n.id)).toEqual(["d1"]);
    expect(k1.children[0].children[0].children.map((n) => n.id)).toEqual(["t1"]);
    expect(k1.children[0].children[0].children[0].children).toEqual([]);
    expect(k1).toMatchObject(items[3]);
  });

  it("親が見つからない項目は一番上に置く (EXP-017 L2)", () => {
    const tree = buildTree([item("k1", "kgi", null, T(1)), item("orphan", "kpi", "gone", T(2))]);
    expect(tree.map((n) => n.id).sort()).toEqual(["k1", "orphan"]);
    expect(tree.find((n) => n.id === "orphan")?.children).toEqual([]);
  });

  it("同じ親の中は createdAt の古い順 (EXP-017 L2)", () => {
    const tree = buildTree([
      item("k1", "kgi", null, T(1)),
      item("p3", "kpi", "k1", T(5)),
      item("p1", "kpi", "k1", T(2)),
      item("p2", "kpi", "k1", T(3)),
    ]);
    expect(tree[0].children.map((n) => n.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("空なら空 (EXP-017 L2)", () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe("statusCounts (EXP-017 L2)", () => {
  it("6 つの状態すべての件数 (無い状態は 0) (EXP-017 L2)", () => {
    const items = [
      item("a", "kgi", null, T(1), "todo"),
      item("b", "kpi", "a", T(2), "done"),
      item("c", "kpi", "a", T(3), "done"),
      item("d", "kdi", "b", T(4), "failed"),
    ];
    expect(statusCounts(items)).toEqual({ todo: 1, done: 2, shelved: 0, failed: 1, succeeded: 0, adjusted: 0 });
  });

  it("空なら全部 0 (EXP-017 L2)", () => {
    expect(statusCounts([])).toEqual({ todo: 0, done: 0, shelved: 0, failed: 0, succeeded: 0, adjusted: 0 });
  });
});

describe("nextParentFor (EXP-017 L2)", () => {
  const items = [item("k1", "kgi", null, T(1)), item("p1", "kpi", "k1", T(2))];

  it("前に使った親が今もあればそれ (EXP-017 L2)", () => {
    expect(nextParentFor(items, "p1")).toEqual(items[1]);
  });

  it.each([
    ["前の親が消えている", "gone"],
    ["前の親が無い", null],
  ])("%s なら null (EXP-017 L2)", (_label, last) => {
    expect(nextParentFor(items, last)).toBeNull();
  });
});
