import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TimeDialog } from "./TimeDialog";

const html = renderToStaticMarkup(<TimeDialog open={false} onSubmit={() => {}} onClose={() => {}} />);

describe("TimeDialog の構造 (EXP-006)", () => {
  it("名前つきの <dialog> で、見出しと結びついている", () => {
    expect(html).toMatch(/<dialog[^>]*aria-labelledby="time-dialog-title"/);
    expect(html).toContain('id="time-dialog-title"');
  });
  it("2 つの入れ方を選べる (ラジオ・ラベルつき)", () => {
    // 属性の順番に依らず、ラジオの input タグごとに確かめる
    const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(2);
    const duration = radios.find((r) => r.includes('value="duration"'));
    const range = radios.find((r) => r.includes('value="range"'));
    expect(duration).toMatch(/checked/);
    expect(range).not.toMatch(/checked/);
    expect(html).toContain("何時間");
    expect(html).toContain("何時から何時まで");
  });
  it("初期表示は所要時間の選択 (30 分〜8 時間)", () => {
    expect(html).toMatch(/<select/);
    expect(html).toContain("30分");
    expect(html).toContain("8時間");
  });
  it("送信と、閉じて文字で答えるボタンがある", () => {
    expect(html).toMatch(/<button type="submit"[^>]*>送信<\/button>/);
    expect(html).toMatch(/<button type="button"[^>]*>自分で入力<\/button>/);
  });
});
