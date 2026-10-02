import { NextResponse } from "next/server";
import { startPerf } from "../../../../lib/perf";
import { getSql } from "../../../../lib/db";
import { isUuid } from "../../../../lib/projects";
import { parseTaskPatch } from "../../../../lib/daily-tasks";
import { deleteTask, updateTask } from "../../../../lib/repo";
import { bad, dbFailure, notFound, ownerOf, readJson, unauthorized } from "../../../../lib/route-helpers";

// --- 日常のタスクを変える / 消す (EXP-040)。持ち主のものだけ ---

const ROUTE = "api/tasks/[id]";
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const perf = startPerf(ROUTE, ["db_ms"]);
  try {
    const { id } = await params;
    const owner = await ownerOf();
    if (!owner) return perf.finish(unauthorized());
    if (!isUuid(id)) return perf.finish(bad("id が正しくありません"));
    const patch = parseTaskPatch(await readJson(req));
    if (!patch) return perf.finish(bad("変える内容が正しくありません"));
    try {
      const sql = getSql();
      const task = await perf.time("db_ms", () => updateTask(sql, owner, id, patch));
      return perf.finish(task ? NextResponse.json({ task }) : notFound());
    } catch (error: unknown) {
      return perf.finish(dbFailure(ROUTE, error));
    }
  } catch (error: unknown) {
    perf.finish(new Response(null, { status: 500 }));
    throw error;
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const perf = startPerf(ROUTE, ["db_ms"]);
  try {
    const { id } = await params;
    const owner = await ownerOf();
    if (!owner) return perf.finish(unauthorized());
    if (!isUuid(id)) return perf.finish(bad("id が正しくありません"));
    try {
      const sql = getSql();
      const ok = await perf.time("db_ms", () => deleteTask(sql, owner, id));
      return perf.finish(ok ? new NextResponse(null, { status: 204 }) : notFound());
    } catch (error: unknown) {
      return perf.finish(dbFailure(ROUTE, error));
    }
  } catch (error: unknown) {
    perf.finish(new Response(null, { status: 500 }));
    throw error;
  }
}
