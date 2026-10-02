import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { choiceButtons } from "../lib/hierarchy-step";

describe("答えの候補のボタン (EXP-035 L5)", () => {
  it("次の段の候補の題が先・同じ文は 1 つ", () => {
    expect(choiceButtons([{ title: "a", target: "" }, { title: "b", target: "" }], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(choiceButtons([], ["c"])).toEqual(["c"]);
  });
  it("画面は候補のボタンで pick を付けて送る", () => {
    const src = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    expect(src).toContain("...(pick ? { pick } : {})");
    expect(src).toContain("const c = candidates.find((x) => x.title === text);");
    expect(src).toContain("void handleSendMessage(c ? `『${c.title}』にします` : text, undefined, c);");
  });
});
