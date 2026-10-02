import { describe, expect, it } from "vitest";
import { completeMessage, judgedNotice, parseJudgement, pendingJudgement } from "./judgement";
import { STATUS_LABEL, STATUS_ORDER, type PlanItem } from "./plan-items";

const PID = "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b";
const TODAY = "2026-10-02";
const todo = (n: number, extra: Partial<PlanItem>): PlanItem => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, projectId: PID, parentId: null, level: "todo", title: `t${n}`, target: "",
  dueDate: TODAY, status: "done", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: `2026-10-02T0${n}:00:00.000Z`, ...extra,
});

describe("状態「実行中」(EXP-034 L1)", () => {
  it("doing = 実行中 が 未実行 と 実行 の間にある", () => {
    expect(STATUS_LABEL.doing).toBe("実行中");
    expect(STATUS_ORDER.slice(0, 3)).toEqual(["todo", "doing", "done"]);
  });
});

describe("pendingJudgement (EXP-034 L1)", () => {
  it("状態が「実行」の ToDo のうち一番新しく更新されたもの", () => {
    const got = pendingJudgement([todo(1, {}), todo(3, {}), todo(2, {})], TODAY);
    expect(got?.title).toBe("t3");
  });
  it("実行中・成功・未実行・KDI は判定待ちでない", () => {
    expect(pendingJudgement([todo(1, { status: "doing" }), todo(2, { status: "succeeded" }), todo(3, { status: "todo" }), todo(4, { level: "kdi" })], TODAY)).toBeNull();
  });
  it("6 日前までは入れ、7 日前と未来は外す", () => {
    expect(pendingJudgement([todo(1, { dueDate: "2026-09-26" })], TODAY)?.title).toBe("t1");
    expect(pendingJudgement([todo(1, { dueDate: "2026-09-25" })], TODAY)).toBeNull();
    expect(pendingJudgement([todo(1, { dueDate: "2026-10-03" })], TODAY)).toBeNull();
    expect(pendingJudgement([], TODAY)).toBeNull();
  });
});

describe("parseJudgement・completeMessage・judgedNotice (EXP-034 L1)", () => {
  it("succeeded / failed / adjusted だけ", () => {
    for (const j of ["succeeded", "failed", "adjusted"]) expect(parseJudgement(j)).toBe(j);
    for (const x of ["done", "todo", "", "成功", null, 1]) expect(parseJudgement(x)).toBeNull();
  });
  it("完了の文とお知らせの文", () => {
    expect(completeMessage("単語 30 個")).toBe("『単語 30 個』を完了しました。判定をお願いします");
    expect(judgedNotice({ title: "単語 30 個", status: "succeeded" })).toBe("『単語 30 個』を成功と判定しました");
    expect(judgedNotice({ title: "x", status: "failed" })).toBe("『x』を失敗と判定しました");
    expect(judgedNotice({ title: "x", status: "done" })).toBeNull();
    expect(judgedNotice(null)).toBeNull();
  });
});
