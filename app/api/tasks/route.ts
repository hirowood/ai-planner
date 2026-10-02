import { NextResponse } from "next/server";
import { startPerf } from "../../../lib/perf";
import { getSql } from "../../../lib/db";
import { parseTaskInput } from "../../../lib/daily-tasks";
import { todayJst } from "../../../lib/smart";
import { createTask, listTasks } from "../../../lib/repo";
import { bad, dbFailure, ownerOf, parseRange, readJson, unauthorized } from "../../../lib/route-helpers";

// --- 日常のタスク (EXP-040)。プロジェクトに属さない・持ち主ごと ---

const ROUTE = "api/tasks";

export async function GET(req: Request) {
  const perf = startPerf(ROUTE, ["db_ms"]);
  try {
    const owner = await ownerOf();
    if (!owner) return perf.finish(unauthorized());
    const range = parseRange(new URL(req.url).searchParams, 62);
    if (!range) return perf.finish(bad("from と to は日付で、62 日までにしてください"));
    try {
      const sql = getSql();
      const tasks = await perf.time("db_ms", () => listTasks(sql, owner, range.from, range.to));
      perf.set({ row_count: tasks.length });
      return perf.finish(NextResponse.json({ tasks }));
    } catch (error: unknown) {
      return perf.finish(dbFailure(ROUTE, error));
    }
  } catch (error: unknown) {
    perf.finish(new Response(null, { status: 500 }));
    throw error;
  }
}

export async function POST(req: Request) {
  const perf = startPerf(ROUTE, ["db_ms"]);
  try {
    const owner = await ownerOf();
    if (!owner) return perf.finish(unauthorized());
    const input = parseTaskInput(await readJson(req), todayJst());
    if (!input) return perf.finish(bad("題は 1〜100 字・日付は 7 日前から 62 日先まで・時刻は開始と終了の両方を HH:MM で"));
    try {
      const sql = getSql();
      const task = await perf.time("db_ms", () => createTask(sql, owner, input));
      return perf.finish(NextResponse.json({ task }, { status: 201 }));
    } catch (error: unknown) {
      return perf.finish(dbFailure(ROUTE, error));
    }
  } catch (error: unknown) {
    perf.finish(new Response(null, { status: 500 }));
    throw error;
  }
}
