'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  CHILD_LEVEL,
  LEVEL_LABEL,
  STATUS_LABEL,
  STATUS_ORDER,
  buildTree,
  nextParentFor,
  parseItemInput,
  parseItemPatch,
  statusCounts,
  type ItemInput,
  type ItemLevel,
  type ItemPatch,
  type ItemStatus,
  type PlanItem,
  type TreeNode,
} from '../../lib/plan-items';

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1';
const inputClass = `p-2 border border-gray-500 rounded text-base text-gray-900 bg-white ${focusRing}`;

// 親の projectId がまだ分からない (項目が 0 件) ときの検査用の仮の値。onCreate に渡す値は useItems が差し替える
const PLACEHOLDER_PROJECT_ID = '00000000-0000-4000-8000-000000000000';

type Filter = ItemStatus | 'all';

/** 絞り込みで見せる項目の id。当てはまる項目と、その先祖 (字下げの文脈を保つため)。 */
function visibleIds(items: PlanItem[], filter: Filter): Set<string> {
  if (filter === 'all') return new Set(items.map((i) => i.id));
  const byId = new Map(items.map((i) => [i.id, i]));
  const out = new Set<string>();
  for (const item of items) {
    if (item.status !== filter) continue;
    let cur: PlanItem | undefined = item;
    while (cur && !out.has(cur.id)) {
      out.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  return out;
}

/** 木を上から順に並べる (表示の順・親の選択肢の順)。 */
function flatten(nodes: TreeNode[], out: TreeNode[] = []): TreeNode[] {
  for (const n of nodes) {
    out.push(n);
    flatten(n.children, out);
  }
  return out;
}

function subtreeIds(node: TreeNode, out = new Set<string>()): Set<string> {
  out.add(node.id);
  for (const c of node.children) subtreeIds(c, out);
  return out;
}

/**
 * プロジェクトの中の階層 (EXP-017)。KGI → KPI → KDI → ToDo を字下げで並べ、
 * 各行で状態 (6 つ)・期日を変え、「＋ 下に足す」で子の段を足し、「消す」→「本当に消す」で消す。
 * 追加欄の親の既定は nextParentFor (前に足した親 = 同じ階層)。
 */
export function PlanTree({ items, lastParentId, onCreate, onUpdate, onDelete, onLastParentChange }: {
  items: PlanItem[];
  lastParentId: string | null;
  onCreate(input: ItemInput): void;
  onUpdate(id: string, patch: ItemPatch): void;
  onDelete(id: string): void;
  onLastParentChange(id: string | null): void;
}) {
  const uid = useId();
  const [filter, setFilter] = useState<Filter>('all');
  // null = まだ自分で選んでいない (既定の親を使う)。'' = 一番上 (KGI)
  const [parentChoice, setParentChoice] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [invalid, setInvalid] = useState<string | null>(null);
  // 足した後のお知らせ (追加欄の role="status" で読み上げる)
  const [notice, setNotice] = useState<string | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  const deleteButtons = useRef(new Map<string, HTMLButtonElement>());
  const statusSelects = useRef(new Map<string, HTMLSelectElement>());
  const listHeading = useRef<HTMLHeadingElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);

  const tree = buildTree(items);
  const flat = flatten(tree);
  const byId = new Map(items.map((i) => [i.id, i]));
  const counts = statusCounts(items);
  const shown = visibleIds(items, filter);
  const shownCount = items.filter((i) => shown.has(i.id) && (filter === 'all' || i.status === filter)).length;
  const hasKgi = items.some((i) => i.level === 'kgi');

  const parentOptions = flat.filter((n) => CHILD_LEVEL[n.level] !== null);
  // KGI はプロジェクトに 1 つ (EXP-026): KGI があれば一番上には足せず、既定は KGI の下 (= KPI)
  const kgiItem = items.find((i) => i.level === 'kgi');
  const defaultParentId = nextParentFor(items, lastParentId)?.id ?? kgiItem?.id ?? '';
  const chosenStillExists =
    (parentChoice === '' && !hasKgi) || (parentChoice !== null && parentOptions.some((p) => p.id === parentChoice));
  const selectedParentId = parentChoice !== null && chosenStillExists ? parentChoice : defaultParentId;
  const selectedParent = selectedParentId ? byId.get(selectedParentId) ?? null : null;
  const derivedLevel: ItemLevel | null = selectedParent ? CHILD_LEVEL[selectedParent.level] : 'kgi';

  const openAddUnder = (parentId: string) => {
    setParentChoice(parentId);
    setInvalid(null);
    setNotice(null);
    titleInput.current?.focus();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!derivedLevel) {
      setInvalid('ToDo の下には足せません。別の親を選んでください。');
      return;
    }
    const parentId = selectedParent ? selectedParent.id : null;
    const projectId = items[0]?.projectId ?? '';
    const parsed = parseItemInput({
      projectId: projectId || PLACEHOLDER_PROJECT_ID,
      parentId,
      level: derivedLevel,
      title,
      target,
      dueDate,
      status: 'todo',
    });
    if (!parsed) {
      setInvalid('タイトルは1〜200字、目標値は200字まで、期日は正しい日付で入力してください。');
      return;
    }
    setInvalid(null);
    onCreate({ ...parsed, projectId });
    onLastParentChange(parentId);
    setNotice(`『${parsed.title}』を足しました`);
    setTitle('');
    setTarget('');
    setDueDate('');
    setParentChoice(null);
    titleInput.current?.focus();
  };

  /** 絞り込み中に状態を変えて行が消えるときは、次に見える行 (無ければ前・見出し) の状態の選択へフォーカスを移す。 */
  const changeStatus = (id: string, status: ItemStatus) => {
    if (filter !== 'all') {
      const after = visibleIds(items.map((it) => (it.id === id ? { ...it, status } : it)), filter);
      if (!after.has(id)) {
        const i = flat.findIndex((n) => n.id === id);
        const next = flat.slice(i + 1).find((n) => after.has(n.id))
          ?? [...flat.slice(0, Math.max(i, 0))].reverse().find((n) => after.has(n.id));
        const focusTo = next ? statusSelects.current.get(next.id) : null;
        if (focusTo) focusTo.focus();
        else listHeading.current?.focus();
      }
    }
    onUpdate(id, { status });
  };

  const cancelDelete = (id: string) => {
    setArmedId(null);
    deleteButtons.current.get(id)?.focus();
  };

  const confirmDelete = (id: string) => {
    setArmedId(null);
    // 消える項目 (子も消える) の後ろで最初に見えている行の「消す」へ。無ければ前、どちらも無ければ見出しへ
    const visibleFlat = flat.filter((n) => shown.has(n.id));
    const i = visibleFlat.findIndex((n) => n.id === id);
    const gone = i >= 0 ? subtreeIds(visibleFlat[i]) : new Set([id]);
    const after = visibleFlat.slice(i + 1).find((n) => !gone.has(n.id));
    const before = i > 0 ? [...visibleFlat.slice(0, i)].reverse().find((n) => !gone.has(n.id)) : undefined;
    const next = after ?? before;
    const focusTo = next ? deleteButtons.current.get(next.id) : null;
    if (focusTo) focusTo.focus();
    else listHeading.current?.focus();
    onDelete(id);
  };

  const changeDue = (id: string, value: string) => {
    const patch = parseItemPatch({ dueDate: value });
    if (patch) onUpdate(id, patch);
  };

  const renderNodes = (nodes: TreeNode[], depth: number) => {
    const visible = nodes.filter((n) => shown.has(n.id));
    if (visible.length === 0) return null;
    return (
      <ul className={depth === 0 ? 'flex flex-col gap-2' : 'flex flex-col gap-2 mt-2 pl-4 border-l-2 border-gray-300'}>
        {visible.map((n) => {
          const armed = armedId === n.id;
          const child = CHILD_LEVEL[n.level];
          const statusId = `${uid}-status-${n.id}`;
          const dueId = `${uid}-due-${n.id}`;
          return (
            <li
              key={n.id}
              onKeyDown={(e) => {
                if (armed && e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  cancelDelete(n.id);
                }
              }}
            >
              <div className="p-3 rounded-lg bg-white border border-gray-300 flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="shrink-0 text-xs px-2 py-0.5 rounded border border-gray-500 text-gray-800 font-bold">
                    {LEVEL_LABEL[n.level]}
                  </span>
                  <span className="text-gray-900 font-bold break-words">{n.title}</span>
                  {/* KGI は決まったら動かさない (EXP-024)。変えるのは KPI・KDI・ToDo */}
                  {n.level === 'kgi' && (
                    <span className="text-xs text-gray-700"><span aria-hidden="true">🔒 </span>KGI は固定</span>
                  )}
                </div>
                {n.target && <p className="text-sm text-gray-700 break-words">目標値: {n.target}</p>}
                <div className="flex flex-wrap items-end gap-3">
                  {n.level === 'kgi' ? (
                    <p className="text-sm text-gray-700">期日: {n.dueDate || '(なし)'}</p>
                  ) : (
                    <div className="flex flex-col gap-1 text-sm text-gray-700">
                      <label htmlFor={dueId}>期日</label>
                      <input
                        id={dueId}
                        aria-label={`『${n.title}』の期日`}
                        type="date"
                        value={n.dueDate}
                        onChange={(e) => changeDue(n.id, e.target.value)}
                        className={inputClass}
                      />
                    </div>
                  )}
                  <div className="flex flex-col gap-1 text-sm text-gray-700">
                    <label htmlFor={statusId}>状態</label>
                    <select
                      id={statusId}
                      aria-label={`『${n.title}』の状態`}
                      ref={(el) => {
                        if (el) statusSelects.current.set(n.id, el);
                        else statusSelects.current.delete(n.id);
                      }}
                      value={n.status}
                      onChange={(e) => changeStatus(n.id, e.target.value as ItemStatus)}
                      className={inputClass}
                    >
                      {STATUS_ORDER.map((s) => (
                        <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                      ))}
                    </select>
                  </div>
                  <div className="ml-auto flex flex-wrap justify-end gap-2">
                    {child && (
                      <button
                        type="button"
                        onClick={() => openAddUnder(n.id)}
                        aria-label={`下に足す: 『${n.title}』の下に ${LEVEL_LABEL[child]}`}
                        className={`text-xs px-2 py-1 rounded border border-gray-500 text-gray-900 hover:bg-gray-50 ${focusRing}`}
                      >
                        <span aria-hidden="true">＋ </span>下に足す
                      </button>
                    )}
                    {armed && (
                      <button
                        type="button"
                        onClick={() => cancelDelete(n.id)}
                        aria-label={`やめる: 『${n.title}』を消さない`}
                        className={`text-xs px-2 py-1 rounded border border-gray-500 text-gray-800 hover:bg-gray-50 ${focusRing}`}
                      >
                        やめる
                      </button>
                    )}
                    {n.level !== 'kgi' && (
                    <button
                      type="button"
                      ref={(el) => {
                        if (el) deleteButtons.current.set(n.id, el);
                        else deleteButtons.current.delete(n.id);
                      }}
                      onClick={() => (armed ? confirmDelete(n.id) : setArmedId(n.id))}
                      aria-label={armed ? `『${n.title}』を本当に消す` : `『${n.title}』を消す`}
                      className={`text-xs px-2 py-1 rounded border ${focusRing} ${armed ? 'bg-red-700 border-red-700 text-white font-bold hover:bg-red-800' : 'border-red-700 text-red-700 hover:bg-red-50'}`}
                    >
                      {armed ? '本当に消す' : '消す'}
                    </button>
                    )}
                  </div>
                </div>
              </div>
              {renderNodes(n.children, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  };

  const headingId = `${uid}-tree-title`;
  const formTitleId = `${uid}-form-title`;
  const errorId = `${uid}-form-error`;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          ref={listHeading}
          id={headingId}
          tabIndex={-1}
          className="text-sm font-bold text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          階層 ({items.length})
        </h3>
        {!hasKgi && (
          <button
            type="button"
            onClick={() => openAddUnder('')}
            className={`text-sm px-3 py-1.5 rounded border border-blue-700 text-blue-700 font-bold hover:bg-blue-50 ${focusRing}`}
          >
            ＋ KGI を作る
          </button>
        )}
      </div>

      <div role="group" aria-label="状態で絞り込む" className="flex flex-wrap gap-2">
        {(['all', ...STATUS_ORDER] as Filter[]).map((f) => {
          const pressed = filter === f;
          const label = f === 'all' ? 'すべて' : STATUS_LABEL[f];
          const count = f === 'all' ? items.length : counts[f];
          return (
            <button
              key={f}
              type="button"
              aria-pressed={pressed}
              onClick={() => setFilter(f)}
              className={`text-xs px-2 py-1 rounded border ${focusRing} ${pressed ? 'bg-gray-900 border-gray-900 text-white font-bold' : 'border-gray-500 text-gray-800 hover:bg-gray-50'}`}
            >
              {label} ({count})
            </button>
          );
        })}
      </div>

      <div role="status" className="sr-only">
        {armedId
          ? 'もう一度押すと消えます (下の段も消えます)'
          : filter === 'all'
            ? `すべて: ${items.length} 件`
            : `${STATUS_LABEL[filter]}: ${shownCount} 件`}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-gray-700">まだ階層がありません。KGI (ゴール) から作りましょう。</p>
      ) : shown.size === 0 ? (
        <p className="text-sm text-gray-700">この状態の項目はありません。</p>
      ) : (
        renderNodes(tree, 0)
      )}

      <form
        onSubmit={submit}
        aria-labelledby={formTitleId}
        className="flex flex-col gap-3 p-3 rounded-lg bg-white border border-gray-300"
      >
        <h4 id={formTitleId} className="text-sm font-bold text-gray-900">
          足す{derivedLevel ? ` (${LEVEL_LABEL[derivedLevel]})` : ''}
        </h4>

        <label className="flex flex-col gap-1 text-sm text-gray-700">
          どこに足すか
          <select
            value={selectedParentId}
            onChange={(e) => {
              setParentChoice(e.target.value);
              setInvalid(null);
            }}
            className={inputClass}
          >
            {!hasKgi && <option value="">(一番上: KGI)</option>}
            {parentOptions.map((p) => (
              <option key={p.id} value={p.id}>{`${LEVEL_LABEL[p.level]}: ${p.title}`}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-gray-700">
          タイトル
          <input
            ref={titleInput}
            type="text"
            name="item-title"
            required
            aria-invalid={invalid ? true : undefined}
            aria-describedby={invalid ? errorId : undefined}
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-gray-700">
          目標値
          <input
            type="text"
            name="item-target"
            maxLength={200}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-gray-700">
          期日
          <input
            type="date"
            name="item-due"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className={inputClass}
          />
        </label>

        <div role="status" id={errorId} className={`text-sm ${invalid ? 'text-red-700' : 'text-gray-800'}`}>
          {invalid ?? notice}
        </div>

        <button
          type="submit"
          className={`self-end px-5 py-2 rounded bg-blue-600 text-white font-bold hover:bg-blue-700 ${focusRing}`}
        >
          足す
        </button>
      </form>
    </section>
  );
}

// --- 画面側の状態と API 呼び出し ---

const DB_NOT_CONFIGURED = 'データベースが未設定です';

function problemMessage(status: number, failed: string): string {
  if (status === 503) return DB_NOT_CONFIGURED;
  // KGI の固定 (EXP-024): サーバが 409 で断ったとき
  if (status === 409) return 'KGI は決まったら変えません。変えるのは KPI・KDI・ToDo です';
  return `${failed} (${status})`;
}

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  const body: unknown = await res.json().catch(() => null);
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
}

function lastParentKey(projectId: string): string {
  return `ai-planner:lastParent:${projectId}`;
}

function readLastParent(projectId: string): string | null {
  try {
    return window.localStorage.getItem(lastParentKey(projectId));
  } catch {
    return null;
  }
}

function writeLastParent(projectId: string, id: string | null): void {
  try {
    if (id) window.localStorage.setItem(lastParentKey(projectId), id);
    else window.localStorage.removeItem(lastParentKey(projectId));
  } catch {
    // 保存できない端末 (private mode 等) では覚えないだけ
  }
}

type ItemsResult = { ok: true; items: PlanItem[] } | { ok: false; problem: string };

async function requestItems(projectId: string): Promise<ItemsResult> {
  try {
    const res = await fetch(`/api/items?projectId=${encodeURIComponent(projectId)}`);
    if (!res.ok) return { ok: false, problem: problemMessage(res.status, '階層を読み込めませんでした') };
    const body = await readJson(res);
    return { ok: true, items: Array.isArray(body?.items) ? (body.items as PlanItem[]) : [] };
  } catch {
    return { ok: false, problem: '階層を読み込めませんでした' };
  }
}

/**
 * プロジェクトの階層の状態。projectId が変わったら読み込み、書いた後は読み直す。
 * lastParentId (前に足した親) はプロジェクトごとに localStorage へ覚える。
 */
export function useItems(projectId: string | null): {
  items: PlanItem[];
  loading: boolean;
  problem: string | null;
  lastParentId: string | null;
  create(input: ItemInput): Promise<void>;
  update(id: string, patch: ItemPatch): Promise<void>;
  remove(id: string): Promise<void>;
  setLastParentId(id: string | null): void;
  refresh(): Promise<void>;
} {
  // どのプロジェクトの値かを一緒に持つ (切り替え直後に前のプロジェクトの値を見せない)
  const [data, setData] = useState<{ projectId: string; items: PlanItem[] } | null>(null);
  const [last, setLast] = useState<{ projectId: string; id: string | null } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const currentId = useRef<string | null>(projectId);

  const apply = useCallback((pid: string, r: ItemsResult) => {
    if (currentId.current !== pid) return;
    if (r.ok) {
      setData({ projectId: pid, items: r.items });
      setProblem(null);
    } else {
      setData((prev) => (prev?.projectId === pid ? prev : { projectId: pid, items: [] }));
      setProblem(r.problem);
    }
    setLast((prev) => (prev?.projectId === pid ? prev : { projectId: pid, id: readLastParent(pid) }));
  }, []);

  const reload = useCallback(async (pid: string) => {
    apply(pid, await requestItems(pid));
  }, [apply]);

  useEffect(() => {
    currentId.current = projectId;
    if (!projectId) return;
    let cancelled = false;
    void requestItems(projectId).then((r) => {
      if (!cancelled) apply(projectId, r);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, apply]);

  const create = useCallback(async (input: ItemInput) => {
    const pid = currentId.current ?? input.projectId;
    if (!pid) return;
    try {
      const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, projectId: pid }),
      });
      if (!res.ok) {
        setProblem(problemMessage(res.status, '項目を足せませんでした'));
        return;
      }
      await reload(pid);
    } catch {
      setProblem('項目を足せませんでした');
    }
  }, [reload]);

  const update = useCallback(async (id: string, patch: ItemPatch) => {
    try {
      const res = await fetch(`/api/items/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        setProblem(problemMessage(res.status, '項目を変えられませんでした'));
        return;
      }
      if (currentId.current) await reload(currentId.current);
    } catch {
      setProblem('項目を変えられませんでした');
    }
  }, [reload]);

  const remove = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) {
        setProblem(problemMessage(res.status, '項目を消せませんでした'));
        return;
      }
      if (currentId.current) await reload(currentId.current);
    } catch {
      setProblem('項目を消せませんでした');
    }
  }, [reload]);

  const setLastParentId = useCallback((id: string | null) => {
    const pid = currentId.current;
    if (!pid) return;
    writeLastParent(pid, id);
    setLast({ projectId: pid, id });
  }, []);

  // 外 (AI の会話) で項目が足されたときに読み直す (EXP-019)
  const refresh = useCallback(async () => {
    if (currentId.current) await reload(currentId.current);
  }, [reload]);

  const items = projectId && data?.projectId === projectId ? data.items : [];
  const loading = projectId !== null && data?.projectId !== projectId;
  const lastParentId = projectId && last?.projectId === projectId ? last.id : null;

  return { items, loading, problem, lastParentId, create, update, remove, setLastParentId, refresh };
}
