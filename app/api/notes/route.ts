import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { startPerf } from "../../../lib/perf";
import { DbNotConfigured, getSql } from "../../../lib/db";
import { isUuid, parseNoteInput } from "../../../lib/projects";
import { createNote, listNotes } from "../../../lib/repo";

// --- プロジェクトのノート (EXP-008) ---
// owner はセッションのメール。ログに本文・メール・接続文字列は出さない。

type Perf = ReturnType<typeof startPerf>;

const ROUTE = "api/notes";

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

/** DB の失敗を応答に変える。未設定は 503、それ以外は種類と文だけを記録して 500 (値や詳細は出さない)。 */
function dbFailure(error: unknown): NextResponse {
  if (error instanceof DbNotConfigured) {
    return NextResponse.json({ error: "データベースが未設定です" }, { status: 503 });
  }
  const name = error instanceof Error ? error.name : typeof error;
  // message と detail には入力の値が入りうる (例: invalid input syntax for type uuid: "...") ので出さない
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  console.error(`[${ROUTE}] db error: ${name}${typeof code === "string" ? ` code=${code}` : ""}`);
  return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
}

async function handleGet(req: Request, perf: Perf): Promise<NextResponse> {
  const owner = await ownerOf();
  if (!owner) return unauthorized();

  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!isUuid(projectId)) return NextResponse.json({ error: "projectId が正しくありません" }, { status: 400 });

  try {
    const sql = getSql();
    const notes = await perf.time("db_ms", () => listNotes(sql, owner, projectId));
    perf.set({ row_count: notes.length });
    return NextResponse.json({ notes });
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
    return NextResponse.json({ error: "JSON として読めません" }, { status: 400 });
  }
  const input = parseNoteInput(raw);
  if (!input) return NextResponse.json({ error: "入力が正しくありません" }, { status: 400 });

  try {
    const sql = getSql();
    const note = await perf.time("db_ms", () => createNote(sql, owner, input));
    perf.set({ row_count: note ? 1 : 0 });
    if (!note) return NextResponse.json({ error: "プロジェクトが見つかりません" }, { status: 404 });
    return NextResponse.json({ note }, { status: 201 });
  } catch (error: unknown) {
    return dbFailure(error);
  }
}
