import { describe, expect, it } from "vitest";
import { CATEGORY_LABEL, NOTE_KIND_LABEL, isUuid, parseNoteInput, parseProjectInput } from "./projects";

const UUID = "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b";
const NON_OBJECTS: unknown[] = [null, undefined, "name", 42, true, []];

describe("parseProjectInput (EXP-008 L1)", () => {
  const valid = { name: "英語の勉強", category: "learning", purpose: "TOEIC 800 点" };

  it("正しい値を通す (EXP-008 L1)", () => {
    expect(parseProjectInput(valid)).toEqual(valid);
  });

  it.each(["habit", "learning", "work"])("category %s を通す (EXP-008 L1)", (category) => {
    expect(parseProjectInput({ ...valid, category })).toMatchObject({ category });
  });

  it("名前の前後の空白を取る (EXP-008 L1)", () => {
    expect(parseProjectInput({ ...valid, name: "  朝の散歩 \n" })).toMatchObject({ name: "朝の散歩" });
  });

  it("60 字の名前・500 字の目的・空の目的は通す (EXP-008 L1)", () => {
    expect(parseProjectInput({ ...valid, name: "あ".repeat(60) })).not.toBeNull();
    expect(parseProjectInput({ ...valid, purpose: "a".repeat(500) })).not.toBeNull();
    expect(parseProjectInput({ ...valid, purpose: "" })).not.toBeNull();
  });

  it("空白で 60 字を超えても trim 後に 60 字なら通す (EXP-008 L1)", () => {
    expect(parseProjectInput({ ...valid, name: `  ${"a".repeat(60)}  ` })).toMatchObject({ name: "a".repeat(60) });
  });

  it.each([
    ["空の名前", { ...valid, name: "" }],
    ["空白だけの名前", { ...valid, name: "   " }],
    ["61 字の名前", { ...valid, name: "あ".repeat(61) }],
    ["501 字の目的", { ...valid, purpose: "a".repeat(501) }],
    ["知らない種類", { ...valid, category: "hobby" }],
    ["種類が無い", { name: valid.name, purpose: valid.purpose }],
    ["名前が文字列でない", { ...valid, name: 123 }],
  ])("%s は null (EXP-008 L1)", (_label, input) => {
    expect(parseProjectInput(input)).toBeNull();
  });

  it.each(NON_OBJECTS.map((x) => [x]))("オブジェクトでない値 %j は null (EXP-008 L1)", (x) => {
    expect(parseProjectInput(x)).toBeNull();
  });
});

describe("parseNoteInput (EXP-008 L1)", () => {
  const valid = { projectId: UUID, kind: "fact", body: "今日は 30 分歩いた" };

  it("正しい値を通す (EXP-008 L1)", () => {
    expect(parseNoteInput(valid)).toEqual(valid);
  });

  it.each(["fact", "data", "thought"])("kind %s を通す (EXP-008 L1)", (kind) => {
    expect(parseNoteInput({ ...valid, kind })).toMatchObject({ kind });
  });

  it("本文の前後の空白を取る (EXP-008 L1)", () => {
    expect(parseNoteInput({ ...valid, body: "\n  体重 60kg  " })).toMatchObject({ body: "体重 60kg" });
  });

  it("2000 字の本文は通す (EXP-008 L1)", () => {
    expect(parseNoteInput({ ...valid, body: "a".repeat(2000) })).not.toBeNull();
  });

  it.each([
    ["空の本文", { ...valid, body: "" }],
    ["空白だけの本文", { ...valid, body: "  \n " }],
    ["2001 字の本文", { ...valid, body: "a".repeat(2001) }],
    ["知らない種類", { ...valid, kind: "opinion" }],
    ["UUID でない projectId", { ...valid, projectId: "not-a-uuid" }],
    ["数字の projectId", { ...valid, projectId: 1 }],
    ["projectId が無い", { kind: valid.kind, body: valid.body }],
  ])("%s は null (EXP-008 L1)", (_label, input) => {
    expect(parseNoteInput(input)).toBeNull();
  });

  it.each(NON_OBJECTS.map((x) => [x]))("オブジェクトでない値 %j は null (EXP-008 L1)", (x) => {
    expect(parseNoteInput(x)).toBeNull();
  });
});

describe("isUuid (EXP-008 L1)", () => {
  it("UUID を通す (EXP-008 L1)", () => {
    expect(isUuid(UUID)).toBe(true);
  });

  it.each([["not-a-uuid"], [""], [`${UUID}x`], [UUID.replace(/-/g, "")], [null], [42], [{}]])(
    "%j は false (EXP-008 L1)",
    (x) => {
      expect(isUuid(x)).toBe(false);
    },
  );
});

describe("ラベル (EXP-008 L1)", () => {
  it("種類のラベルは 習慣/学習/仕事・事実/データ/考え (EXP-008 L1)", () => {
    expect(CATEGORY_LABEL).toEqual({ habit: "習慣", learning: "学習", work: "仕事" });
    expect(NOTE_KIND_LABEL).toEqual({ fact: "事実", data: "データ", thought: "考え" });
  });
});
