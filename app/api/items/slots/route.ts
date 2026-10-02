import { NextResponse } from "next/server";
import { startPerf } from "../../../../lib/perf";
import { getSql } from "../../../../lib/db";
import { isUuid } from "../../../../lib/projects";
import { listItemSlots } from "../../../../lib/repo";
import { bad, dbFailure, ownerOf, unauthorized } from "../../../../lib/route-helpers";

// --- プロジェクトの ToDo の時刻の一覧 (EXP-039) ---

const ROUTE = "api/items/slots";

export async function GET(req: Request) {
  const perf = startPerf(ROUTE, ["db_ms"]);
  try {
    const owner = await ownerOf();
    if (!owner) return perf.finish(unauthorized());
    const projectId = new URL(req.url).searchParams.get("projectId");
    if (!isUuid(projectId)) return perf.finish(bad("projectId が正しくありません"));
    try {
      const sql = getSql();
      const slots = await perf.time("db_ms", () => listItemSlots(sql, owner, projectId));
      perf.set({ row_count: slots.length });
      return perf.finish(NextResponse.json({ slots }));
    } catch (error: unknown) {
      return perf.finish(dbFailure(ROUTE, error));
    }
  } catch (error: unknown) {
    perf.finish(new Response(null, { status: 500 }));
    throw error;
  }
}
