// --- 過去の記録と会話から作る「よく使う入力」(EXP-025) ---
// 画面で作る (Gemini を使わない)。押すと入力欄に入り、直してから送れる。

import type { PlanItem } from "./plan-items";

export const QUICK_MAX = 6;
const TITLE_CHARS = 12;
const NOTE_CHARS = 10;
const OWN_MESSAGE_CHARS = 20;
const QUICK_CHARS = 30;

function cut(s: string, n: number): string {
  const chars = [...s.replace(/\s+/g, " ").trim()];
  return chars.length > n ? `${chars.slice(0, n).join("")}…` : chars.join("");
}

function newestFirst(a: PlanItem, b: PlanItem): number {
  return b.createdAt.localeCompare(a.createdAt);
}

/**
 * 階層の未実行の ToDo (新しい 2 つ)・未実行の KDI (1 つ)・新しいノート (1 つ)・自分の過去の発言 (新しい 2 つ) から作る。
 * 重複なし・最大 6 個・どれも 30 字まで。
 */
export function buildQuickReplies(p: { items: PlanItem[]; notes: { body: string }[]; userMessages: string[] }): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    const t = s.trim();
    if (t === "" || [...t].length > QUICK_CHARS || out.includes(t) || out.length >= QUICK_MAX) return;
    out.push(t);
  };

  const open = p.items.filter((i) => i.status === "todo").sort(newestFirst);
  for (const todo of open.filter((i) => i.level === "todo").slice(0, 2)) {
    add(`『${cut(todo.title, TITLE_CHARS)}』をやりました`);
    add(`『${cut(todo.title, TITLE_CHARS)}』ができませんでした`);
  }
  const kdi = open.find((i) => i.level === "kdi");
  if (kdi) add(`『${cut(kdi.title, TITLE_CHARS)}』の進み具合を相談したい`);
  const note = p.notes[0];
  if (note) add(`ノート『${cut(note.body, NOTE_CHARS)}』について`);

  // 自分の過去の発言: 新しい順に、20 字以内のものから 2 つ (同じ文の言い直しに使う)
  const own = [...p.userMessages].reverse().map((m) => m.trim()).filter((m) => m !== "" && [...m].length <= OWN_MESSAGE_CHARS);
  let ownAdded = 0;
  for (const m of own) {
    if (ownAdded >= 2) break;
    const before = out.length;
    add(m);
    if (out.length > before) ownAdded += 1;
  }
  return out;
}
