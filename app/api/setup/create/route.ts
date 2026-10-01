import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { startPerf } from "../../../../lib/perf";
import { DbNotConfigured, getSql } from "../../../../lib/db";
import { EMPTY_PLAN } from "../../../../lib/pdca-plan";
import { isSmartReady, parseSmartDraft, smartToKgi, todayJst } from "../../../../lib/smart";
import { createItem, createProject, saveCycle } from "../../../../lib/repo";

// --- SMART の下書きからプロジェクトを作る (EXP-018) ---
// プロジェクト・階層の KGI (固定・EXP-024)・cycle (Plan の目的と KGI) をまとめて作る。すべて owner で。
// ログは [perf] の数と、DB の失敗の名前と Postgres の code だけ (下書きの中身・メールは出さない)。

type Perf = ReturnType<typeof startPerf>;

export async function POST(req: Request) {
  const perf = startPerf("api/setup/create", ["db_ms"]);
  try {
    return perf.finish(await handle(req, perf));
  } catch (error: unknown) {
    perf.finish(new Response(null, { status: 500 }));
    throw error;
  }
}

async function handle(req: Request, perf: Perf): Promise<Response> {
  const session = await getServerSession(authOptions);
  const owner = session?.user?.email;
  if (typeof owner !== "string" || owner.length === 0) {
    return NextResponse.json({ error: "Unauthorized: ログインが必要です" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON として読めません" }, { status: 400 });
  }
  const draft = parseSmartDraft((raw as { draft?: unknown } | null)?.draft);
  // 最後の関門: すべての欄が埋まり、期限が今日以降の下書きだけを作る (データベースより前に断る)
  if (!draft || !isSmartReady(draft, todayJst())) {
    return NextResponse.json({ error: "SMART のすべての欄を埋め、期限を今日以降にしてください" }, { status: 400 });
  }

  try {
    const sql = getSql();
    const created = await perf.time("db_ms", async () => {
      const project = await createProject(sql, owner, { name: draft.name, category: draft.category, purpose: draft.relevant });
      const kgi = await createItem(sql, owner, {
        projectId: project.id,
        parentId: null,
        level: "kgi",
        ...smartToKgi(draft),
        status: "todo",
      });
      const cycle = await saveCycle(sql, owner, {
        projectId: project.id,
        plan: { ...EMPTY_PLAN, kpis: [], kdis: [], purpose: draft.relevant, kgi: `${draft.specific}（${draft.measurable}）${draft.timeBound} まで` },
        phase: "plan",
      });
      return { project, kgi, cycle };
    });
    const kgiOk = created.kgi !== null && typeof created.kgi === "object";
    perf.set({ row_count: kgiOk ? 3 : 1 });
    if (!kgiOk || !created.cycle) {
      return NextResponse.json({ error: "KGI を作れませんでした" }, { status: 500 });
    }
    return NextResponse.json({ project: created.project, kgi: created.kgi }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof DbNotConfigured) {
      return NextResponse.json({ error: "データベースが未設定です" }, { status: 503 });
    }
    const name = error instanceof Error ? error.name : typeof error;
    const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
    console.error("Setup create DB error:", name, typeof code === "string" ? code : "");
    return NextResponse.json({ error: "サーバー内部でエラーが発生しました。" }, { status: 500 });
  }
}
