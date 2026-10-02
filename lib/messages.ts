// --- 会話の保存と続きから (EXP-010) ---
// API が受け取った会話を、データベースへ渡す前に検査する (純粋な関数だけ・next や db に依存しない)。

import { isUuid } from "./projects";

// Plan の会話と通常のチャットを分けて保存する。chat = 壁打ち・相談・kgi / kpi / kdi / todo は目的ごとの会話 (EXP-043)
export type Thread = "plan" | "chat" | "kgi" | "kpi" | "kdi" | "todo";
const THREADS: string[] = ["plan", "chat", "kgi", "kpi", "kdi", "todo"];
export type StoredMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string };
export type MessagesInput = { projectId: string; thread: Thread; messages: { role: "user" | "assistant"; content: string }[] };

/** 1 件の字数の上限 ([...s] で数える)。 */
export const MESSAGE_MAX = 8000;
/** 1 回に保存できる件数。 */
export const BATCH_MAX = 20;
/** 読み出す件数 (新しい 100 件を古い順に)。 */
export const HISTORY_LIMIT = 100;

function asRecord(x: unknown): Record<string, unknown> | null {
  return typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

export function isThread(x: unknown): x is Thread {
  return typeof x === "string" && THREADS.includes(x);
}

function isRole(x: unknown): x is "user" | "assistant" {
  return x === "user" || x === "assistant";
}

/** 1 件の発言。空白だけは弾くが、保存するのは受け取ったまま (会話の中身を変えないため)。 */
function parseMessage(x: unknown): { role: "user" | "assistant"; content: string } | null {
  const r = asRecord(x);
  if (!r || !isRole(r.role) || typeof r.content !== "string") return null;
  const content = r.content;
  // 字数は見た目の 1 文字で数える (絵文字を 2 と数えない)
  if (content.trim() === "" || [...content].length > MESSAGE_MAX) return null;
  return { role: r.role, content };
}

/** 会話の保存の入力。projectId は UUID・thread は plan か chat・1〜20 件・各 content は空でなく 8000 字まで。余計な項目は落とす。 */
export function parseMessagesInput(x: unknown): MessagesInput | null {
  const r = asRecord(x);
  if (!r || !isUuid(r.projectId) || !isThread(r.thread) || !Array.isArray(r.messages)) return null;
  if (r.messages.length < 1 || r.messages.length > BATCH_MAX) return null;
  const messages: MessagesInput["messages"] = [];
  for (const m of r.messages) {
    const parsed = parseMessage(m);
    if (!parsed) return null;
    messages.push(parsed);
  }
  return { projectId: r.projectId, thread: r.thread, messages };
}
