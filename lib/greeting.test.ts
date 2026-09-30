import { describe, expect, it } from "vitest";
import { greetingFor, startChoices, startMessage } from "./greeting";

const at = (h: number, m: number) => new Date(2026, 8, 30, h, m);
const countQ = (s: string) => (s.match(/？/g) ?? []).length;

describe("時間帯の挨拶 (EXP-021 L1)", () => {
  it.each([
    { h: 4, m: 59, want: "こんばんは" },
    { h: 5, m: 0, want: "おはようございます" },
    { h: 9, m: 59, want: "おはようございます" },
    { h: 10, m: 0, want: "こんにちは" },
    { h: 16, m: 59, want: "こんにちは" },
    { h: 17, m: 0, want: "こんばんは" },
  ])("$h:$m → $want (EXP-021 L1)", ({ h, m, want }) => {
    expect(greetingFor(at(h, m))).toBe(want);
  });
});

describe("最初の一言 (EXP-021 L2)", () => {
  const PROJECT = "朝の散歩";
  const cases = [
    { label: "プロジェクト無し", projectName: null, hasHistory: false, rest: "今日は何をしますか？" },
    { label: "プロジェクトあり・会話あり", projectName: PROJECT, hasHistory: true, rest: `『${PROJECT}』の続きから始めますか？` },
    {
      label: "プロジェクトあり・会話無し",
      projectName: PROJECT,
      hasHistory: false,
      rest: `『${PROJECT}』の PDCA を一緒に始めましょう。何からしますか？`,
    },
  ];

  it.each(cases)("名前あり: $label (EXP-021 L2)", ({ projectName, hasHistory, rest }) => {
    const msg = startMessage({ greeting: "こんにちは", userName: "ひろき", projectName, hasHistory });
    expect(msg.startsWith("こんにちは、ひろきさん。")).toBe(true);
    expect(msg.endsWith(rest)).toBe(true);
    expect(countQ(msg)).toBe(1);
  });

  it.each(cases)("名前無し: $label (EXP-021 L2)", ({ projectName, hasHistory, rest }) => {
    const msg = startMessage({ greeting: "こんばんは", userName: null, projectName, hasHistory });
    expect(msg.startsWith("こんばんは")).toBe(true);
    expect(msg).not.toContain("さん");
    expect(msg.endsWith(rest)).toBe(true);
    expect(countQ(msg)).toBe(1);
  });
});

describe("選択肢 (EXP-021 L3)", () => {
  it("プロジェクト無し・最後に開いたプロジェクトあり: 4 つ (EXP-021 L3)", () => {
    const cs = startChoices({ projectSelected: false, hasLastProject: true });
    expect(cs.map((c) => c.id)).toEqual(["resume", "new_project", "calendar", "brainstorm"]);
    expect(cs.map((c) => c.label)).toEqual(["前回の続き", "新しいプロジェクト", "予定を見る", "壁打ち・相談"]);
    expect(cs.every((c) => c.message === undefined)).toBe(true);
  });

  it("プロジェクト無し・最後に開いたプロジェクト無し: 3 つで resume が無い (EXP-021 L3)", () => {
    const cs = startChoices({ projectSelected: false, hasLastProject: false });
    expect(cs).toHaveLength(3);
    expect(cs.map((c) => c.id)).toEqual(["new_project", "calendar", "brainstorm"]);
  });

  it.each([true, false])("プロジェクトあり (hasLastProject=%s): 5 つと決まった文 (EXP-021 L3)", (hasLastProject) => {
    const cs = startChoices({ projectSelected: true, hasLastProject });
    expect(cs.map((c) => [c.id, c.label, c.message])).toEqual([
      ["resume", "前回の続き", "前回の続きから、今の状況をまとめて次にすることを 1 つ教えてください。"],
      ["suggest", "提案がほしい", "今の記録から、次に取り組むとよいことを提案してください。"],
      ["ask_next", "質問に答えて決める", "Plan の次に決める欄を質問してください。"],
      ["plan_today", "今日の予定を決める", "今日やることを 3 つ決めるのを手伝ってください。"],
      ["brainstorm", "壁打ち・相談", "少し相談したいことがあります。聞いてもらえますか。"],
    ]);
  });
});
