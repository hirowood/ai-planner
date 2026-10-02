import { describe, expect, it } from "vitest";
import { BATCH_MAX, HISTORY_LIMIT, MESSAGE_MAX, isThread, parseMessagesInput } from "./messages";

const PROJECT_ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b";

const VALID = {
  projectId: PROJECT_ID,
  thread: "plan",
  messages: [
    { role: "user", content: "目的は健康のため" },
    { role: "assistant", content: "では目標は？" },
  ],
};

const msg = (content: string, role = "user") => ({ role, content });

describe("定数 (EXP-010 L1)", () => {
  it("MESSAGE_MAX=8000・BATCH_MAX=20・HISTORY_LIMIT=100 (EXP-010 L1)", () => {
    expect(MESSAGE_MAX).toBe(8000);
    expect(BATCH_MAX).toBe(20);
    expect(HISTORY_LIMIT).toBe(100);
  });
});

describe("isThread (EXP-010 L1)", () => {
  it.each(["plan", "chat"])("%s は thread (EXP-010 L1)", (t) => {
    expect(isThread(t)).toBe(true);
  });

  it.each(["kgi", "kpi", "kdi", "todo"])("%s も thread (目的ごとのチャット・EXP-043)", (t) => {
    expect(isThread(t)).toBe(true);
  });

  it.each([["do"], ["Plan"], [""], [null], [undefined], [1], [{}], ["consult"], ["setup"]])("%j は thread でない (EXP-010 L1)", (t) => {
    expect(isThread(t)).toBe(false);
  });
});

describe("parseMessagesInput (EXP-010 L1)", () => {
  it("正しい値を通す (EXP-010 L1)", () => {
    expect(parseMessagesInput(VALID)).toEqual(VALID);
  });

  it("thread chat も通す (EXP-010 L1)", () => {
    expect(parseMessagesInput({ ...VALID, thread: "chat" })?.thread).toBe("chat");
  });

  it("1 件・20 件 (境界) は通す (EXP-010 L1)", () => {
    expect(parseMessagesInput({ ...VALID, messages: [msg("a")] })?.messages).toHaveLength(1);
    const twenty = Array.from({ length: 20 }, (_, i) => msg(`m${i}`, i % 2 ? "assistant" : "user"));
    expect(parseMessagesInput({ ...VALID, messages: twenty })?.messages).toHaveLength(20);
  });

  it("8000 字 (境界・[...s] で数える) は通す (EXP-010 L1)", () => {
    const ascii = "a".repeat(8000);
    expect(parseMessagesInput({ ...VALID, messages: [msg(ascii)] })?.messages[0].content).toBe(ascii);
    // サロゲートペア 8000 字 (.length は 16000) も 8000 字として通す
    const emoji = "😀".repeat(8000);
    expect(parseMessagesInput({ ...VALID, messages: [msg(emoji)] })?.messages[0].content).toBe(emoji);
  });

  it("中身の空白は変えない (trim しない) (EXP-010 L1)", () => {
    const content = "  前の空白\n\t途中のタブ  \n後ろの空白   ";
    expect(parseMessagesInput({ ...VALID, messages: [msg(content)] })?.messages[0].content).toBe(content);
  });

  it.each([
    ["UUID でない projectId", { ...VALID, projectId: "not-a-uuid" }],
    ["projectId が無い", { thread: VALID.thread, messages: VALID.messages }],
    ["projectId が文字列でない", { ...VALID, projectId: 123 }],
    ["知らない thread", { ...VALID, thread: "do" }],
    ["thread が無い", { projectId: PROJECT_ID, messages: VALID.messages }],
    ["0 件", { ...VALID, messages: [] }],
    ["21 件", { ...VALID, messages: Array.from({ length: 21 }, (_, i) => msg(`m${i}`)) }],
    ["messages が配列でない", { ...VALID, messages: "x" }],
    ["空の content", { ...VALID, messages: [msg("")] }],
    ["content が文字列でない", { ...VALID, messages: [{ role: "user", content: 1 }] }],
    ["8001 字の content", { ...VALID, messages: [msg("a".repeat(8001))] }],
    ["8001 字の content (サロゲートペア)", { ...VALID, messages: [msg("😀".repeat(8001))] }],
    ["知らない role", { ...VALID, messages: [msg("hi", "system")] }],
    ["message がオブジェクトでない", { ...VALID, messages: ["hi"] }],
  ])("%s は null (EXP-010 L1)", (_label, input) => {
    expect(parseMessagesInput(input)).toBeNull();
  });

  it.each([[null], [undefined], ["x"], [42], [[VALID]]])("オブジェクトでない %j は null (EXP-010 L1)", (input) => {
    expect(parseMessagesInput(input)).toBeNull();
  });
});
