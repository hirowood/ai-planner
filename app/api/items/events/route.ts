import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { startPerf } from "../../../../lib/perf";
import { DbNotConfigured, getSql } from "../../../../lib/db";
import { isUuid } from "../../../../lib/projects";
import { listItemEvents } from "../../../../lib/repo";

// --- プロジェクトの ToDo の予定の一覧 (EXP-030) ---

type Perf = ReturnType<typeof startPerf>;

const ROUTE = "api/items/events";

export async function GET(req: Request) {
  const perf = startPerf(ROUTE, ["db_ms"]);
  try {
    return perf.finish(await handle(req, perf));
  } catch (error: unknown) {
    perf.finish(new Response(null, { status: 500 }));
    throw error;
  }
}

async function handle(req: Request, perf: Perf): Promise<Response> {
  const session = await getServerSession(authOptions);
  const owner = session?.user?.email;
  if (typeof owner !== "string" || owner.length === 0) {
    return NextResponse.json({ error: "Unauthorized: ログインが必要です" }, { status: 401 });
  }
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!isUuid(projectId)) return NextResponse.json({ error: "projectId が正しくありません" }, { status: 400 });

  try {
    const sql = getSql();
    const events = await perf.time("db_ms", () => listItemEvents(sql, owner, projectId));
    perf.set({ row_count: events.length });
    return NextResponse.json({ events });
  } catch (error: unknown) {
    if (error instanceof DbNotConfigured) {
      return NextResponse.json({ error: "データベースが未設定です" }, { status: 503 });
    }
    const name = error instanceof Error ? error.name : typeof error;
    const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
    console.error(`[${ROUTE}] db error: ${name}${typeof code === "string" ? ` code=${code}` : ""}`);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
