import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StartChoices } from "./StartChoices";
import type { Choice } from "../../lib/greeting";

const CHOICES: Choice[] = [
  { id: "resume", label: "前回の続き" },
  { id: "new_project", label: "新しいプロジェクト" },
  { id: "calendar", label: "予定を見る" },
  { id: "brainstorm", label: "壁打ち・相談" },
];

const render = (busy: boolean, choices: Choice[] = CHOICES) =>
  renderToStaticMarkup(
    <StartChoices message="こんにちは。今日は何をしますか？" choices={choices} busy={busy} onChoose={() => {}} />,
  );

const buttons = (html: string) => html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];
const openTag = (b: string) => b.match(/<button[^>]*>/)?.[0] ?? "";

describe("選択肢のボタン (EXP-021 L4)", () => {
  it("最初の一言を表示する (EXP-021 L4)", () => {
    expect(render(false)).toContain("こんにちは。今日は何をしますか？");
  });

  it("role=group と名前「次にすること」を持つ (EXP-021 L4)", () => {
    const html = render(false);
    const group = html.match(/<[a-z]+[^>]*role="group"[^>]*>/)?.[0] ?? "";
    expect(group).not.toBe("");
    const label = group.match(/aria-label="([^"]*)"/)?.[1];
    if (label !== undefined) {
      expect(label).toBe("次にすること");
      return;
    }
    const id = group.match(/aria-labelledby="([^"]*)"/)?.[1] ?? "";
    expect(id).not.toBe("");
    const named = html.match(new RegExp(`<[a-z0-9]+[^>]*id="${id}"[^>]*>([\\s\\S]*?)</`))?.[1] ?? "";
    expect(named).toContain("次にすること");
  });

  it.each([{ choices: CHOICES }, { choices: CHOICES.slice(0, 3) }])("選択肢の数だけ type=button がありラベルを出す (EXP-021 L4)", ({ choices }) => {
    const bs = buttons(render(false, choices));
    expect(bs).toHaveLength(choices.length);
    expect(bs.every((b) => openTag(b).includes('type="button"'))).toBe(true);
    choices.forEach((c, i) => expect(bs[i]).toContain(c.label));
  });

  it("送信中はどのボタンも aria-disabled=true (EXP-021 L4)", () => {
    const bs = buttons(render(true));
    expect(bs).toHaveLength(CHOICES.length);
    expect(bs.every((b) => openTag(b).includes('aria-disabled="true"'))).toBe(true);
  });

  it("送信中でなければ aria-disabled=true にしない (EXP-021 L4)", () => {
    const bs = buttons(render(false));
    expect(bs.some((b) => openTag(b).includes('aria-disabled="true"'))).toBe(false);
  });
});
