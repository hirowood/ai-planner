import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanFields } from "./PlanFields";
import { EMPTY_PLAN, type PlanDraft } from "../../lib/pdca-plan";

const LABELS = ["目的", "目標 (KGI)", "途中の指標 (KPI)", "行動 (KDI)", "判定基準", "成果物"];
const SAVE_STATUS = "保存しました-canary-6e1d";
const CYCLE_ID = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const FULL: PlanDraft = {
  purpose: "体力をつける",
  kgi: "10 月末に 5km 歩ける",
  kpis: [{ name: "歩いた日数", target: "週 5 日" }],
  kdis: [{ action: "朝の散歩", date: "2026-10-01", start: "07:00", end: "07:30" }],
  criteria: "3 週続けば成功",
  deliverable: "記録表",
};

const render = (plan: PlanDraft, saveStatus = SAVE_STATUS, cycleId: string | null = null) =>
  renderToStaticMarkup(
    <PlanFields plan={plan} onChange={() => {}} cycleId={cycleId} saveStatus={saveStatus} onRegisterCalendar={() => {}} />,
  );

const emptyHtml = render({ ...EMPTY_PLAN, kpis: [], kdis: [] });

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
  return [...html.matchAll(/(<button\b[^>]*>)([\s\S]*?)<\/button>/g)].map((m) => ({
    tag: m[1],
    text: decode(stripTags(m[2])) + " " + decode(attr(m[1], "aria-label") ?? ""),
  }));
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

// 入力欄とその名前 (囲む label・label の for・aria-label)
function labelledControls(html: string): { control: string; text: string }[] {
  const pairs: { control: string; text: string }[] = [];
  const controls = html.match(CONTROL) ?? [];
  for (const m of html.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/g)) {
    const [, labelAttrs, inner] = m;
    const text = decode(stripTags(inner));
    for (const c of inner.match(CONTROL) ?? []) pairs.push({ control: c, text });
    const forId = attr(` ${labelAttrs}`, "for");
    if (forId) for (const c of controls) if (attr(c, "id") === forId) pairs.push({ control: c, text });
  }
  for (const c of controls) {
    const aria = attr(c, "aria-label");
    if (aria) pairs.push({ control: c, text: decode(aria) });
    const ph = attr(c, "placeholder");
    if (ph) pairs.push({ control: c, text: decode(ph) });
  }
  return pairs;
}

describe("PlanFields — 6 つの欄 (EXP-016 L5)", () => {
  it.each(LABELS)("欄のラベル「%s」がある (EXP-016 L5)", (label) => {
    expect(decode(emptyHtml)).toContain(label);
  });

  it("目的・目標・判定基準・成果物は自分で書ける欄 (ラベルつき) (EXP-016 L5)", () => {
    const pairs = labelledControls(emptyHtml);
    for (const label of ["目的", "目標 (KGI)", "判定基準", "成果物"]) {
      expect(
        pairs.some((p) => p.text.includes(label) && isTextControl(p.control)),
        `ラベル ${label} の入力欄`,
      ).toBe(true);
    }
  });

  it("Plan の中身が欄に出る (EXP-016 L5)", () => {
    const html = decode(render(FULL));
    for (const v of [FULL.purpose, FULL.kgi, FULL.criteria, FULL.deliverable]) expect(html).toContain(v);
  });
});

describe("PlanFields — 次の欄の印 (EXP-016 L5)", () => {
  it.each([
    { label: "空の Plan", plan: { ...EMPTY_PLAN, kpis: [], kdis: [] }, want: "目的", notWant: "目標 (KGI)" },
    { label: "目的だけ埋まった Plan", plan: { ...EMPTY_PLAN, kpis: [], kdis: [], purpose: "体力" }, want: "目標 (KGI)", notWant: "判定基準" },
    { label: "行動まで埋まった Plan", plan: { ...FULL, criteria: "", deliverable: "" }, want: "判定基準", notWant: "成果物" },
  ])("$label では $want に aria-current=\"step\" が 1 つだけ (EXP-016 L5)", ({ plan, want, notWant }) => {
    const step = currentStep(render(plan));
    expect(step.count).toBe(1);
    expect(step.text).toContain(want);
    expect(step.text).not.toContain(notWant);
  });

  it("全部埋まった Plan では aria-current=\"step\" が無い (EXP-016 L5)", () => {
    expect(currentStep(render(FULL)).count).toBe(0);
  });
});

describe("PlanFields — 保存の状態と会話欄が無いこと (EXP-016 L5)", () => {
  it("role=\"status\" の中に saveStatus が出る (EXP-016 L5)", () => {
    const m = emptyHtml.match(/<([a-zA-Z0-9]+)\b[^>]*\srole="status"[^>]*>([\s\S]*?)<\/\1>/);
    expect(m).not.toBeNull();
    expect(decode(stripTags(m![2]))).toContain(SAVE_STATUS);
  });

  it("「Plan について話す」の入力欄が無い (EXP-016 L5)", () => {
    for (const html of [emptyHtml, render(FULL)]) {
      expect(decode(html)).not.toContain("Plan について話す");
      expect(labelledControls(html).some((p) => p.text.includes("話す"))).toBe(false);
    }
  });

  it("「送信」「反映」のボタンが無い (EXP-016 L5)", () => {
    for (const html of [emptyHtml, render(FULL, SAVE_STATUS, CYCLE_ID)]) {
      const texts = buttons(html).map((b) => b.text);
      expect(texts.some((t) => t.includes("送信"))).toBe(false);
      expect(texts.some((t) => t.includes("反映"))).toBe(false);
    }
  });

  it("「行動をカレンダーに登録」のボタンがある (EXP-016 L5)", () => {
    const b = buttons(render(FULL, SAVE_STATUS, CYCLE_ID)).find((x) => x.text.includes("行動をカレンダーに登録"));
    expect(b).toBeDefined();
  });
});
