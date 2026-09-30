import { describe, expect, it } from "vitest";
import { categoryLabel, noteKindLabel, parseNoteInput, parseProjectInput } from "./projects";

const project = { name: "英語の勉強", category: "learning", purpose: "" };
const note = { projectId: "123e4567-e89b-12d3-a456-426614174000", kind: "fact", body: "30 分やった" };

describe("種類の自由入力 (EXP-012 L1)", () => {
  it.each(["habit", "learning", "work"])("既定のプロジェクトの種類 %s はそのまま通る", (c) => {
    expect(parseProjectInput({ ...project, category: c })?.category).toBe(c);
  });
  it.each(["fact", "data", "thought"])("既定のノートの種類 %s はそのまま通る", (k) => {
    expect(parseNoteInput({ ...note, kind: k })?.kind).toBe(k);
  });
  it("自由入力の名前が通り、前後の空白を外す", () => {
    expect(parseProjectInput({ ...project, category: "  健康 " })?.category).toBe("健康");
    expect(parseNoteInput({ ...note, kind: "読書メモ" })?.kind).toBe("読書メモ");
  });
  it("20 字は通り、21 字は null", () => {
    expect(parseProjectInput({ ...project, category: "あ".repeat(20) })).not.toBeNull();
    expect(parseProjectInput({ ...project, category: "あ".repeat(21) })).toBeNull();
    expect(parseNoteInput({ ...note, kind: "a".repeat(21) })).toBeNull();
  });
  it.each([
    ["空", ""],
    ["空白だけ", "   "],
    ["改行を含む", "健\n康"],
    ["タブを含む", "健\t康"],
    ["数字", 3],
    ["null", null],
  ])("%s の種類は null", (_label, v) => {
    expect(parseProjectInput({ ...project, category: v })).toBeNull();
    expect(parseNoteInput({ ...note, kind: v })).toBeNull();
  });
  it("継承された名前 (toString など) も自由入力の名前として扱い、既定の値とは見なさない", () => {
    expect(parseProjectInput({ ...project, category: "toString" })?.category).toBe("toString");
    expect(categoryLabel("toString")).toBe("toString");
  });
});

describe("表示の名前 (EXP-012 L2)", () => {
  it("既定の値は日本語、自由入力はそのまま", () => {
    expect(categoryLabel("habit")).toBe("習慣");
    expect(categoryLabel("健康")).toBe("健康");
    expect(noteKindLabel("thought")).toBe("考え");
    expect(noteKindLabel("読書メモ")).toBe("読書メモ");
  });
});
