import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// 画面は page.tsx (描画に session 等が要る) なので、配線を source で確かめる (EXP-043)
const src = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("目的ごとのチャット欄 (EXP-043)", () => {
  it("チャットのタブ: 5 つの会話 (プロジェクトを選んだときだけ) + プロジェクト作成", () => {
    expect(src).toContain('<div role="tablist" aria-label="チャット"');
    expect(src).toContain("{workspace.selected && COACH_THREADS.map((t) => (");
    expect(src).toContain("aria-selected={!setupDraft && chatThread === t}");
    expect(src).toContain('id="chat-tab-setup"');
    expect(src).toContain("handleChoose({ id: 'new_project', label: '新しいプロジェクト' } as Choice)");
  });

  it("会話はタブの thread で読み、送るときも thread を付ける", () => {
    expect(src).toContain("&thread=${thread}`);");
    expect(src).not.toContain("&thread=chat`");
    expect(src).toContain("}, [selectedProjectId, chatThread]);");
    expect(src).toContain("if (chatProjectId.current !== projectId || chatThreadRef.current !== thread) return;");
    expect(src).toContain("thread: chatThreadRef.current,");
  });

  it("ToDo の相談・完了の判定・手帳の相談は ✅ ToDo のチャットへ送る", () => {
    expect(src.match(/onAsk=\{\(text\) => sendTo\('todo', text\)\}/g)?.length).toBe(2);
    expect(src).toContain("then(() => sendTo('todo', completeMessage(item.title)))");
    // 切り替えたら、そのチャットの会話を読み終えてから送る
    expect(src).toContain("queuedSend.current = { thread, text };");
    expect(src).toContain("if (q && q.thread === thread) {");
  });
});
