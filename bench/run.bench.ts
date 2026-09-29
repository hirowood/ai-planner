// 実験室ベンチ (measure → improve ループ M1 / T-012)
// 外部 API は差し替え、遅延は固定値で再現する。計測値は本番と同じ `[perf]` 行から取る
// (実験室と現場で計測器を同じにする)。実行: npm run bench -- --label <name>
import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, expect, it, vi } from "vitest";
import { authState, signedIn } from "../test/mocks/next-auth";
import { geminiState } from "../test/mocks/generative-ai";
import { capturePerf, stubFetch } from "../test/mocks/fetch";
import { summarize, type BenchResult, type ScenarioResult } from "./stats";

vi.mock("next-auth", async () => (await import("../test/mocks/next-auth")).nextAuthMock);
vi.mock("../app/api/auth/[...nextauth]/route", async () => (await import("../test/mocks/next-auth")).authRouteMock);
vi.mock("@google/generative-ai", async () => (await import("../test/mocks/generative-ai")).generativeAiMock);

import { POST as chatPOST } from "../app/api/chat/route";
import { GET as calendarGET } from "../app/api/calendar/get/route";
import { POST as createPOST } from "../app/api/calendar/create/route";

// 条件はここで固定し、結果の JSON にも書く (条件が違う結果同士を比べないため)
const N = Number(process.env.BENCH_N ?? 20);
const WARMUP = 3;
const DELAY = { gemini_ms: 100, calendar_ms: 30 };
const CREATE_EVENTS = 3;
// ストリーム版の Gemini 差替え (EXP-001 で事前登録): 10 チャンク × 10ms = 合計 100ms (一括版と同じ合計)
const STREAM = { chunks: 10, chunk_delay_ms: 10 };

const post = (url: string, body: unknown) =>
  new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const event = (i: number) => ({ summary: `bench-${i}`, start: { dateTime: "2026-10-01T10:00:00+09:00" }, end: { dateTime: "2026-10-01T11:00:00+09:00" } });

const scenarios: Record<string, () => Promise<Response>> = {
  "api/chat": () => chatPOST(post("http://localhost/api/chat", { message: "bench", history: [] })),
  "api/calendar/get": () => calendarGET(),
  "api/calendar/create": () => createPOST(post("http://localhost/api/calendar/create", { events: Array.from({ length: CREATE_EVENTS }, (_, i) => event(i)) })),
};

const results: Record<string, ScenarioResult> = {};

it(`bench n=${N} (warmup ${WARMUP})`, async () => {
  authState.session = signedIn();
  geminiState.reply = "bench reply";
  geminiState.delayMs = DELAY.gemini_ms;
  geminiState.chunks = Array.from({ length: STREAM.chunks }, (_, i) => `part-${i} `);
  geminiState.chunkDelayMs = STREAM.chunk_delay_ms;
  stubFetch((url) =>
    url.includes("/events") ? { body: { kind: "calendar#events", items: [], id: "bench" }, delayMs: DELAY.calendar_ms } : { status: 404, body: {} },
  );

  for (const [name, run] of Object.entries(scenarios)) {
    const perf = capturePerf();
    // 本文を読み切る: ストリーム応答の `[perf]` は閉じたときに出る (JSON 応答では影響なし)
    for (let i = 0; i < WARMUP; i++) await (await run()).arrayBuffer();
    perf.lines.length = 0;
    for (let i = 0; i < N; i++) {
      const res = await run();
      expect(res.status, `${name} run ${i}`).toBe(200);
      await res.arrayBuffer();
    }
    const rows = perf.parsed();
    perf.restore();
    expect(rows).toHaveLength(N);
    const fields = ["total_ms", "first_chunk_ms", "gemini_ms", "calendar_ms"].filter((f) => rows.every((r) => typeof r[f] === "number"));
    results[name] = Object.fromEntries(fields.map((f) => [f, summarize(rows.map((r) => r[f] as number))]));
  }
}, 120_000);

afterAll(() => {
  const guard = (globalThis as { __networkGuard?: { attempts: string[] } }).__networkGuard!;
  const out: BenchResult = {
    label: process.env.BENCH_LABEL ?? "unlabeled",
    created_at: new Date().toISOString(),
    node: process.version,
    warmup: WARMUP,
    network_calls: guard.attempts.length,
    scenarios: results,
  };
  const conditions = { n: N, delay_ms: DELAY, create_events: CREATE_EVENTS, gemini_stream: STREAM };
  mkdirSync("bench/results", { recursive: true });
  const file = `bench/results/${out.label}.json`;
  writeFileSync(file, JSON.stringify({ ...out, conditions }, null, 2) + "\n");
  console.info(`bench: wrote ${file} (network_calls=${out.network_calls})`);
});
