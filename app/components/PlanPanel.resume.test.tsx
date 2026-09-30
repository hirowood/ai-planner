import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanPanel } from "./PlanPanel";
import { EMPTY_PLAN, openingMessage } from "../../lib/pdca-plan";
import type { Project } from "../../lib/projects";
import type { StoredMessage } from "../../lib/messages";

const PROJECT: Project = {
  id: "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b",
  name: "朝の散歩プロジェクト",
  category: "habit",
  purpose: "体力をつけたい",
  createdAt: "2026-09-30T01:02:03.000Z",
};

const SAVED: StoredMessage[] = [
  { id: "1a2b3c4d-0000-4a6b-8c7d-000000000001", role: "user", content: "目的は健康のため", createdAt: "2026-09-30T01:00:00.000Z" },
  { id: "1a2b3c4d-0000-4a6b-8c7d-000000000002", role: "assistant", content: "では目標は？", createdAt: "2026-09-30T01:00:05.000Z" },
];

const render = (initialMessages?: StoredMessage[]) =>
  renderToStaticMarkup(
    <PlanPanel project={PROJECT} initialPlan={EMPTY_PLAN} cycleId={null} onSaved={() => {}} initialMessages={initialMessages} />,
  );

function decode(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

// 入力欄の value を除いた、画面に出ている文字
function visibleText(html: string): string {
  return decode(html.replace(/<(?:input|textarea)\b[^>]*>/g, "").replace(/<[^>]*>/g, ""));
}

function buttons(html: string): string[] {
  return [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((m) => decode(m[1].replace(/<[^>]*>/g, "")).trim());
}

const OPENING = openingMessage(PROJECT, EMPTY_PLAN);

describe("PlanPanel の続きから (EXP-010 L4)", () => {
  it("保存された会話があれば、その本人の発言と AI の返事が出る (EXP-010 L4)", () => {
    const text = visibleText(render(SAVED));
    expect(text).toContain("目的は健康のため");
    expect(text).toContain("では目標は？");
  });

  it("保存された会話があれば、最初の一言は出ない (EXP-010 L4)", () => {
    const text = visibleText(render(SAVED));
    expect(text).not.toContain("Plan を一緒に決めましょう");
    expect(text).not.toContain(OPENING);
  });

  it.each([
    ["initialMessages が無い", undefined],
    ["initialMessages が空", []],
  ])("%s ときは今までどおり最初の一言 (プロジェクト名を含む) (EXP-010 L4)", (_label, initial) => {
    const text = visibleText(render(initial));
    expect(text).toContain(PROJECT.name);
    expect(text).toContain("Plan を一緒に決めましょう");
  });

  it.each([
    ["会話あり", SAVED],
    ["会話なし", undefined],
  ])("%s でも「チャットの壁打ちを Plan に反映」ボタンがある (EXP-010 L4)", (_label, initial) => {
    expect(buttons(render(initial)).some((t) => t.includes("チャットの壁打ちを Plan に反映"))).toBe(true);
  });

  it.each([
    ["会話あり", SAVED],
    ["会話なし", undefined],
  ])("%s でも保存の状態を出す role=\"status\" の要素がある (EXP-010 L4)", (_label, initial) => {
    expect(render(initial)).toMatch(/<[a-zA-Z0-9]+\b[^>]*\srole="status"[^>]*>/);
  });
});
