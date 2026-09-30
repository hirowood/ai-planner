import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanTree } from "./PlanTree";
import type { PlanItem } from "../../lib/plan-items";

const P = "123e4567-e89b-12d3-a456-426614174000";
const item = (id: string, level: PlanItem["level"], parentId: string | null, title: string): PlanItem => ({
  id, projectId: P, parentId, level, title, target: "", dueDate: "2026-12-31", status: "todo",
  createdAt: "2026-09-30T00:00:00Z", updatedAt: "2026-09-30T00:00:00Z",
});
const KGI = item("aaaaaaaa-0000-4000-8000-000000000001", "kgi", null, "TOEIC800");
const KPI = item("aaaaaaaa-0000-4000-8000-000000000002", "kpi", KGI.id, "模試スコア");
const noop = () => {};
const html = renderToStaticMarkup(
  <PlanTree items={[KGI, KPI]} lastParentId={null} onCreate={noop} onUpdate={noop} onDelete={noop} onLastParentChange={noop} />,
);

describe("KGI の行は固定 (EXP-024 L3)", () => {
  it("KGI に 🔒 と「KGI は固定」", () => {
    expect(html).toContain("KGI は固定");
  });
  it("KGI には期日の入力と消すボタンが無い・状態の選択はある", () => {
    expect(html).not.toContain("『TOEIC800』の期日");
    expect(html).not.toContain("『TOEIC800』を消す");
    expect(html).toContain("『TOEIC800』の状態");
  });
  it("KPI には期日の入力と消すボタンがある", () => {
    expect(html).toContain("『模試スコア』の期日");
    expect(html).toContain("『模試スコア』を消す");
  });
});
