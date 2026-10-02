// --- route の共通 (EXP-039・040) ---
// owner (セッションのメール)・401・DB の失敗の応答。ログは名前と Postgres の code だけ (値・メールは出さない)。

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../app/api/auth/[...nextauth]/route";
import { DbNotConfigured } from "./db";

export async function ownerOf(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  return typeof email === "string" && email.length > 0 ? email : null;
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized: ログインが必要です" }, { status: 401 });
}

export function bad(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(): NextResponse {
  return NextResponse.json({ error: "見つかりません" }, { status: 404 });
}

export function dbFailure(route: string, error: unknown): NextResponse {
  if (error instanceof DbNotConfigured) {
    return NextResponse.json({ error: "データベースが未設定です" }, { status: 503 });
  }
  const name = error instanceof Error ? error.name : typeof error;
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  console.error(`[${route}] db error: ${name}${typeof code === "string" ? ` code=${code}` : ""}`);
  return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
}

export async function readJson(req: Request): Promise<unknown | undefined> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ?from=&to= (実在の日付・from ≤ to・最大 maxDays 日)。通らなければ null。 */
export function parseRange(params: URLSearchParams, maxDays: number): { from: string; to: string } | null {
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const ms = (s: string) => {
    const m = YMD_RE.exec(s);
    if (!m) return null;
    const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(t);
    return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? t : null;
  };
  const a = ms(from);
  const b = ms(to);
  if (a === null || b === null || a > b) return null;
  if ((b - a) / 86_400_000 + 1 > maxDays) return null;
  return { from, to };
}
