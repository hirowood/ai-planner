import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatPerfLine, startPerf } from "./perf";
import { capturePerf } from "../test/mocks/fetch";

describe("lib/perf", () => {
  let perf: ReturnType<typeof capturePerf>;
  beforeEach(() => {
    perf = capturePerf();
  });
  afterEach(() => perf.restore());

  it("formatPerfLine は値を 0.1ms に丸め、未指定の項目を出さない", () => {
    expect(formatPerfLine({ route: "r", status: 200, total_ms: 12.345 })).toBe('[perf] {"route":"r","status":200,"total_ms":12.3}');
  });

  it("time() は失敗しても時間を加算し、例外をそのまま返す", async () => {
    const p = startPerf("r", ["calendar_ms"]);
    await expect(p.time("calendar_ms", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    p.finish(new Response(null, { status: 500 }));
    const [line] = perf.parsed();
    expect(line).toMatchObject({ route: "r", status: 500 });
    expect(typeof line.calendar_ms).toBe("number");
  });

  it("streamText: チャンクを順に送り、閉じたときに 1 行 (first_chunk_ms ≤ total_ms)。finish は二重に記録しない", async () => {
    async function* src() {
      yield "a";
      yield "b";
    }
    const p = startPerf("r");
    const res = p.finish(p.streamText(src()));
    expect(await res.text()).toBe("ab");
    const lines = perf.parsed();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ route: "r", status: 200 });
    expect(lines[0].first_chunk_ms as number).toBeLessThanOrEqual(lines[0].total_ms as number);
  });

  it("streamText: クライアントが途中で切ったら status 499 で 1 行", async () => {
    async function* src() {
      yield "a";
      await new Promise((r) => setTimeout(r, 50));
      yield "b";
    }
    const res = startPerf("r").streamText(src());
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(perf.parsed()).toEqual([expect.objectContaining({ route: "r", status: 499 })]);
  });

  it("finish() は同じ Response を返し、Server-Timing を付ける", () => {
    const res = new Response("x", { status: 201 });
    const out = startPerf("r").finish(res);
    expect(out).toBe(res);
    expect(out.headers.get("Server-Timing")).toMatch(/^total;dur=[\d.]+$/);
    expect(perf.lines).toHaveLength(1);
  });
});
