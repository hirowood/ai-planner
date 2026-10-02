import { NextResponse } from "next/server";
import { startPerf } from "../../../../lib/perf";
import { getSql } from "../../../../lib/db";
import { listScheduledTodos } from "../../../../lib/repo";
import { bad, dbFailure, ownerOf, parseRange, unauthorized } from "../../../../lib/route-helpers";

// --- アプリ内のカレンダー: 全プロジェクトの ToDo (EXP-039) ---

const ROUTE = "api/items/schedule";

export async function GET(req: Request) {
  const perf = startPerf(ROUTE, ["db_ms"]);
  try {
    const owner = await ownerOf();
    if (!owner) return perf.finish(unauthorized());
    const range = parseRange(new URL(req.url).searchParams, 62);
    if (!range) return perf.finish(bad("from と to は日付で、62 日までにしてください"));
    try {
      const sql = getSql();
      const todos = await perf.time("db_ms", () => listScheduledTodos(sql, owner, range.from, range.to));
      perf.set({ row_count: todos.length });
      return perf.finish(NextResponse.json({ todos }));
    } catch (error: unknown) {
      return perf.finish(dbFailure(ROUTE, error));
    }
  } catch (error: unknown) {
    perf.finish(new Response(null, { status: 500 }));
    throw error;
  }
}
