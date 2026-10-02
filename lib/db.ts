// --- データベース (Neon Postgres) への接続 (EXP-008) ---
// 問い合わせは tagged template だけで行う (値は必ずパラメータになり、文字列で SQL を組まない)。
// 接続文字列には秘密が入るので、エラーの文やログに値を出さない。

import { neon } from "@neondatabase/serverless";

export type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;

/** DATABASE_URL が未設定。API はこれを 503 に変える。 */
export class DbNotConfigured extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbNotConfigured";
  }
}

// 同じプロセスの中では 1 回だけ作る (リクエストごとに作らない)。
let cached: Sql | null = null;

export function getSql(): Sql {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new DbNotConfigured("DATABASE_URL is not set");
  // neon の戻り値は配列を返す tagged template。型だけを約束の Sql に合わせる。
  cached = neon(url) as unknown as Sql;
  return cached;
}
