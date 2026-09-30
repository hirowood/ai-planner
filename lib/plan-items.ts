// --- プロジェクトの中の階層 KGI → KPI → KDI → ToDo とタスクの状態 (EXP-017) ---
// 形・検査・木の組み立て・件数・次の親を決める (純粋な関数だけ・next や db に依存しない)。

import { isUuid } from "./projects";

export type ItemLevel = "kgi" | "kpi" | "kdi" | "todo";
export type ItemStatus = "todo" | "done" | "shelved" | "failed" | "succeeded" | "adjusted";

export const LEVEL_LABEL: Record<ItemLevel, string> = {
  kgi: "KGI (ゴール)",
  kpi: "KPI (途中の指標)",
  kdi: "KDI (行動の目標)",
  todo: "ToDo",
};

export const STATUS_LABEL: Record<ItemStatus, string> = {
  todo: "未実行",
  done: "実行",
  shelved: "棚上げ",
  failed: "失敗",
  succeeded: "成功",
  adjusted: "調整",
};

export const STATUS_ORDER: ItemStatus[] = ["todo", "done", "shelved", "failed", "succeeded", "adjusted"];

/** 子の段。ToDo の下には作らない。 */
export const CHILD_LEVEL: Record<ItemLevel, ItemLevel | null> = {
  kgi: "kpi",
  kpi: "kdi",
  kdi: "todo",
  todo: null,
};

export type PlanItem = {
  id: string;
  projectId: string;
  parentId: string | null;
  level: ItemLevel;
  title: string;
  target: string;
  dueDate: string;
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
};
export type ItemInput = {
  projectId: string;
  parentId: string | null;
  level: ItemLevel;
  title: string;
  target: string;
  dueDate: string;
  status: ItemStatus;
};
export type ItemPatch = Partial<Pick<PlanItem, "title" | "target" | "dueDate" | "status">>;
export type TreeNode = PlanItem & { children: TreeNode[] };

const TITLE_MAX = 200;
const TARGET_MAX = 200;
const LEVELS: readonly string[] = ["kgi", "kpi", "kdi", "todo"];
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function asRecord(x: unknown): Record<string, unknown> | null {
  return typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

// 形だけでなく実在する日付か (2026-02-30 を期日にしない)。Date.UTC で往復して確かめる (pdca-plan と同じ)
function isRealDate(s: string): boolean {
  const m = YMD_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

// 字数は [...s] で数える (絵文字などのサロゲートペアを 1 字とする)
function len(s: string): number {
  return [...s].length;
}

function isLevel(v: unknown): v is ItemLevel {
  return typeof v === "string" && LEVELS.includes(v);
}

function isStatus(v: unknown): v is ItemStatus {
  return typeof v === "string" && (STATUS_ORDER as readonly string[]).includes(v);
}

// 各欄の検査。通らなければ null (切り詰めずに弾く: 黙って内容を変えない)
function title(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  const n = len(t);
  return n >= 1 && n <= TITLE_MAX ? t : null;
}

function target(v: unknown): string | null {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") return null;
  const t = v.trim();
  return len(t) <= TARGET_MAX ? t : null;
}

function dueDate(v: unknown): string | null {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" || isRealDate(t) ? t : null;
}

/** 追加の入力。title 1〜200 字・target 0〜200 字・dueDate は実在日か ""・status 既定 todo・kgi だけ親なし。余計な項目は落とす。 */
export function parseItemInput(x: unknown): ItemInput | null {
  const r = asRecord(x);
  if (!r) return null;
  if (!isUuid(r.projectId)) return null;
  if (!isLevel(r.level)) return null;
  const level = r.level;

  // KGI は一番上なので親を持たない。それ以外は必ず親の下に作る
  let parentId: string | null;
  if (level === "kgi") {
    if (r.parentId !== undefined && r.parentId !== null) return null;
    parentId = null;
  } else {
    if (!isUuid(r.parentId)) return null;
    parentId = r.parentId;
  }

  const t = title(r.title);
  const tg = target(r.target);
  const d = dueDate(r.dueDate);
  if (t === null || tg === null || d === null) return null;

  let status: ItemStatus = "todo";
  if (r.status !== undefined) {
    if (!isStatus(r.status)) return null;
    status = r.status;
  }

  return { projectId: r.projectId, parentId, level, title: t, target: tg, dueDate: d, status };
}

/** 更新の入力。1 つ以上の項目があり、どれも追加と同じ検査に通る。段・親・プロジェクトは変えさせない。 */
export function parseItemPatch(x: unknown): ItemPatch | null {
  const r = asRecord(x);
  if (!r) return null;
  const out: ItemPatch = {};
  if (r.title !== undefined) {
    const t = title(r.title);
    if (t === null) return null;
    out.title = t;
  }
  if (r.target !== undefined) {
    const t = target(r.target);
    if (t === null) return null;
    out.target = t;
  }
  if (r.dueDate !== undefined) {
    const d = dueDate(r.dueDate);
    if (d === null) return null;
    out.dueDate = d;
  }
  if (r.status !== undefined) {
    if (!isStatus(r.status)) return null;
    out.status = r.status;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function byCreated(a: TreeNode, b: TreeNode): number {
  if (a.createdAt < b.createdAt) return -1;
  if (a.createdAt > b.createdAt) return 1;
  // 同じ時刻でも並びが揺れないよう id で決める
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 親子に組む。親が見つからない項目と親の輪に入った項目は一番上に。同じ親の中は createdAt の古い順。入力は変えない。 */
export function buildTree(items: PlanItem[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  for (const it of items) {
    if (nodes.has(it.id)) continue; // 同じ id が重なれば最初の 1 つだけ
    nodes.set(it.id, {
      id: it.id,
      projectId: it.projectId,
      parentId: it.parentId,
      level: it.level,
      title: it.title,
      target: it.target,
      dueDate: it.dueDate,
      status: it.status,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
      children: [],
    });
  }

  // 親を辿って輪 (A→B→A・自分が親) を見つける。輪の中の項目は一番上に置き、無限に辿らないようにする
  const inCycle = new Set<string>();
  const settled = new Set<string>();
  for (const start of nodes.keys()) {
    if (settled.has(start)) continue;
    const path: string[] = [];
    const onPath = new Set<string>();
    let cur: string | null = start;
    while (cur !== null && nodes.has(cur) && !settled.has(cur)) {
      if (onPath.has(cur)) {
        for (let i = path.indexOf(cur); i < path.length; i++) inCycle.add(path[i]);
        break;
      }
      onPath.add(cur);
      path.push(cur);
      cur = nodes.get(cur)!.parentId;
    }
    for (const id of path) settled.add(id);
  }

  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId !== null && !inCycle.has(node.id) ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  for (const node of nodes.values()) node.children.sort(byCreated);
  roots.sort(byCreated);
  return roots;
}

/** 状態ごとの件数 (0 件の状態も 0 で持つ)。 */
export function statusCounts(items: PlanItem[]): Record<ItemStatus, number> {
  const out = { todo: 0, done: 0, shelved: 0, failed: 0, succeeded: 0, adjusted: 0 } as Record<ItemStatus, number>;
  for (const it of items) {
    if (isStatus(it.status)) out[it.status] += 1;
  }
  return out;
}

/** 前に足した親が今もあり、子を持てる段ならそれ (同じ階層に作る)。無ければ null。 */
export function nextParentFor(items: PlanItem[], lastParentId: string | null): PlanItem | null {
  if (lastParentId === null) return null;
  const found = items.find((it) => it.id === lastParentId);
  // ToDo の下には作れないので、親に戻さない
  if (!found || CHILD_LEVEL[found.level] === null) return null;
  return found;
}
