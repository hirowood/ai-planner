import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { startPerf } from "../../../../lib/perf";
import { DbNotConfigured, getSql } from "../../../../lib/db";
import { isUuid } from "../../../../lib/projects";
import { deleteNote } from "../../../../lib/repo";

// --- ノートを消す (EXP-008) ---
// owner のノートだけを消す。他人・無いノートは 404 (有無を区別させない)。

type Perf = ReturnType<typeof startPerf>;

const ROUTE = "api/notes/[id]";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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

async function handleDelete(id: string, perf: Perf): Promise<Response> {
  const owner = await ownerOf();
  if (!owner) return NextResponse.json({ error: "Unauthorized: ログインが必要です" }, { status: 401 });
  if (!isUuid(id)) return NextResponse.json({ error: "id が正しくありません" }, { status: 400 });

  try {
    const sql = getSql();
    const deleted = await perf.time("db_ms", () => deleteNote(sql, owner, id));
    perf.set({ row_count: deleted ? 1 : 0 });
    if (!deleted) return NextResponse.json({ error: "ノートが見つかりません" }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error: unknown) {
    return dbFailure(error);
  }
}
