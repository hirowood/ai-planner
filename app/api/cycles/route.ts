import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { startPerf } from "../../../lib/perf";
import { DbNotConfigured, getSql } from "../../../lib/db";
import { isUuid } from "../../../lib/projects";
import { parsePlanDraft } from "../../../lib/pdca-plan";
import { getLatestCycle, saveCycle, type CycleInput } from "../../../lib/repo";

// --- PDCA の cycle (EXP-009) ---
// owner はセッションのメール。ログに Plan の中身・メール・接続文字列は出さない。

type Perf = ReturnType<typeof startPerf>;

const ROUTE = "api/cycles";

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

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** DB の失敗を応答に変える。未設定は 503、それ以外は種類と Postgres の code だけを記録して 500。 */
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

/** PUT の本文を検査する。形が合わなければ null。 */
function parseCycleInput(raw: unknown): CycleInput | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isUuid(r.projectId)) return null;
  let cycleId: string | undefined;
  if (r.cycleId !== undefined && r.cycleId !== null) {
    if (!isUuid(r.cycleId)) return null;
    cycleId = r.cycleId;
  }
  const plan = parsePlanDraft(r.plan);
  if (!plan) return null;
  let phase: "plan" | "do" = "plan";
  if (r.phase !== undefined) {
    if (r.phase !== "plan" && r.phase !== "do") return null;
    phase = r.phase;
  }
  return { projectId: r.projectId, cycleId, plan, phase };
}

async function handleGet(req: Request, perf: Perf): Promise<NextResponse> {
  const owner = await ownerOf();
  if (!owner) return unauthorized();

  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!isUuid(projectId)) return badRequest("projectId が正しくありません");

  try {
    const sql = getSql();
    const cycle = await perf.time("db_ms", () => getLatestCycle(sql, owner, projectId));
    perf.set({ row_count: cycle ? 1 : 0 });
    return NextResponse.json({ cycle });
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
    return badRequest("JSON として読めません");
  }
  const input = parseCycleInput(raw);
  if (!input) return badRequest("入力が正しくありません");

  try {
    const sql = getSql();
    const cycle = await perf.time("db_ms", () => saveCycle(sql, owner, input));
    perf.set({ row_count: cycle ? 1 : 0 });
    if (!cycle) return NextResponse.json({ error: "プロジェクトまたは cycle が見つかりません" }, { status: 404 });
    return NextResponse.json({ cycle });
  } catch (error: unknown) {
    return dbFailure(error);
  }
}
