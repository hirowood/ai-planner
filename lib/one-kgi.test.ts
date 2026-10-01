import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { KGI_EXISTS, createItem } from "./repo";
import { PlanTree } from "../app/components/PlanTree";
import type { PlanItem } from "./plan-items";

const P = "123e4567-e89b-12d3-a456-426614174000";
const KGI_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const now = new Date();
const row = (level: string, parent: string | null) => ({ id: "bbbbbbbb-0000-4000-8000-000000000009", project_id: P, parent_id: parent, level, title: "t", target: "", due_date: null, status: "todo", created_at: now, updated_at: now });

// 偽の DB: KGI がある / 無い・親の段を見て、条件どおりなら行を返す
function fakeSql(opts: { kgiExists: boolean }) {
  return (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join("?");
    if (/^\s*select 1 from plan_items i\s+join projects/i.test(q)) return opts.kgiExists ? [{ x: 1 }] : [];
    if (/insert into plan_items/i.test(q)) {
      if (/not exists/i.test(q)) return opts.kgiExists ? [] : [row("kgi", null)];
      // 親あり: 期待する親の段 (values の最後) が kgi のときだけ通る (= KPI だけが KGI の下に入る)
      const expectedParentLevel = values[values.length - 1];
      return expectedParentLevel === "kgi" ? [row(String(values[3]), KGI_ID)] : [];
    }
    return [];
  }) as never;
}
const input = (level: PlanItem["level"], parentId: string | null) => ({ projectId: P, parentId, level, title: "x", target: "", dueDate: "", status: "todo" as const });

describe("KGI は 1 つ・KGI に足せるのは KPI だけ: repo (EXP-026 L1)", () => {
  it("KGI がある所へ 2 つ目の KGI は KGI_EXISTS", async () => {
    expect(await createItem(fakeSql({ kgiExists: true }), "o", input("kgi", null))).toBe(KGI_EXISTS);
  });
  it("KGI が無ければ KGI を作れる", async () => {
    expect(await createItem(fakeSql({ kgiExists: false }), "o", input("kgi", null))).toMatchObject({ level: "kgi" });
  });
  it("KGI の下: KPI は作れる・KDI と ToDo は作れない (段が合わない)", async () => {
    // KGI_ID を親にして KPI を作る → 期待する親の段は kgi
    expect(await createItem(fakeSql({ kgiExists: true }), "o", input("kpi", KGI_ID))).toMatchObject({ level: "kpi" });
    // KDI の親は kpi でなければならない・ToDo の親は kdi → KGI の下には入らない
    expect(await createItem(fakeSql({ kgiExists: true }), "o", input("kdi", KGI_ID))).toBeNull();
    expect(await createItem(fakeSql({ kgiExists: true }), "o", input("todo", KGI_ID))).toBeNull();
  });
});

const item = (id: string, level: PlanItem["level"], parentId: string | null, title: string): PlanItem => ({
  id, projectId: P, parentId, level, title, target: "", dueDate: "", status: "todo",
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
});
const noop = () => {};
const render = (items: PlanItem[]) =>
  renderToStaticMarkup(createElement(PlanTree, { items, lastParentId: null, onCreate: noop, onUpdate: noop, onDelete: noop, onLastParentChange: noop }));

describe("KGI は 1 つ: 画面 (EXP-026 L2)", () => {
  it("KGI があれば「(一番上: KGI)」が無く、既定の親が KGI (足すのは KPI)", () => {
    const html = render([item(KGI_ID, "kgi", null, "TOEIC800")]);
    expect(html).not.toContain("(一番上: KGI)");
    expect(html).not.toContain("＋ KGI を作る");
    expect(html).toMatch(new RegExp(`<option[^>]*value="${KGI_ID}"[^>]*selected`));
    expect(html).toContain("足す (KPI (途中の指標))");
  });
  it("KGI が無ければ「＋ KGI を作る」と「(一番上: KGI)」", () => {
    const html = render([]);
    expect(html).toContain("＋ KGI を作る");
    expect(html).toContain("(一番上: KGI)");
  });
});
