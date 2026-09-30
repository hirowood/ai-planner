import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectPanel } from "./ProjectPanel";
import { NotesPanel } from "./NotesPanel";
import type { Note, Project } from "../../lib/projects";

const PROJECT: Project = {
  id: "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b",
  name: "朝の散歩",
  category: "habit",
  purpose: "毎日 30 分歩く",
  createdAt: "2026-09-30T01:02:03.000Z",
};

const NOTES: Note[] = [
  { id: "n1", projectId: PROJECT.id, kind: "fact", body: "note-body-alpha-1", createdAt: "2026-09-30T02:00:00.000Z" },
  { id: "n2", projectId: PROJECT.id, kind: "data", body: "note-body-beta-2", createdAt: "2026-09-29T02:00:00.000Z" },
  { id: "n3", projectId: PROJECT.id, kind: "thought", body: "note-body-gamma-3", createdAt: "2026-09-28T02:00:00.000Z" },
];

const noop = () => {};

const projectHtml = renderToStaticMarkup(
  <ProjectPanel projects={[]} selectedId={null} onSelect={noop} onCreate={noop} />,
);
const notesHtml = renderToStaticMarkup(
  <NotesPanel project={PROJECT} notes={NOTES} onCreate={noop} onDelete={noop} />,
);

const CONTROL = /<(?:input|textarea|select)\b[^>]*>/g;

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "").trim();
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1] : null;
}

// ラベルと、そのラベルに結びついた入力欄 (label で囲む形・for/id の形のどちらでもよい)
function labelledControls(html: string): { control: string; text: string }[] {
  const out: { control: string; text: string }[] = [];
  const controls = html.match(CONTROL) ?? [];
  for (const m of html.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/g)) {
    const [, labelAttrs, inner] = m;
    const text = stripTags(inner);
    for (const c of inner.match(CONTROL) ?? []) out.push({ control: c, text });
    const forId = attr(` ${labelAttrs}`, "for");
    if (forId) {
      for (const c of controls) if (attr(c, "id") === forId) out.push({ control: c, text });
    }
  }
  return out;
}

function isTextControl(tag: string): boolean {
  if (tag.startsWith("<textarea")) return true;
  if (!tag.startsWith("<input")) return false;
  const type = attr(tag, "type");
  return type === null || ["text", "search"].includes(type);
}

function radios(html: string): string[] {
  return (html.match(/<input\b[^>]*>/g) ?? []).filter((t) => attr(t, "type") === "radio");
}

function expectRadioLabelled(html: string, value: string, label: string) {
  const radio = radios(html).find((r) => attr(r, "value") === value);
  expect(radio, `radio value=${value}`).toBeDefined();
  const pairs = labelledControls(html).filter((p) => p.control === radio);
  expect(pairs.some((p) => p.text.includes(label)), `radio ${value} のラベル ${label}`).toBe(true);
}

describe("ProjectPanel の作成欄 (EXP-008 L4)", () => {
  it("名前の入力欄にラベルがある (EXP-008 L4)", () => {
    const pairs = labelledControls(projectHtml).filter((p) => p.text.includes("名前"));
    expect(pairs.some((p) => isTextControl(p.control))).toBe(true);
  });

  it("目的の入力欄にラベルがある (EXP-008 L4)", () => {
    const pairs = labelledControls(projectHtml).filter((p) => p.text.includes("目的"));
    expect(pairs.some((p) => isTextControl(p.control))).toBe(true);
  });

  it("種類はラジオ 3 つ (habit/learning/work)・ラベルは 習慣/学習/仕事 (EXP-008 L4)", () => {
    const values = radios(projectHtml).map((r) => attr(r, "value"));
    expect(values).toEqual(expect.arrayContaining(["habit", "learning", "work"]));
    expectRadioLabelled(projectHtml, "habit", "習慣");
    expectRadioLabelled(projectHtml, "learning", "学習");
    expectRadioLabelled(projectHtml, "work", "仕事");
  });

  it("種類のラジオは同じ name でまとまっている (EXP-008 L4)", () => {
    const names = radios(projectHtml)
      .filter((r) => ["habit", "learning", "work"].includes(attr(r, "value") ?? ""))
      .map((r) => attr(r, "name"));
    expect(names).toHaveLength(3);
    expect(names[0]).toBeTruthy();
    expect(new Set(names).size).toBe(1);
  });
});

describe("NotesPanel (EXP-008 L4)", () => {
  it("本文の入力欄にラベルがある (EXP-008 L4)", () => {
    const textControls = (notesHtml.match(CONTROL) ?? []).filter(isTextControl);
    expect(textControls.length).toBeGreaterThanOrEqual(1);
    const labelled = labelledControls(notesHtml).filter((p) => isTextControl(p.control) && p.text.length > 0);
    for (const c of textControls) {
      expect(labelled.some((p) => p.control === c), `ラベルの無い入力欄: ${c}`).toBe(true);
    }
  });

  it("種類はラジオ 3 つ (fact/data/thought)・ラベルは 事実/データ/考え (EXP-008 L4)", () => {
    const values = radios(notesHtml).map((r) => attr(r, "value"));
    expect(values).toEqual(expect.arrayContaining(["fact", "data", "thought"]));
    expectRadioLabelled(notesHtml, "fact", "事実");
    expectRadioLabelled(notesHtml, "data", "データ");
    expectRadioLabelled(notesHtml, "thought", "考え");
  });

  it("ノートの一覧に各ノートの本文が出る (EXP-008 L4)", () => {
    for (const n of NOTES) expect(notesHtml).toContain(n.body);
  });
});
