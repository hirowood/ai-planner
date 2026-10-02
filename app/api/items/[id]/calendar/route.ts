import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../auth/[...nextauth]/route";
import { startPerf } from "../../../../../lib/perf";
import { DbNotConfigured, getSql } from "../../../../../lib/db";
import { isUuid } from "../../../../../lib/projects";
import { parseTimeRange, todoToEvent } from "../../../../../lib/todo-event";
import {
  SCHEDULE_EXISTS,
  SCHEDULE_NOT_TODO,
  claimItemEvent,
  confirmItemEvent,
  getItem,
  releaseItemEvent,
} from "../../../../../lib/repo";

// --- ToDo を予定 (Google カレンダー) に入れる (EXP-030) ---
// 件名と説明はサーバが項目から作る。先に枠を取ってから Google に作る (同じ ToDo に 2 つ作らない)。
// ログに題・メール・トークンは出さない。

type Perf = ReturnType<typeof startPerf>;
type Ctx = { params: Promise<{ id: string }> };

const ROUTE = "api/items/[id]/calendar";
const GOOGLE_EVENTS = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export async function POST(req: Request, { params }: Ctx) {
  const perf = startPerf(ROUTE, ["db_ms", "calendar_ms"]);
  try {
    const { id } = await params;
    return perf.finish(await handle(req, id, perf));
  } catch (error: unknown) {
    perf.finish(new Response(null, { status: 500 }));
    throw error;
  }
}

function dbFailure(error: unknown): NextResponse {
  if (error instanceof DbNotConfigured) {
    return NextResponse.json({ error: "データベースが未設定です" }, { status: 503 });
  }
  const name = error instanceof Error ? error.name : typeof error;
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  console.error(`[${ROUTE}] error: ${name}${typeof code === "string" ? ` code=${code}` : ""}`);
  return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
}

async function handle(req: Request, id: string, perf: Perf): Promise<Response> {
  const session = await getServerSession(authOptions);
  const owner = session?.user?.email;
  const token = session?.accessToken;
  if (typeof owner !== "string" || owner.length === 0 || typeof token !== "string" || token.length === 0) {
    return NextResponse.json({ error: "Unauthorized: ログインが必要です" }, { status: 401 });
  }
  if (!isUuid(id)) return NextResponse.json({ error: "id が正しくありません" }, { status: 400 });

  let raw: unknown = {};
  try {
    const text = await req.text();
    raw = text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "JSON として読めません" }, { status: 400 });
  }
  const range = parseTimeRange(raw);
  if (!range) return NextResponse.json({ error: "時刻は開始と終了の両方を HH:MM で (終了は開始より後に)" }, { status: 400 });

  try {
    const sql = getSql();
    const start = range.allDay ? "" : range.start;
    const end = range.allDay ? "" : range.end;

    const claimed = await perf.time("db_ms", () => claimItemEvent(sql, owner, id, start, end));
    if (claimed === null) return NextResponse.json({ error: "項目が見つかりません" }, { status: 404 });
    if (claimed === SCHEDULE_NOT_TODO) return NextResponse.json({ error: "期日のある ToDo だけ予定に入れられます" }, { status: 400 });
    if (claimed === SCHEDULE_EXISTS) return NextResponse.json({ error: "この ToDo はもう予定に入っています" }, { status: 409 });

    const item = await perf.time("db_ms", () => getItem(sql, owner, id));
    const event = item ? todoToEvent(item, range) : null;
    if (!event) {
      await perf.time("db_ms", () => releaseItemEvent(sql, owner, id));
      return NextResponse.json({ error: "期日のある ToDo だけ予定に入れられます" }, { status: 400 });
    }

    let eventId: string | null = null;
    let googleStatus = 0;
    try {
      const res = await perf.time("calendar_ms", () =>
        fetch(GOOGLE_EVENTS, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(event),
        }),
      );
      googleStatus = res.status;
      const data: unknown = await res.json().catch(() => null);
      const gid = (data as { id?: unknown } | null)?.id;
      if (res.ok && typeof gid === "string" && gid.length > 0) eventId = gid;
    } catch {
      googleStatus = 0;
    }

    if (!eventId) {
      await perf.time("db_ms", () => releaseItemEvent(sql, owner, id));
      // 状態の数だけを出す (題・トークンは出さない)
      console.error(`[${ROUTE}] google failed: ${googleStatus}`);
      const message = googleStatus === 401 ? "Google にもう一度ログインしてください" : "予定を作れませんでした。少し待ってからもう一度";
      return NextResponse.json({ error: message }, { status: 502 });
    }

    await perf.time("db_ms", () => confirmItemEvent(sql, owner, id, eventId));
    return NextResponse.json({ event: { itemId: id, start, end } }, { status: 200 });
  } catch (error: unknown) {
    return dbFailure(error);
  }
}
