import { describe, expect, it } from "vitest";
import { durationLabel, durationMessage, hasTimeMarker, rangeMessage, stripTimeMarker } from "./time-input";

describe("目印 [[time]] (EXP-006 L3)", () => {
  it("目印があれば true、無ければ false", () => {
    expect(hasTimeMarker("確保できる時間はどれくらいですか？\n[[time]]")).toBe(true);
    expect(hasTimeMarker("なぜそれをやる必要がありますか？")).toBe(false);
  });
  it("表示と履歴から目印を取り除く", () => {
    expect(stripTimeMarker("時間はどれくらいですか？\n\n[[time]]")).toBe("時間はどれくらいですか？");
    expect(stripTimeMarker("前 [[time]] 後")).toBe("前後");
  });
  it("ストリームの途中で書きかけの目印も隠す", () => {
    for (const partial of ["[", "[[", "[[t", "[[ti", "[[tim", "[[time", "[[time]"]) {
      expect(stripTimeMarker(`時間は？\n${partial}`)).toBe("時間は？");
    }
  });
  it("目印の無い文は変えない (末尾の空白以外)", () => {
    expect(stripTimeMarker("**目標**: 記事を書く")).toBe("**目標**: 記事を書く");
  });
});

describe("送る文の組み立て (EXP-006 L3)", () => {
  it("何時間", () => {
    expect(durationLabel(30)).toBe("30分");
    expect(durationLabel(90)).toBe("1時間30分");
    expect(durationMessage(120)).toBe("時間: 2時間");
  });
  it("何時から何時まで", () => {
    expect(rangeMessage("2026-10-01", "10:00", "12:30")).toBe("時間: 2026/10/1 10:00〜12:30 (2時間30分)");
  });
  it("終了が開始より後でなければ送れない", () => {
    expect(rangeMessage("2026-10-01", "12:00", "12:00")).toBeNull();
    expect(rangeMessage("2026-10-01", "13:00", "12:00")).toBeNull();
  });
  it("形が正しくなければ送れない", () => {
    expect(rangeMessage("", "10:00", "11:00")).toBeNull();
    expect(rangeMessage("2026-10-01", "", "11:00")).toBeNull();
    expect(rangeMessage("2026-10-01", "10:00", "25:00")).toBeNull();
  });
});
