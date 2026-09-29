import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authState, signedIn } from "../../../../test/mocks/next-auth";
import { capturePerf, stubFetch } from "../../../../test/mocks/fetch";

vi.mock("next-auth", async () => (await import("../../../../test/mocks/next-auth")).nextAuthMock);
vi.mock("../../auth/[...nextauth]/route", async () => (await import("../../../../test/mocks/next-auth")).authRouteMock);

import { GET } from "./route";

const ALLOWED = ["calendar_ms", "gemini_ms", "route", "status", "total_ms"];
const TITLE_CANARY = "canary-event-title-3b8e";
const TOKEN_CANARY = "fake-token-canary-a09d";

const events = { kind: "calendar#events", items: [{ id: "e1", summary: TITLE_CANARY, start: { dateTime: "2026-10-01T10:00:00+09:00" }, end: { dateTime: "2026-10-01T11:00:00+09:00" } }] };

describe("GET /api/calendar/get", () => {
  let perf: ReturnType<typeof capturePerf>;
  beforeEach(() => {
    perf = capturePerf();
    authState.session = null;
  });
  afterEach(() => {
    perf.restore();
    vi.unstubAllGlobals();
  });

  it("セッション無しは 401 で、Calendar を呼ばない", async () => {
    const f = stubFetch({ body: events });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(f.calls).toHaveLength(0);
  });

  it("差し替えた Calendar で 200 と予定の配列を返す", async () => {
    authState.session = signedIn(TOKEN_CANARY);
    const f = stubFetch({ body: events, delayMs: 15 });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(events.items);
    expect(f.calls[0]).toContain("googleapis.com/calendar/v3/calendars/primary/events");
  });

  it("[perf] がちょうど 1 行・5 項目だけ・calendar_ms が待ち時間を捉え・本文とトークンが出ない", async () => {
    authState.session = signedIn(TOKEN_CANARY);
    stubFetch({ body: events, delayMs: 15 });
    const res = await GET();
    expect(perf.lines).toHaveLength(1);
    const [line] = perf.parsed();
    expect(Object.keys(line).every((k) => ALLOWED.includes(k))).toBe(true);
    expect(line).toMatchObject({ route: "api/calendar/get", status: 200 });
    expect(line.calendar_ms as number).toBeGreaterThanOrEqual(10);
    expect(res.headers.get("Server-Timing")).toMatch(/^total;dur=[\d.]+, calendar;dur=[\d.]+$/);
    const everything = perf.all.join("\n");
    expect(everything).not.toContain(TITLE_CANARY);
    expect(everything).not.toContain(TOKEN_CANARY);
  });

  it("Google の応答の形が不正なとき、エラーログに予定の中身を出さない", async () => {
    authState.session = signedIn(TOKEN_CANARY);
    stubFetch({ body: { unexpected: TITLE_CANARY } });
    const res = await GET();
    expect(res.status).toBe(502);
    expect(perf.all.join("\n")).not.toContain(TITLE_CANARY);
  });
});
