// db/schema.sql を DATABASE_URL のデータベースへ流す (EXP-008)。
// 使い方: node --env-file=.env.local scripts/db-migrate.mjs
// 接続文字列には秘密が入るので、どこにも出さない。出すのは作った表の名前だけ。

import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL が未設定です (.env.local を確認してください)");
  process.exit(1);
}

const schemaPath = new URL("../db/schema.sql", import.meta.url);
const text = await readFile(schemaPath, "utf8");

// 行コメントを外し、; で文に分ける (固定のスキーマファイルだけが対象。文字列の中に ; は無い)
const statements = text
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const sql = neon(url);

try {
  for (const stmt of statements) {
    // 固定のスキーマファイルの文なので query() で流してよい (利用者の値は入らない)
    await sql.query(stmt);
  }
  const rows = await sql`
    select table_name from information_schema.tables
    where table_schema = current_schema() and table_name in ('projects', 'notes', 'cycles', 'messages')
    order by table_name
  `;
  for (const row of rows) console.log(row.table_name);
} catch (error) {
  // 失敗の種類と文だけを出す (接続文字列は出さない)
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message.split(url).join("<DATABASE_URL>") : "unknown";
  // 通信の失敗は理由のコード (ENOTFOUND・ECONNRESET など) だけを足す。どこで止まったかを見分けるため
  const source = error?.sourceError ?? error?.cause;
  const cause = source?.cause?.code ?? source?.code ?? source?.name;
  console.error(`migrate failed: ${name}: ${message}${cause ? ` (cause: ${cause})` : ""}`);
  process.exit(1);
}
