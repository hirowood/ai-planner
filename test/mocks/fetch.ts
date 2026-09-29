// Google Calendar への fetch の差し替え。呼ばれた URL を記録し、決めた応答を返す。
import { vi } from "vitest";

export type FakeReply = { status?: number; body: unknown; delayMs?: number };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function stubFetch(reply: FakeReply | ((url: string) => FakeReply)) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: unknown) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    const r = typeof reply === "function" ? reply(url) : reply;
    if (r.delayMs) await wait(r.delayMs);
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

// `[perf]` 行の捕捉。console.log を覗き、`[perf]` で始まる行だけを返す
export function capturePerf() {
  const lines: string[] = [];
  const all: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    const text = args.map(String).join(" ");
    all.push(text);
    if (text.startsWith("[perf] ")) lines.push(text);
  });
  const errSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    all.push(args.map(String).join(" "));
  });
  return {
    lines,
    all,
    parsed: () => lines.map((l) => JSON.parse(l.slice("[perf] ".length)) as Record<string, unknown>),
    restore: () => {
      spy.mockRestore();
      errSpy.mockRestore();
    },
  };
}
