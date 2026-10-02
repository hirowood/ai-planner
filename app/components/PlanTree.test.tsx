import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanTree } from "./PlanTree";
import type { ItemStatus, PlanItem } from "../../lib/plan-items";

const PROJECT_ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b";
const K1 = "1a2b3c4d-0000-4a6b-8c7d-0000000000a1";
const P1 = "1a2b3c4d-0000-4a6b-8c7d-0000000000b1";
const D1 = "1a2b3c4d-0000-4a6b-8c7d-0000000000c1";
const T1 = "1a2b3c4d-0000-4a6b-8c7d-0000000000d1";

const LEVEL_LABELS = ["KGI (ゴール)", "KPI (途中の指標)", "KDI (行動の目標)", "ToDo"];
const STATUS_LABELS = ["未実行", "実行", "棚上げ", "失敗", "成功", "調整"];
const LABEL_OF: Record<ItemStatus, string> = {
  todo: "未実行", done: "実行", shelved: "棚上げ", failed: "失敗", succeeded: "成功", adjusted: "調整",
};

function item(id: string, level: PlanItem["level"], parentId: string | null, status: ItemStatus, n: number): PlanItem {
  const at = `2026-09-30T0${n}:00:00.000Z`;
  return { id, projectId: PROJECT_ID, parentId, level, title: `題-${level}-x`, target: "", dueDate: "", status, createdAt: at, updatedAt: at };
}

// 状態: 未実行 1・実行 2・失敗 1
const ITEMS: PlanItem[] = [
  item(K1, "kgi", null, "todo", 1),
  item(P1, "kpi", K1, "done", 2),
  item(D1, "kdi", P1, "done", 3),
  item(T1, "todo", D1, "failed", 4),
];

const noop = () => {};
const render = (items: PlanItem[], lastParentId: string | null) =>
  renderToStaticMarkup(
    <PlanTree
      items={items}
      lastParentId={lastParentId}
      onCreate={noop}
      onUpdate={noop}
      onDelete={noop}
      onLastParentChange={noop}
    />,
  );

function decode(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}
const text = (html: string) => decode(stripTags(html));
function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? decode(m[1]) : null;
}

type Select = { open: string; whole: string; index: number; options: { tag: string; label: string }[] };

function selects(html: string): Select[] {
  return [...html.matchAll(/(<select\b[^>]*>)([\s\S]*?)<\/select>/g)].map((m) => ({
    open: m[1],
    whole: m[0],
    index: m.index!,
    options: [...m[2].matchAll(/(<option\b[^>]*>)([\s\S]*?)<\/option>/g)].map((o) => ({ tag: o[1], label: text(o[2]).trim() })),
  }));
}

// 状態の選択 = 6 つの状態を選べて「すべて」を含まない select (絞り込みの select は除く)
const statusSelects = (html: string) =>
  selects(html).filter(
    (s) => STATUS_LABELS.every((l) => s.options.some((o) => o.label === l)) && !s.options.some((o) => o.label.includes("すべて")),
  );

// 名前がある: aria-label / aria-labelledby / label の for / 囲む label のどれか
function isLabelled(html: string, s: Select): boolean {
  if ((attr(s.open, "aria-label") ?? "").trim() !== "") return true;
  const by = attr(s.open, "aria-labelledby");
  if (by && new RegExp(`\\sid="${by}"`).test(html)) return true;
  const id = attr(s.open, "id");
  if (id && new RegExp(`<label\\b[^>]*\\sfor="${id}"`).test(html)) return true;
  for (const m of html.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/g)) {
    if (m.index! < s.index && s.index + s.whole.length <= m.index! + m[0].length) return true;
  }
  return false;
}

const selectedLabel = (s: Select) => s.options.find((o) => /\sselected=""/.test(o.tag))?.label;

function buttonTexts(html: string): string[] {
  return [...html.matchAll(/(<button\b[^>]*>)([\s\S]*?)<\/button>/g)].map(
    (m) => `${text(m[2])} ${attr(m[1], "aria-label") ?? ""}`.replace(/\s+/g, " ").trim(),
  );
}

describe("PlanTree — 4 段の階層 (EXP-017 L5)", () => {
  const html = render(ITEMS, null);

  it.each(LEVEL_LABELS)("段の名前「%s」を表示する (EXP-017 L5)", (label) => {
    expect(text(html)).toContain(label);
  });

  it("各項目のタイトルを表示する (EXP-017 L5)", () => {
    for (const i of ITEMS) expect(text(html)).toContain(i.title);
  });

  it("項目ごとに名前つきの状態の選択があり 6 つの状態を選べる (EXP-017 L5)", () => {
    const ss = statusSelects(html);
    expect(ss).toHaveLength(ITEMS.length);
    for (const s of ss) {
      expect(isLabelled(html, s), s.open).toBe(true);
      expect(s.options.map((o) => o.label).filter((l) => STATUS_LABELS.includes(l)).sort()).toEqual([...STATUS_LABELS].sort());
    }
  });

  it("状態の選択は各項目の今の状態を選んでいる (EXP-017 L5)", () => {
    const got = statusSelects(html).map(selectedLabel).sort();
    expect(got).toEqual(ITEMS.map((i) => LABEL_OF[i.status]).sort());
  });

  it("「＋ 下に足す」は ToDo 以外の項目にだけある (EXP-017 L5)", () => {
    expect(buttonTexts(html).filter((t) => t.includes("下に足す"))).toHaveLength(3);
  });

  it("KGI があれば「＋ KGI を作る」は出さない (EXP-017 L5)", () => {
    expect(buttonTexts(html).some((t) => t.includes("KGI を作る"))).toBe(false);
  });

  it.each([
    ["未実行", 1],
    ["実行", 2],
    ["失敗", 1],
  ])("状態ごとの件数: %s は %i (EXP-017 L5)", (label, count) => {
    // 項目の状態の選択の中の文字は件数の表示ではないので除く
    let rest = html;
    for (const s of statusSelects(html)) rest = rest.replace(s.whole, "");
    const pattern = new RegExp(`${label === "実行" ? "(?<!未)" : ""}${label}[\\s:：(（]*${count}(?!\\d)`);
    expect(text(rest)).toMatch(pattern);
  });
});

describe("PlanTree — 追加欄の親 (EXP-017 L5)", () => {
  it.each([
    ["KPI", P1],
    ["KDI", D1],
  ])("前に足した親 (%s) が今もあれば親の選択の既定になる (EXP-017 L5)", (_label, lastParentId) => {
    const html = render(ITEMS, lastParentId);
    const parentSelects = selects(html).filter((s) => s.options.some((o) => attr(o.tag, "value") === lastParentId));
    expect(parentSelects.length).toBeGreaterThan(0);
    for (const s of parentSelects) {
      const chosen = s.options.filter((o) => /\sselected=""/.test(o.tag)).map((o) => attr(o.tag, "value"));
      expect(chosen).toEqual([lastParentId]);
    }
  });
});

describe("PlanTree — 空のとき (EXP-017 L5)", () => {
  it("項目が無ければ「＋ KGI を作る」を出す (EXP-017 L5)", () => {
    const html = render([], null);
    expect(buttonTexts(html).some((t) => t.includes("＋ KGI を作る"))).toBe(true);
    expect(buttonTexts(html).some((t) => t.includes("下に足す"))).toBe(false);
    expect(statusSelects(html)).toHaveLength(0);
  });
});
