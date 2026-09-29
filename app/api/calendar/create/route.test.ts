import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authState, signedIn } from "../../../../test/mocks/next-auth";
import { capturePerf, stubFetch } from "../../../../test/mocks/fetch";

vi.mock("next-auth", async () => (await import("../../../../test/mocks/next-auth")).nextAuthMock);
vi.mock("../../auth/[...nextauth]/route", async () => (await import("../../../../test/mocks/next-auth")).authRouteMock);

import { POST } from "./route";

const ALLOWED = ["calendar_ms", "gemini_ms", "route", "status", "total_ms"];
const TITLE_CANARY = "canary-new-event-title-c4f0";

const event = (i: number) => ({
  summary: `${TITLE_CANARY}-${i}`,
  start: { dateTime: "2026-10-01T10:00:00+09:00" },
  end: { dateTime: "2026-10-01T11:00:00+09:00" },
});

function post(body: unknown): Request {
  return new Request("http://localhost/api/calendar/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/calendar/create", () => {
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
    const f = stubFetch({ body: {} });
    const res = await POST(post({ events: [event(1)] }));
    expect(res.status).toBe(401);
    expect(f.calls).toHaveLength(0);
  });

  it("差し替えた Calendar で 200 と、件数ぶんの登録結果を返す", async () => {
    authState.session = signedIn();
    const f = stubFetch({ body: { id: "created" } });
    const res = await POST(post({ events: [event(1), event(2)] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; results: unknown[] };
    expect(body.success).toBe(true);
    expect(body.results).toHaveLength(2);
    expect(f.calls).toHaveLength(2);
  });

  it("[perf] がちょうど 1 行・5 項目だけ・calendar_ms は件数ぶんの合計", async () => {
    authState.session = signedIn();
    stubFetch({ body: { id: "created" }, delayMs: 10 });
    const res = await POST(post({ events: [event(1), event(2), event(3)] }));
    expect(perf.lines).toHaveLength(1);
    const [line] = perf.parsed();
    expect(Object.keys(line).every((k) => ALLOWED.includes(k))).toBe(true);
    expect(line).toMatchObject({ route: "api/calendar/create", status: 200 });
    expect(line.calendar_ms as number).toBeGreaterThanOrEqual(25); // 3 件 × 10ms を順に待つ
    expect(res.headers.get("Server-Timing")).toMatch(/^total;dur=[\d.]+, calendar;dur=[\d.]+$/);
  });

  it("登録に失敗しても、エラーログに予定のタイトルを出さない", async () => {
    authState.session = signedIn();
    stubFetch({ status: 400, body: { error: { message: "bad request" } } });
    await POST(post({ events: [event(1)] }));
    expect(perf.all.join("\n")).not.toContain(TITLE_CANARY);
  });
});
