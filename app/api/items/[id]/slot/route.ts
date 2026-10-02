import { NextResponse } from "next/server";
import { startPerf } from "../../../../../lib/perf";
import { getSql } from "../../../../../lib/db";
import { isUuid } from "../../../../../lib/projects";
import { parseSlot } from "../../../../../lib/slots";
import { deleteItemSlot, upsertItemSlot } from "../../../../../lib/repo";
import { bad, dbFailure, notFound, ownerOf, readJson, unauthorized } from "../../../../../lib/route-helpers";

// --- ToDo の時刻を入れる / 外す (EXP-039) ---

const ROUTE = "api/items/[id]/slot";
type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const perf = startPerf(ROUTE, ["db_ms"]);
  try {
    const { id } = await params;
    return perf.finish(await handle(req, id, perf));
  } catch (error: unknown) {
    perf.finish(new Response(null, { status: 500 }));
    throw error;
  }
}

async function handle(req: Request, id: string, perf: ReturnType<typeof startPerf>): Promise<Response> {
  const owner = await ownerOf();
  if (!owner) return unauthorized();
  if (!isUuid(id)) return bad("id が正しくありません");
  const slot = parseSlot(await readJson(req));
  if (slot === null) return bad("時刻は開始と終了の両方を HH:MM で (終了は開始より後に)。外すときは両方を空に");
  try {
    const sql = getSql();
    const ok = await perf.time("db_ms", () => (slot === "clear" ? deleteItemSlot(sql, owner, id) : upsertItemSlot(sql, owner, id, slot.start, slot.end)));
    if (!ok) return notFound();
    return NextResponse.json({ slot: slot === "clear" ? null : { itemId: id, ...slot } });
  } catch (error: unknown) {
    return dbFailure(ROUTE, error);
  }
}
