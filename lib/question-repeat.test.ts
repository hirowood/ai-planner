import { describe, expect, it } from "vitest";
import { isRepeatQuestion, lastQuestion } from "./question-repeat";

describe("同じ質問の繰り返し (EXP-044)", () => {
  it("最後の質問の文だけを取り出す", () => {
    expect(lastQuestion("いいですね。何時にやりますか？")).toBe("何時にやりますか？");
    expect(lastQuestion("A ですか? では B はどうですか?")).toBe("では B はどうですか?");
    expect(lastQuestion("質問はありません。")).toBeNull();
  });

  it("空白と記号の違いは同じ質問・言い回しが違えば別の質問", () => {
    expect(isRepeatQuestion("了解です。 何時に やりますか？", "いいですね。何時にやりますか?")).toBe(true);
    expect(isRepeatQuestion("では、どこでやりますか？", "いいですね。何時にやりますか？")).toBe(false);
  });

  it("前の返答が無い・どちらかに質問が無ければ繰り返しではない", () => {
    expect(isRepeatQuestion("何時にやりますか？", null)).toBe(false);
    expect(isRepeatQuestion("では始めましょう。", "何時にやりますか？")).toBe(false);
    expect(isRepeatQuestion("何時にやりますか？", "始めましょう。")).toBe(false);
  });
});
