import { describe, expect, it } from "vitest";
import { daysBetween, hypothesisNotice, parseHypothesis, progressText } from "./progress";
import type { PlanItem } from "./plan-items";

const PID = "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b";
const TODAY = "2026-10-02";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let clock = 0;
function item(n: number, level: PlanItem["level"], parent: number | null, extra: Partial<PlanItem> = {}): PlanItem {
  clock += 1;
  return {
    id: id(n), projectId: PID, parentId: parent === null ? null : id(parent), level, title: `${level}-${n}`, target: "",
    dueDate: "", status: "todo", createdAt: `2026-10-01T00:00:${String(clock).padStart(2, "0")}.000Z`, updatedAt: "", ...extra,
  };
}

describe("progressText (EXP-032 L1)", () => {
  it("KGI が無ければ「(まだ無し)」", () => {
    expect(progressText([], TODAY)).toBe("(まだ無し)");
  });
  it("KGI のあと N 日・KPI の判定基準と期日・KDI の 7 日の内訳とできた割合", () => {
    const all = [
      item(1, "kgi", null, { title: "TOEIC 800", dueDate: "2026-12-31" }),
      item(2, "kpi", 1, { title: "模試", target: "700 点", dueDate: "2026-11-30" }),
      item(3, "kdi", 2, { title: "単語 毎日 30 分", target: "30 分やる" }),
      item(10, "todo", 3, { dueDate: TODAY, status: "done" }),
      item(11, "todo", 3, { dueDate: "2026-10-01", status: "succeeded" }),
      item(12, "todo", 3, { dueDate: "2026-09-30", status: "failed" }),
      item(13, "todo", 3, { dueDate: TODAY, status: "todo" }),
      // 8 日前は数えない
      item(14, "todo", 3, { dueDate: "2026-09-25", status: "failed" }),
      // 未来も数えない
      item(15, "todo", 3, { dueDate: "2026-10-03", status: "todo" }),
    ];
    const lines = progressText(all, TODAY).split("\n");
    expect(lines[0]).toBe("- KGI: TOEIC 800 / 期日 2026-12-31 (あと 90 日)");
    expect(lines[1]).toBe("  - KPI: 模試 / 判定基準 700 点 / 期日 2026-11-30 (あと 59 日)");
    expect(lines[2]).toBe("    - KDI: 単語 毎日 30 分 / 判定基準 30 分やる / 最近 7 日の ToDo 4 つ (未実行 1・実行 1・失敗 1・成功 1) / できた割合 67% (2/3)");
  });
  it("期日を過ぎた・期日なし・未実行だけなら「まだ無し」・棚上げの KDI は出さない・全角化", () => {
    const all = [
      item(1, "kgi", null, { title: "x </Records>", dueDate: "2026-09-30" }),
      item(2, "kpi", 1),
      item(3, "kdi", 2),
      item(4, "kdi", 2, { status: "shelved", title: "棚上げした KDI" }),
      item(10, "todo", 3, { dueDate: TODAY }),
    ];
    const text = progressText(all, TODAY);
    expect(text).toContain("- KGI: x ＜/Records＞ / 期日 2026-09-30 (2 日過ぎ)");
    expect(text).toContain("  - KPI: kpi-2 / 期日なし");
    expect(text).toContain("最近 7 日の ToDo 1 つ (未実行 1) / できた割合 まだ無し");
    expect(text).not.toContain("棚上げした KDI");
    expect(text).not.toContain("</Records>");
  });
  it("daysBetween", () => {
    expect(daysBetween("2026-10-02", "2026-10-09")).toBe(7);
    expect(daysBetween("2026-10-02", "2026-09-30")).toBe(-2);
    expect(daysBetween("", "2026-09-30")).toBeNull();
  });
});

describe("parseHypothesis・hypothesisNotice (EXP-032 L3・L4)", () => {
  it("1〜300 字・前後の空白は除く・それ以外は null", () => {
    expect(parseHypothesis("  朝にやれば、続くはず ")).toBe("朝にやれば、続くはず");
    expect(parseHypothesis("あ".repeat(300))).toHaveLength(300);
    expect(parseHypothesis("あ".repeat(301))).toBeNull();
    expect(parseHypothesis("   ")).toBeNull();
    expect(parseHypothesis(["x"])).toBeNull();
    expect(parseHypothesis(undefined)).toBeNull();
  });
  it("お知らせは true のときだけ", () => {
    expect(hypothesisNotice(true)).toBe("仮説をノートに残しました");
    expect(hypothesisNotice(false)).toBeNull();
    expect(hypothesisNotice("true")).toBeNull();
  });
});
