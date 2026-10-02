import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { DailyView } from "./DailyPanel";
import type { PlanItem } from "../../lib/plan-items";

// 本人の画面で崩れた 2 つ (2026-10-02 のスクリーンショット) を二度と起こさない
const P = "123e4567-e89b-12d3-a456-426614174000";
const TODAY = "2026-10-02";
const todo: PlanItem = {
  id: "aaaaaaaa-0000-4000-8000-000000000001", projectId: P, parentId: null, level: "todo",
  title: "5分だけ書き出してみる", target: "5分間の書き出しができたこと", dueDate: TODAY, status: "todo",
  createdAt: "2026-10-02T00:00:00Z", updatedAt: "",
};
const noop = () => {};
const html = renderToStaticMarkup(
  <DailyView today={TODAY} items={[todo]} logs={[]} problem={null} saving={false} saved={false} onUpdateItem={noop} onSave={noop} onAsk={noop} />,
);
const classOf = (re: RegExp) => (html.match(re)?.[1] ?? "").split(/\s+/);

describe("今日の ToDo の行 (崩れ 1: 題が 1 文字ずつ縦に並んだ)", () => {
  it("状態の選択は w-full を持たず、縮まない (題の幅を奪わない)", () => {
    const tag = html.match(/<select[^>]*aria-label="『5分だけ書き出してみる』の状態"[^>]*>/)?.[0] ?? "";
    const cls = (tag.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/);
    expect(cls).toContain("w-auto");
    expect(cls).toContain("shrink-0");
    expect(cls).not.toContain("w-full");
  });
  it("題は縮められる (min-w-0) 上で折り返す", () => {
    const cls = classOf(/<span class="([^"]*)">5分だけ書き出してみる/);
    expect(cls).toEqual(expect.arrayContaining(["min-w-0", "flex-1", "break-words"]));
  });
});

describe("見えない部品の位置の基準 (崩れ 2: ページが縦に伸びて下へずれた)", () => {
  it("〇△× のラベルは relative (中の sr-only のラジオをラベルの中に留める)", () => {
    const labels = [...html.matchAll(/<label class="([^"]*)"><input type="radio"/g)].map((m) => m[1].split(/\s+/));
    expect(labels).toHaveLength(3);
    for (const l of labels) expect(l).toContain("relative");
  });
  it("画面の外枠は overflow-hidden・左右の列は relative (列の中の sr-only を列に留める)", () => {
    const src = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
    expect(src).toContain('<div className="flex h-screen overflow-hidden bg-gray-50 text-gray-800">');
    expect(src).toContain('<div className="relative flex flex-col w-2/3 min-w-0 border-r bg-white">');
    expect(src).toContain('<div className="relative w-1/3 min-w-0 bg-gray-100 p-4 overflow-y-auto flex flex-col gap-6">');
  });
});
