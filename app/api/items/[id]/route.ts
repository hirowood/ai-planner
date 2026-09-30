import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { startPerf } from "../../../../lib/perf";
import { DbNotConfigured, getSql } from "../../../../lib/db";
import { isUuid } from "../../../../lib/projects";
import { parseItemPatch } from "../../../../lib/plan-items";
import { deleteItem, updateItem } from "../../../../lib/repo";

// --- 階層の項目を変える・消す (EXP-017) ---
// owner の項目だけに触れる。他人・無い項目は 404 (有無を区別させない)。

type Perf = ReturnType<typeof startPerf>;
type Ctx = { params: Promise<{ id: string }> };

const ROUTE = "api/items/[id]";

export async function PATCH(req: Request, { params }: Ctx) {
  const perf = startPerf(ROUTE, ["db_ms"]);
  try {
    const { id } = await params;
    return perf.finish(await handlePatch(req, id, perf));
  } catch (error: unknown) {
    perf.finish(new Response(null, { status: 500 }));
    throw error;
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const perf = startPerf(ROUTE, ["db_ms"]);
  try {
    const { id } = await params;
    return perf.finish(await handleDelete(id, perf));
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

function notFound(): NextResponse {
  return NextResponse.json({ error: "項目が見つかりません" }, { status: 404 });
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

async function handlePatch(req: Request, id: string, perf: Perf): Promise<Response> {
  const owner = await ownerOf();
  if (!owner) return unauthorized();
  if (!isUuid(id)) return NextResponse.json({ error: "id が正しくありません" }, { status: 400 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON として読めません" }, { status: 400 });
  }
  const patch = parseItemPatch(raw);
  if (!patch) return NextResponse.json({ error: "入力が正しくありません" }, { status: 400 });

  try {
    const sql = getSql();
    const item = await perf.time("db_ms", () => updateItem(sql, owner, id, patch));
    perf.set({ row_count: item ? 1 : 0 });
    if (!item) return notFound();
    return NextResponse.json({ item });
  } catch (error: unknown) {
    return dbFailure(error);
  }
}

async function handleDelete(id: string, perf: Perf): Promise<Response> {
  const owner = await ownerOf();
  if (!owner) return unauthorized();
  if (!isUuid(id)) return NextResponse.json({ error: "id が正しくありません" }, { status: 400 });

  try {
    const sql = getSql();
    const deleted = await perf.time("db_ms", () => deleteItem(sql, owner, id));
    perf.set({ row_count: deleted ? 1 : 0 });
    if (!deleted) return notFound();
    return new Response(null, { status: 204 });
  } catch (error: unknown) {
    return dbFailure(error);
  }
}
