// --- KPI と KDI を AI と話しながら変える (EXP-038) ---
// KGI は固定のまま。AI には番号 (K1・D1…) で渡し、同意した変更だけをその項目に入れる。純粋な関数だけ。

import { neutralize } from "./coach-context";
import type { PlanItem } from "./plan-items";

export type ItemRef = { ref: string; item: PlanItem };
export type ItemChange = { ref: string; item: PlanItem; patch: { title?: string; target?: string; dueDate?: string } };

const TITLE_MAX = 200;
const TARGET_MAX = 200;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CONTROL_RE = /\p{Cc}/u;
const len = (s: string) => [...s].length;

function isRealDate(s: string): boolean {
  const m = YMD_RE.exec(s);
  if (!m) return false;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return t.getUTCFullYear() === Number(m[1]) && t.getUTCMonth() === Number(m[2]) - 1 && t.getUTCDate() === Number(m[3]);
}

const byCreated = (a: PlanItem, b: PlanItem) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1);

/** KGI の下の KPI を K1・K2…、その下の KDI を D1・D2…と古い順に番号づける。 */
export function itemRefs(items: PlanItem[]): ItemRef[] {
  const kgi = items.find((i) => i.level === "kgi");
  if (!kgi) return [];
  const kpis = items.filter((i) => i.level === "kpi" && i.parentId === kgi.id).sort(byCreated);
  const kpiIds = new Set(kpis.map((k) => k.id));
  const kdis = items.filter((i) => i.level === "kdi" && i.parentId !== null && kpiIds.has(i.parentId)).sort(byCreated);
  return [...kpis.map((item, i) => ({ ref: `K${i + 1}`, item })), ...kdis.map((item, i) => ({ ref: `D${i + 1}`, item }))];
}

/** AI に渡す番号の一覧。 */
export function itemRefsText(refs: ItemRef[]): string {
  if (refs.length === 0) return "(まだ無し)";
  return refs
    .map(({ ref, item }) => {
      const t = neutralize([...item.title].slice(0, 60).join(""));
      const crit = item.target ? ` / 判定基準 ${neutralize([...item.target].slice(0, 60).join(""))}` : "";
      return `- ${ref}: ${item.level === "kpi" ? "KPI" : "KDI"}『${t}』${crit}${item.dueDate ? ` / 期日 ${item.dueDate}` : ""}`;
    })
    .join("\n");
}

/** AI の itemChange を検査する。知らない番号・変える欄が無い・規則外 → null。期日は KGI の期限以下。 */
export function parseItemChange(x: unknown, refs: ItemRef[], kgiDue: string): ItemChange | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  const ref = typeof r.ref === "string" ? r.ref.trim().toUpperCase() : null;
  if (!ref) return null;
  const found = refs.find((f) => f.ref === ref);
  if (!found) return null;
  const patch: ItemChange["patch"] = {};
  if (r.title !== undefined) {
    if (typeof r.title !== "string") return null;
    const t = r.title.trim();
    if (len(t) < 1 || len(t) > TITLE_MAX || CONTROL_RE.test(t)) return null;
    if (t !== found.item.title) patch.title = t;
  }
  if (r.target !== undefined) {
    if (typeof r.target !== "string") return null;
    const t = r.target.trim();
    if (len(t) > TARGET_MAX || CONTROL_RE.test(t)) return null;
    if (t !== found.item.target) patch.target = t;
  }
  if (r.dueDate !== undefined) {
    if (typeof r.dueDate !== "string") return null;
    const d = r.dueDate.trim();
    if (d !== "" && (!isRealDate(d) || (kgiDue && d > kgiDue))) return null;
    if (d !== found.item.dueDate) patch.dueDate = d;
  }
  if (Object.keys(patch).length === 0) return null;
  return { ref: found.ref, item: found.item, patch };
}

/** 画面のお知らせ: 「KPI『模試 700』を変えました (判定基準: 650 点)」。 */
export function itemChangedNotice(x: unknown): string | null {
  if (typeof x !== "object" || x === null) return null;
  const r = x as Record<string, unknown>;
  if ((r.level !== "kpi" && r.level !== "kdi") || typeof r.after !== "object" || r.after === null) return null;
  const a = r.after as Record<string, unknown>;
  if (typeof a.title !== "string") return null;
  const label = r.level === "kpi" ? "KPI" : "KDI";
  const parts = [typeof a.target === "string" && a.target ? `判定基準: ${a.target}` : "", typeof a.dueDate === "string" && a.dueDate ? `期日: ${a.dueDate}` : ""].filter(Boolean);
  return `${label}『${a.title}』を変えました${parts.length ? ` (${parts.join("・")})` : ""}`;
}
