import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { startPerf } from "../../../lib/perf";
import { DbNotConfigured, getSql } from "../../../lib/db";
import { isUuid } from "../../../lib/projects";
import { DAILY_DAYS_MAX, DAILY_LIMIT, dailyFilled, parseDailyInput } from "../../../lib/daily";
import { todayJst } from "../../../lib/smart";
import { listDailyLogs, upsertDailyLog } from "../../../lib/repo";

// --- 1 日の記録 (EXP-020) ---
// owner はセッションのメール。ログに記録の中身・メール・接続文字列は出さない。

type Perf = ReturnType<typeof startPerf>;

const ROUTE = "api/daily";

export async function GET(req: Request) {
  const perf = startPerf(ROUTE, ["db_ms"]);
  try {
    return perf.finish(await handleGet(req, perf));
  } catch (error: unknown) {
    perf.finish(new Response(null, { status: 500 }));
    throw error;
  }
}

export async function PUT(req: Request) {
  const perf = startPerf(ROUTE, ["db_ms"]);
  try {
    return perf.finish(await handlePut(req, perf));
  } catch (error: unknown) {
    perf.finish(new Response(null, { status: 500 }));
    throw error;
  }
}

async function ownerOf(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  return typeof email === "string" && email.length > 0 ? email : null;
}

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized: ログインが必要です" }, { status: 401 });
}

/** DB の失敗を応答に変える。未設定は 503、それ以外は種類とコードだけを記録して 500。 */
function dbFailure(error: unknown): NextResponse {
  if (error instanceof DbNotConfigured) {
    return NextResponse.json({ error: "データベースが未設定です" }, { status: 503 });
  }
  const name = error instanceof Error ? error.name : typeof error;
  // message と detail には入力の値が入りうるので出さない
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  console.error(`[${ROUTE}] db error: ${name}${typeof code === "string" ? ` code=${code}` : ""}`);
  return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
}

async function handleGet(req: Request, perf: Perf): Promise<NextResponse> {
  const owner = await ownerOf();
  if (!owner) return unauthorized();

  const params = new URL(req.url).searchParams;
  const projectId = params.get("projectId");
  if (!isUuid(projectId)) return NextResponse.json({ error: "projectId が正しくありません" }, { status: 400 });
  // 読む日数 (EXP-036: 手帳の月の表のため最大 62 日)。無ければ 7
  const daysRaw = params.get("days");
  const days = daysRaw === null ? DAILY_LIMIT : /^\d{1,2}$/.test(daysRaw) ? Number(daysRaw) : NaN;
  if (!Number.isInteger(days) || days < 1 || days > DAILY_DAYS_MAX) {
    return NextResponse.json({ error: "days は 1〜62 にしてください" }, { status: 400 });
  }

  try {
    const sql = getSql();
    const logs = await perf.time("db_ms", () => listDailyLogs(sql, owner, projectId, days));
    perf.set({ row_count: logs.length });
    return NextResponse.json({ logs, today: todayJst() });
  } catch (error: unknown) {
    return dbFailure(error);
  }
}

async function handlePut(req: Request, perf: Perf): Promise<NextResponse> {
  const owner = await ownerOf();
  if (!owner) return unauthorized();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON として読めません" }, { status: 400 });
  }
  const input = parseDailyInput(raw, todayJst());
  if (!input) return NextResponse.json({ error: "記録の入力が正しくありません" }, { status: 400 });

  try {
    const sql = getSql();
    const log = await perf.time("db_ms", () => upsertDailyLog(sql, owner, input));
    if (!log) return NextResponse.json({ error: "プロジェクトが見つかりません" }, { status: 404 });
    perf.set({ fields_filled: dailyFilled(input) });
    return NextResponse.json({ log });
  } catch (error: unknown) {
    return dbFailure(error);
  }
}
