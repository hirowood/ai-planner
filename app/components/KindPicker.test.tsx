import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { KindPicker, OTHER, kindFromChoice } from "./KindPicker";
import { CATEGORY_LABEL } from "../../lib/projects";

const render = (choice: string) =>
  renderToStaticMarkup(
    <KindPicker legend="種類" groupName="g" presets={CATEGORY_LABEL} choice={choice} custom="健康" onChoice={() => {}} onCustom={() => {}} />,
  );

describe("種類の欄 (EXP-012 L3)", () => {
  it("既定の 3 つと「その他」のラジオが同じ name でまとまっている", () => {
    const radios = render("habit").match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(4);
    expect(radios.every((r) => r.includes('name="g"'))).toBe(true);
    expect(radios.some((r) => r.includes(`value="${OTHER}"`))).toBe(true);
    expect(render("habit")).toContain("その他");
  });
  it("既定の値を選んでいる間は、名前の入力欄を出さない", () => {
    expect(render("habit")).not.toContain("種類の名前");
  });
  it("「その他」を選ぶと、ラベルつきの名前の入力欄が出る", () => {
    const html = render(OTHER);
    const label = html.match(/<label[^>]*>種類の名前[\s\S]*?<\/label>/)?.[0] ?? "";
    expect(label).toMatch(/<input[^>]*type="text"/);
    expect(label).toMatch(/maxLength="20"|maxlength="20"/);
  });
  it("保存する値: 既定の値ならその値、「その他」なら入力した名前", () => {
    expect(kindFromChoice("work", "健康")).toBe("work");
    expect(kindFromChoice(OTHER, "健康")).toBe("健康");
  });
});
