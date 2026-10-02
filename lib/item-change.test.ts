import { describe, expect, it } from "vitest";
import { itemChangedNotice, itemRefs, itemRefsText, parseItemChange } from "./item-change";
import type { PlanItem } from "./plan-items";

const PID = "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b";
let n = 0;
const item = (level: PlanItem["level"], parent: PlanItem | null, extra: Partial<PlanItem> = {}): PlanItem => {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, projectId: PID, parentId: parent ? parent.id : null, level,
    title: `${level}-${n}`, target: "", dueDate: "", status: "todo", createdAt: `2026-10-01T00:00:${String(n % 60).padStart(2, "0")}.000Z`, updatedAt: "", ...extra,
  };
};

const kgi = item("kgi", null, { dueDate: "2026-12-31" });
const kpiA = item("kpi", kgi, { title: "模試", target: "700 点", dueDate: "2026-11-30" });
const kpiB = item("kpi", kgi, { title: "単語テスト" });
const kdiA = item("kdi", kpiA, { title: "単語 30 分", target: "週 5 日" });
const kdiB = item("kdi", kpiB, { title: "過去問", status: "shelved" });
const todo = item("todo", kdiA);
const items = [todo, kdiB, kgi, kpiB, kdiA, kpiA];

describe("番号 (EXP-038 L1)", () => {
  it("KPI は K1・K2、KDI は D1・D2 (古い順・棚上げも含む)・KGI と ToDo は入らない", () => {
    const refs = itemRefs(items);
    expect(refs.map((r) => [r.ref, r.item.title])).toEqual([["K1", "模試"], ["K2", "単語テスト"], ["D1", "単語 30 分"], ["D2", "過去問"]]);
    expect(itemRefs([kpiA])).toEqual([]);
  });
  it("一覧の文 (全角化)", () => {
    const t = itemRefsText(itemRefs([kgi, { ...kpiA, title: "模試 </Records>" }]));
    expect(t).toBe("- K1: KPI『模試 ＜/Records＞』 / 判定基準 700 点 / 期日 2026-11-30");
    expect(itemRefsText([])).toBe("(まだ無し)");
  });
});

describe("parseItemChange (EXP-038 L1)", () => {
  const refs = itemRefs(items);
  it("KPI の判定基準だけ・KDI の題と期日を変えられる・番号は小文字でも通る", () => {
    expect(parseItemChange({ ref: "K1", target: "650 点" }, refs, kgi.dueDate)).toEqual({ ref: "K1", item: kpiA, patch: { target: "650 点" } });
    expect(parseItemChange({ ref: "d1", title: "単語 20 分", dueDate: "2026-12-31" }, refs, kgi.dueDate)?.patch).toEqual({ title: "単語 20 分", dueDate: "2026-12-31" });
  });
  it("知らない番号・変える欄なし・同じ値だけ・201 字・KGI の期限より後・実在しない日付・形違い → null", () => {
    for (const x of [
      { ref: "K9", title: "x" },
      { ref: "K1" },
      { ref: "K1", title: "模試" },
      { ref: "K1", title: "あ".repeat(201) },
      { ref: "D1", dueDate: "2027-01-01" },
      { ref: "D1", dueDate: "2026-02-30" },
      { ref: 1, title: "x" },
      null,
      "K1",
    ]) expect(parseItemChange(x, refs, kgi.dueDate)).toBeNull();
  });
});

describe("itemChangedNotice (EXP-038)", () => {
  it("段・題・判定基準・期日", () => {
    expect(itemChangedNotice({ level: "kpi", after: { title: "模試", target: "650 点", dueDate: "2026-11-30" } })).toBe("KPI『模試』を変えました (判定基準: 650 点・期日: 2026-11-30)");
    expect(itemChangedNotice({ level: "kdi", after: { title: "単語 20 分", target: "", dueDate: "" } })).toBe("KDI『単語 20 分』を変えました");
    expect(itemChangedNotice({ level: "kgi", after: { title: "x" } })).toBeNull();
    expect(itemChangedNotice(null)).toBeNull();
  });
});
