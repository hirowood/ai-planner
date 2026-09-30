import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageContent } from "./MessageContent";

const html = (text: string) => renderToStaticMarkup(<MessageContent text={text} />);

// 本番で AI が返す形に近い返答 (見出し・太字・箇条書き・表・コードブロック)
const TYPICAL = [
  "### 🎯 今日のプラン",
  "",
  "**What**: React の記事を書く",
  "",
  "- 集中 25 分",
  "- 休憩 5 分",
  "",
  "| 時間 | 内容 |",
  "|---|---|",
  "| 10:00 | 下書き |",
  "",
  "```json",
  '[{"summary":"🎯 [Goal] 記事"}]',
  "```",
].join("\n");

describe("MessageContent (EXP-003 L1: 整形されて生の記号が残らない)", () => {
  it("見出し・太字・箇条書き・表・コードブロックが要素になる", () => {
    const out = html(TYPICAL);
    expect(out).toContain("<h3");
    expect(out).toContain("<strong");
    expect(out).toContain("<ul");
    expect(out).toContain("<table");
    expect(out).toContain("<pre");
  });

  it("見た目の文字として `**`・`###`・行頭の `- ` が残らない", () => {
    const text = html(TYPICAL).replace(/<pre[\s\S]*?<\/pre>/g, ""); // コードブロックの中身は除いて見る
    expect(text).not.toContain("**");
    expect(text).not.toContain("###");
    expect(text).not.toMatch(/>- /);
  });
});

describe("MessageContent (EXP-003 L2: 返答の HTML を HTML として出さない)", () => {
  it.each([
    ["script", "<script>alert(1)</script>", /<script/i],
    ["img onerror", '<img src="x" onerror="alert(1)">', /<img[^>]*onerror/i],
    ["iframe", '<iframe src="https://example.com"></iframe>', /<iframe/i],
  ])("%s は要素として出ない", (_name, input, bad) => {
    expect(html(`前置き\n\n${input}\n\n後書き`)).not.toMatch(bad);
  });

  it("javascript: のリンクは href に残らない", () => {
    const out = html("[押して](javascript:alert(1))");
    expect(out).not.toMatch(/href="javascript:/i);
  });

  it("普通のリンクは新しいタブ + noopener で開く", () => {
    const out = html("[公式](https://example.com)");
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="noopener noreferrer"');
  });
});
