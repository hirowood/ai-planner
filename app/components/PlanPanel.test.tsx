import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanPanel } from "./PlanPanel";
import { EMPTY_PLAN, type PlanDraft } from "../../lib/pdca-plan";
import type { Project } from "../../lib/projects";

const PROJECT: Project = {
  id: "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b",
  name: "朝の散歩プロジェクト",
  category: "habit",
  purpose: "体力をつけたい",
  createdAt: "2026-09-30T01:02:03.000Z",
};

const LABELS = ["目的", "目標 (KGI)", "途中の指標 (KPI)", "行動 (KDI)", "判定基準", "成果物"];

const render = (plan: PlanDraft, cycleId: string | null = null) =>
  renderToStaticMarkup(<PlanPanel project={PROJECT} initialPlan={plan} cycleId={cycleId} onSaved={() => {}} />);

const emptyHtml = render(EMPTY_PLAN);

const CONTROL = /<(?:input|textarea|select)\b[^>]*>/g;

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "").trim();
}

function decode(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1] : null;
}

function isTextControl(tag: string): boolean {
  if (tag.startsWith("<textarea")) return true;
  if (!tag.startsWith("<input")) return false;
  const type = attr(tag, "type");
  return type === null || ["text", "search", "date", "time"].includes(type);
}

function buttons(html: string): { tag: string; text: string }[] {
  return [...html.matchAll(/(<button\b[^>]*>)([\s\S]*?)<\/button>/g)].map((m) => ({ tag: m[1], text: decode(stripTags(m[2])) }));
}

function button(html: string, text: string) {
  return buttons(html).find((b) => b.text.includes(text));
}

// aria-current="step" の付いた要素と、その要素が示す欄の名前 (中の文字・aria-label・label の for/id のどれか)
function currentStep(html: string): { count: number; text: string } {
  const tags = [...html.matchAll(/<([a-zA-Z0-9]+)\b[^>]*\saria-current="step"[^>]*>/g)];
  if (tags.length === 0) return { count: 0, text: "" };
  const [open, tagName] = [tags[0][0], tags[0][1]];
  const start = tags[0].index! + open.length;
  const close = html.indexOf(`</${tagName}>`, start);
  const inner = close >= 0 ? decode(stripTags(html.slice(start, close))) : "";
  const names = [inner, decode(attr(open, "aria-label") ?? "")];
  const id = attr(open, "id");
  if (id) {
    const label = html.match(new RegExp(`<label\\b[^>]*\\sfor="${id}"[^>]*>([\\s\\S]*?)</label>`));
    if (label) names.push(decode(stripTags(label[1])));
  }
  return { count: tags.length, text: names.join(" | ") };
}

describe("PlanPanel の最初の表示 (EXP-009 L6)", () => {
  it("AI の最初の一言が最初から出ていて、プロジェクト名を含む (EXP-009 L6)", () => {
    expect(decode(stripTags(emptyHtml.replace(/<(?:input|textarea)\b[^>]*>/g, "")))).toContain(PROJECT.name);
  });

  it.each(LABELS)("欄のラベル「%s」がある (EXP-009 L6)", (label) => {
    expect(decode(emptyHtml)).toContain(label);
  });

  it("目的・目標・判定基準・成果物は直接書ける欄 (ラベルつき) (EXP-009 L6)", () => {
    const pairs: { control: string; text: string }[] = [];
    const controls = emptyHtml.match(CONTROL) ?? [];
    for (const m of emptyHtml.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/g)) {
      const [, labelAttrs, inner] = m;
      const text = decode(stripTags(inner));
      for (const c of inner.match(CONTROL) ?? []) pairs.push({ control: c, text });
      const forId = attr(` ${labelAttrs}`, "for");
      if (forId) for (const c of controls) if (attr(c, "id") === forId) pairs.push({ control: c, text });
    }
    for (const c of controls) {
      const aria = attr(c, "aria-label");
      if (aria) pairs.push({ control: c, text: decode(aria) });
    }
    for (const label of ["目的", "目標 (KGI)", "判定基準", "成果物"]) {
      expect(
        pairs.some((p) => p.text.includes(label) && isTextControl(p.control)),
        `ラベル ${label} の入力欄`,
      ).toBe(true);
    }
  });

  it("空の Plan では 目的 に aria-current=\"step\" が 1 つだけ付く (EXP-009 L6)", () => {
    const step = currentStep(emptyHtml);
    expect(step.count).toBe(1);
    expect(step.text).toContain("目的");
    expect(step.text).not.toContain("目標 (KGI)");
  });

  it("目的まで埋まった Plan では 目標 (KGI) に aria-current=\"step\" (EXP-009 L6)", () => {
    const step = currentStep(render({ ...EMPTY_PLAN, purpose: "体力をつける" }));
    expect(step.count).toBe(1);
    expect(step.text).toContain("目標 (KGI)");
  });

  it("「保存」と「行動をカレンダーに登録」のボタンがある (EXP-009 L6)", () => {
    expect(button(emptyHtml, "保存")).toBeDefined();
    expect(button(emptyHtml, "行動をカレンダーに登録")).toBeDefined();
  });

  it("日付と時刻がそろった行動が無ければ、登録のボタンは押せない (EXP-009 L6)", () => {
    const b = button(emptyHtml, "行動をカレンダーに登録");
    expect(b?.tag).toMatch(/\sdisabled(=""|\s|>)/);
  });

  it("日付と時刻がそろった行動があれば、登録のボタンは押せる (EXP-009 L6)", () => {
    const html = render(
      { ...EMPTY_PLAN, purpose: "体力", kdis: [{ action: "朝の散歩", date: "2026-10-01", start: "07:00", end: "07:30" }] },
      "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    );
    const b = button(html, "行動をカレンダーに登録");
    expect(b).toBeDefined();
    expect(b!.tag).not.toMatch(/\sdisabled(=""|\s|>)/);
  });

  it("会話の入力欄と送信ボタンがある (EXP-009 L6)", () => {
    expect(button(emptyHtml, "送信")).toBeDefined();
    // 直接書ける 4 欄 (目的・目標・判定基準・成果物) に加えて、会話の入力欄が少なくとも 1 つ
    const textControls = (emptyHtml.match(CONTROL) ?? []).filter(isTextControl);
    expect(textControls.length).toBeGreaterThanOrEqual(5);
  });
});
