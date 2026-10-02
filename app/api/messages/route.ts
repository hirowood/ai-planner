import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { startPerf } from "../../../lib/perf";
import { DbNotConfigured, getSql } from "../../../lib/db";
import { isUuid } from "../../../lib/projects";
import { isThread, parseMessagesInput } from "../../../lib/messages";
import { appendMessages, listMessages } from "../../../lib/repo";

// --- 会話の保存と続きから (EXP-010) ---
// owner はセッションのメール。ログに会話の中身・メール・接続文字列は出さない。

type Perf = ReturnType<typeof startPerf>;

const ROUTE = "api/messages";

export async function GET(req: Request) {
  const perf = startPerf(ROUTE, ["db_ms"]);
  try {
    return perf.finish(await handleGet(req, perf));
  } catch (error: unknown) {
    perf.finish(new Response(null, { status: 500 }));
    throw error;
  }
}

export async function POST(req: Request) {
  const perf = startPerf(ROUTE, ["db_ms"]);
  try {
    return perf.finish(await handlePost(req, perf));
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

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** DB の失敗を応答に変える。未設定は 503、それ以外は種類と Postgres の code だけを記録して 500。 */
function dbFailure(error: unknown): NextResponse {
  if (error instanceof DbNotConfigured) {
    return NextResponse.json({ error: "データベースが未設定です" }, { status: 503 });
  }
  const name = error instanceof Error ? error.name : typeof error;
  // message と detail には会話の中身が入りうるので出さない
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  console.error(`[${ROUTE}] db error: ${name}${typeof code === "string" ? ` code=${code}` : ""}`);
  return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
}

async function handleGet(req: Request, perf: Perf): Promise<NextResponse> {
  const owner = await ownerOf();
  if (!owner) return unauthorized();

  const params = new URL(req.url).searchParams;
  const projectId = params.get("projectId");
  const thread = params.get("thread");
  if (!isUuid(projectId)) return badRequest("projectId が正しくありません");
  if (!isThread(thread)) return badRequest("thread が正しくありません");

  try {
    const sql = getSql();
    const messages = await perf.time("db_ms", () => listMessages(sql, owner, projectId, thread));
    perf.set({ row_count: messages.length });
    return NextResponse.json({ messages });
  } catch (error: unknown) {
    return dbFailure(error);
  }
}

async function handlePost(req: Request, perf: Perf): Promise<NextResponse> {
  const owner = await ownerOf();
  if (!owner) return unauthorized();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return badRequest("JSON として読めません");
  }
  const input = parseMessagesInput(raw);
  if (!input) return badRequest("入力が正しくありません");

  try {
    const sql = getSql();
    const count = await perf.time("db_ms", () => appendMessages(sql, owner, input));
    perf.set({ row_count: count ?? 0 });
    if (count === null) return NextResponse.json({ error: "プロジェクトが見つかりません" }, { status: 404 });
    return NextResponse.json({ count }, { status: 201 });
  } catch (error: unknown) {
    return dbFailure(error);
  }
}
