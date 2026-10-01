import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { QUICK_MAX, buildQuickReplies } from "./quick-replies";
import { QuickReplies } from "../app/components/QuickReplies";
import type { PlanItem } from "./plan-items";

const P = "123e4567-e89b-12d3-a456-426614174000";
let n = 0;
const item = (level: PlanItem["level"], title: string, status: PlanItem["status"], day: string): PlanItem => ({
  id: `aaaaaaaa-0000-4000-8000-00000000000${n++}`, projectId: P, parentId: null, level, title, target: "", dueDate: "", status,
  createdAt: `2026-10-${day}T00:00:00Z`, updatedAt: `2026-10-${day}T00:00:00Z`,
});

describe("buildQuickReplies (EXP-025 L1)", () => {
  it("未実行の ToDo (新しい 2 つ) から 4 個・実行済みは使わない", () => {
    const out = buildQuickReplies({
      items: [item("todo", "単語 20 個", "todo", "01"), item("todo", "音読", "todo", "02"), item("todo", "済んだ", "done", "03")],
      notes: [], userMessages: [],
    });
    expect(out).toEqual(["『音読』をやりました", "『音読』ができませんでした", "『単語 20 個』をやりました", "『単語 20 個』ができませんでした"]);
  });
  it("KDI・ノート・発言の文", () => {
    const out = buildQuickReplies({
      items: [item("kdi", "毎朝 20 分", "todo", "01")],
      notes: [{ body: "今日は 30 分できた。調子が良い" }],
      userMessages: ["こんにちは", "とても長い発言なので二十字を超えてしまうためボタンにはしない", "進めたい"],
    });
    expect(out).toEqual(["『毎朝 20 分』の進み具合を相談したい", "ノート『今日は 30 分でき…』について", "進めたい", "こんにちは"]);
  });
  it("題は 12 字で切る・重複なし・最大 6 個・どれも 30 字まで", () => {
    const items = ["あいうえおかきくけこさしすせそ", "b", "c"].map((t, i) => item("todo", t, "todo", `0${i + 1}`));
    const out = buildQuickReplies({ items, notes: [{ body: "x" }], userMessages: ["a", "a", "b2"] });
    // 上限は定数ではなく数で確かめる (定数を変えても通る判定にしない)
    expect(QUICK_MAX).toBe(6);
    const many = buildQuickReplies({
      items: [item("todo", "t1", "todo", "01"), item("todo", "t2", "todo", "02"), item("kdi", "k", "todo", "03")],
      notes: [{ body: "n" }],
      userMessages: ["m1", "m2", "m3"],
    });
    expect(many).toHaveLength(6);
    expect(new Set(out).size).toBe(out.length);
    expect(out.every((s) => [...s].length <= 30)).toBe(true);
    expect(buildQuickReplies({ items: [item("todo", "あいうえおかきくけこさしすせそ", "todo", "01")], notes: [], userMessages: [] })[0])
      .toBe("『あいうえおかきくけこさし…』をやりました");
  });
  it("記録が無ければ発言だけ", () => {
    expect(buildQuickReplies({ items: [], notes: [], userMessages: ["はい", "いいえ"] })).toEqual(["いいえ", "はい"]);
  });
});

describe("QuickReplies (EXP-025 L2)", () => {
  it("group の名前・ボタンの数・空なら何も出さない", () => {
    const html = renderToStaticMarkup(createElement(QuickReplies, { replies: ["a", "b"], onPick: () => {} }));
    expect(html).toContain('aria-label="よく使う入力"');
    expect(html.match(/<button[^>]*type="button"/g) ?? []).toHaveLength(2);
    expect(renderToStaticMarkup(createElement(QuickReplies, { replies: [], onPick: () => {} }))).toBe("");
  });
});
