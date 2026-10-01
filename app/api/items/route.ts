import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { startPerf } from "../../../lib/perf";
import { DbNotConfigured, getSql } from "../../../lib/db";
import { isUuid } from "../../../lib/projects";
import { parseItemInput } from "../../../lib/plan-items";
import { KGI_EXISTS, createItem, listItems } from "../../../lib/repo";

// --- プロジェクトの中の階層 (EXP-017) ---
// owner はセッションのメール。ログにタイトル・目標値・メール・接続文字列は出さない。

type Perf = ReturnType<typeof startPerf>;

const ROUTE = "api/items";

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

/** DB の失敗を応答に変える。未設定は 503、それ以外は種類と Postgres のコードだけを記録して 500。 */
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

  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!isUuid(projectId)) return NextResponse.json({ error: "projectId が正しくありません" }, { status: 400 });

  try {
    const sql = getSql();
    const items = await perf.time("db_ms", () => listItems(sql, owner, projectId));
    perf.set({ row_count: items.length });
    return NextResponse.json({ items });
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
  const input = parseItemInput(raw);
  if (!input) return NextResponse.json({ error: "入力が正しくありません" }, { status: 400 });

  try {
    const sql = getSql();
    const item = await perf.time("db_ms", () => createItem(sql, owner, input));
    if (item === KGI_EXISTS) {
      // KGI はプロジェクトに 1 つ (EXP-026)
      perf.set({ row_count: 0 });
      return NextResponse.json({ error: "KGI はプロジェクトに 1 つです。KGI に足せるのは KPI です" }, { status: 409 });
    }
    perf.set({ row_count: item ? 1 : 0 });
    if (!item) return NextResponse.json({ error: "プロジェクトか親が見つかりません" }, { status: 404 });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error: unknown) {
    return dbFailure(error);
  }
}
