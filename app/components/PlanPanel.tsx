'use client';

import { useEffect, useRef, useState } from 'react';
import {
  EMPTY_PLAN,
  PLAN_FIELDS,
  PLAN_FIELD_LABEL,
  nextField,
  openingMessage,
  planToEvents,
  type Kdi,
  type Kpi,
  type PlanDraft,
  type PlanField,
} from '../../lib/pdca-plan';
import type { Project } from '../../lib/projects';
import { quotaNotice } from '../../lib/quota';
import { MessageContent } from './MessageContent';

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1';
const inputClass = `p-2 border border-gray-500 rounded text-base text-gray-900 bg-white ${focusRing}`;
const KPI_MAX = 3;
const KDI_MAX = 5;
const DB_NOT_CONFIGURED = 'データベースが未設定です';

type ChatMessage = { role: 'user' | 'assistant'; content: string };
type Cycle = { id: string; plan: PlanDraft; phase?: string };

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  const body: unknown = await res.json().catch(() => null);
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
}

function asPlan(x: unknown, fallback: PlanDraft): PlanDraft {
  if (typeof x !== 'object' || x === null) return fallback;
  const p = x as Partial<PlanDraft>;
  return {
    purpose: typeof p.purpose === 'string' ? p.purpose : '',
    kgi: typeof p.kgi === 'string' ? p.kgi : '',
    kpis: Array.isArray(p.kpis) ? p.kpis : [],
    kdis: Array.isArray(p.kdis) ? p.kdis : [],
    criteria: typeof p.criteria === 'string' ? p.criteria : '',
    deliverable: typeof p.deliverable === 'string' ? p.deliverable : '',
  };
}

function asCycle(x: unknown): Cycle | null {
  if (typeof x !== 'object' || x === null) return null;
  const c = x as Record<string, unknown>;
  if (typeof c.id !== 'string') return null;
  return { id: c.id, plan: asPlan(c.plan, EMPTY_PLAN), phase: typeof c.phase === 'string' ? c.phase : undefined };
}

/**
 * AI が誘導して Plan を決める画面 (EXP-009)。
 * 最初の一言は画面で作る (API を呼ばない)。答えるたびに /api/plan/chat が Plan を返し、欄を直接直すこともできる。
 */
export function PlanPanel({ project, initialPlan, cycleId: initialCycleId, onSaved }: {
  project: Project;
  initialPlan: PlanDraft;
  cycleId: string | null;
  onSaved?(cycleId: string): void;
}) {
  const [plan, setPlan] = useState<PlanDraft>(initialPlan);
  const [cycleId, setCycleId] = useState<string | null>(initialCycleId);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    { role: 'assistant', content: openingMessage(project, initialPlan) },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  // 上限 (429) のお知らせ・保存や登録の結果 (role="status")
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ＋で足した行の最初の入力欄へ移す (足した直後の描画の後で focus する)
  const focusAfterAdd = useRef<string | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [messages]);

  useEffect(() => {
    if (!focusAfterAdd.current) return;
    document.getElementById(focusAfterAdd.current)?.focus();
    focusAfterAdd.current = null;
  }, [plan.kpis.length, plan.kdis.length]);

  const next = nextField(plan);
  const events = planToEvents(plan, cycleId ?? 'unsaved');

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    const history = messages.slice(1);
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setInput('');
    setSending(true);
    setNotice(null);
    setChatError(null);
    try {
      const res = await fetch('/api/plan/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: { name: project.name, category: project.category, purpose: project.purpose },
          plan,
          history,
          message: text,
        }),
      });
      if (res.status === 429) {
        const body: unknown = await res.json().catch(() => null);
        setNotice(quotaNotice(res.status, body));
        setMessages((prev) => prev.slice(0, -1));
        setInput(text);
        return;
      }
      if (!res.ok) {
        setChatError(`返事を受け取れませんでした (${res.status})`);
        return;
      }
      const body = await readJson(res);
      const reply = typeof body?.reply === 'string' ? body.reply : '';
      if (reply) setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
      if (body?.plan) setPlan((prev) => asPlan(body.plan, prev));
    } catch {
      setChatError('返事を受け取れませんでした');
    } finally {
      setSending(false);
    }
  };

  /** 保存して cycle の id を返す (失敗は null・お知らせは status に出す)。 */
  const save = async (announce: boolean): Promise<string | null> => {
    try {
      const res = await fetch('/api/cycles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, cycleId, plan, phase: 'plan' }),
      });
      if (!res.ok) {
        setStatus(res.status === 503 ? DB_NOT_CONFIGURED : `Plan を保存できませんでした (${res.status})`);
        return null;
      }
      const cycle = asCycle((await readJson(res))?.cycle);
      if (!cycle) {
        setStatus('Plan を保存できませんでした');
        return null;
      }
      setCycleId(cycle.id);
      if (announce) setStatus('Plan を保存しました');
      onSaved?.(cycle.id);
      return cycle.id;
    } catch {
      setStatus('Plan を保存できませんでした');
      return null;
    }
  };

  const onSave = async () => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    await save(true);
    setBusy(false);
  };

  const onRegister = async () => {
    if (busy || events.length === 0) return;
    setBusy(true);
    setStatus(null);
    try {
      const id = cycleId ?? (await save(false));
      if (!id) return;
      const res = await fetch('/api/calendar/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: planToEvents(plan, id), source: 'plan_form' }),
      });
      const body = await readJson(res);
      if (!res.ok) {
        setStatus(`カレンダーに登録できませんでした (${res.status})`);
        return;
      }
      setStatus(typeof body?.message === 'string' ? body.message : 'カレンダーに登録しました');
    } catch {
      setStatus('カレンダーに登録できませんでした');
    } finally {
      setBusy(false);
    }
  };

  const setText = (field: 'purpose' | 'kgi' | 'criteria' | 'deliverable', value: string) =>
    setPlan((prev) => ({ ...prev, [field]: value }));
  const setKpi = (i: number, patch: Partial<Kpi>) =>
    setPlan((prev) => ({ ...prev, kpis: prev.kpis.map((k, j) => (j === i ? { ...k, ...patch } : k)) }));
  const setKdi = (i: number, patch: Partial<Kdi>) =>
    setPlan((prev) => ({ ...prev, kdis: prev.kdis.map((k, j) => (j === i ? { ...k, ...patch } : k)) }));

  const rowId = (kind: 'kpi' | 'kdi', i: number) => `plan-${project.id}-${kind}-${i}`;
  const addKpi = () => {
    if (plan.kpis.length >= KPI_MAX) return;
    focusAfterAdd.current = rowId('kpi', plan.kpis.length);
    setPlan((prev) => ({ ...prev, kpis: [...prev.kpis, { name: '', target: '' }] }));
  };
  const addKdi = () => {
    if (plan.kdis.length >= KDI_MAX) return;
    focusAfterAdd.current = rowId('kdi', plan.kdis.length);
    setPlan((prev) => ({ ...prev, kdis: [...prev.kdis, { action: '', date: '', start: '', end: '' }] }));
  };
  const hintClass = 'text-xs text-gray-700';

  const groupClass = (field: PlanField) =>
    `flex flex-col gap-1 p-2 rounded-lg border ${next === field ? 'border-blue-600 bg-blue-50' : 'border-transparent'}`;
  const marker = (field: PlanField) =>
    next === field ? <span className="text-xs font-bold text-blue-800"><span aria-hidden="true">← </span>次に決める</span> : null;

  const renderField = (field: PlanField) => {
    const label = PLAN_FIELD_LABEL[field];
    const id = `plan-${project.id}-${field}`;
    if (field === 'kpis') {
      return (
        <fieldset key={field} className={groupClass(field)} aria-current={next === field ? 'step' : undefined}>
          <legend className="text-sm font-bold text-gray-900">{label} {marker(field)}</legend>
          {plan.kpis.map((k, i) => (
            <div key={i} className="flex flex-wrap gap-2">
              <input id={rowId('kpi', i)} aria-label={`${label} ${i + 1} の名前`} className={`${inputClass} flex-1 min-w-0`} value={k.name}
                maxLength={500} onChange={(e) => setKpi(i, { name: e.target.value })} />
              <input aria-label={`${label} ${i + 1} の目標値`} className={`${inputClass} w-24 max-w-full`} value={k.target}
                maxLength={500} onChange={(e) => setKpi(i, { target: e.target.value })} />
            </div>
          ))}
          <button type="button" disabled={plan.kpis.length >= KPI_MAX} onClick={addKpi}
            aria-describedby={`plan-${project.id}-kpi-hint`}
            className={`self-start text-sm px-2 py-1 rounded border border-gray-500 bg-white text-gray-900 hover:bg-gray-50 disabled:opacity-50 ${focusRing}`}>
            ＋指標を足す
          </button>
          <p id={`plan-${project.id}-kpi-hint`} className={hintClass}>KPI は {KPI_MAX} 件まで</p>
        </fieldset>
      );
    }
    if (field === 'kdis') {
      return (
        <fieldset key={field} className={groupClass(field)} aria-current={next === field ? 'step' : undefined}>
          <legend className="text-sm font-bold text-gray-900">{label} {marker(field)}</legend>
          {plan.kdis.map((k, i) => (
            <div key={i} className="flex flex-col gap-1 p-2 rounded border border-gray-300 bg-white">
              <input id={rowId('kdi', i)} aria-label={`${label} ${i + 1} の内容`} className={inputClass} value={k.action}
                maxLength={500} onChange={(e) => setKdi(i, { action: e.target.value })} />
              <div className="flex flex-wrap gap-1">
                <input type="date" aria-label={`${label} ${i + 1} の日付`} className={`${inputClass} flex-1 min-w-0`}
                  value={k.date} onChange={(e) => setKdi(i, { date: e.target.value })} />
                <input type="time" aria-label={`${label} ${i + 1} の開始`} className={`${inputClass} w-24`}
                  value={k.start} onChange={(e) => setKdi(i, { start: e.target.value })} />
                <input type="time" aria-label={`${label} ${i + 1} の終了`} className={`${inputClass} w-24`}
                  value={k.end} onChange={(e) => setKdi(i, { end: e.target.value })} />
              </div>
            </div>
          ))}
          <button type="button" disabled={plan.kdis.length >= KDI_MAX} onClick={addKdi}
            aria-describedby={`plan-${project.id}-kdi-hint`}
            className={`self-start text-sm px-2 py-1 rounded border border-gray-500 bg-white text-gray-900 hover:bg-gray-50 disabled:opacity-50 ${focusRing}`}>
            ＋行動を足す
          </button>
          <p id={`plan-${project.id}-kdi-hint`} className={hintClass}>行動は {KDI_MAX} 件まで</p>
        </fieldset>
      );
    }
    return (
      <div key={field} className={groupClass(field)} aria-current={next === field ? 'step' : undefined}>
        <label htmlFor={id} className="text-sm font-bold text-gray-900">{label} {marker(field)}</label>
        <textarea id={id} rows={2} maxLength={500} className={inputClass} value={plan[field]}
          onChange={(e) => setText(field, e.target.value)} />
      </div>
    );
  };

  return (
    <section aria-labelledby={`plan-title-${project.id}`} className="flex flex-col gap-4">
      <h2 id={`plan-title-${project.id}`} className="text-lg font-bold text-blue-700">
        <span aria-hidden="true">📝</span> {project.name} の Plan
      </h2>

      <div className="flex flex-col gap-2 p-3 rounded-lg bg-white border border-gray-300">
        <div className={`max-h-72 overflow-y-auto flex flex-col gap-2 rounded ${focusRing}`} role="log" aria-label="Plan の会話" tabIndex={0}>
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[90%] p-2 rounded-lg text-sm ${m.role === 'user' ? 'bg-blue-600 text-white whitespace-pre-wrap' : 'bg-gray-100 text-gray-900'}`}>
                {m.role === 'assistant' ? <MessageContent text={m.content} /> : m.content}
              </div>
            </div>
          ))}
          {sending && <p className="text-sm text-gray-700">考え中...</p>}
          <div ref={chatEndRef} />
        </div>
        <div role="status" className={`text-sm ${notice ? 'p-2 rounded bg-amber-50 border border-amber-300 text-amber-900' : ''}`}>
          {notice}
        </div>
        <div role="alert" className="text-sm text-red-700">{chatError}</div>
        <form onSubmit={send} className="flex gap-2">
          <label htmlFor={`plan-chat-${project.id}`} className="sr-only">Plan について話す</label>
          {/* 送信中も disabled にしない (focus が body へ落ちるため)。readOnly にして send 側で無視する */}
          <input id={`plan-chat-${project.id}`} type="text" autoComplete="off" value={input}
            onChange={(e) => setInput(e.target.value)} readOnly={sending} aria-busy={sending || undefined}
            placeholder="Plan について話す" className={`${inputClass} flex-1 min-w-0`} />
          <button type="submit" aria-disabled={sending || !input.trim() ? 'true' : undefined}
            className={`px-4 rounded bg-blue-600 text-white font-bold hover:bg-blue-700 aria-disabled:opacity-50 ${focusRing}`}>
            送信
          </button>
        </form>
      </div>

      <div className="flex flex-col gap-2">
        {PLAN_FIELDS.map(renderField)}
      </div>

      <div className="flex flex-wrap gap-2">
        {/* 処理中は disabled にせず aria-disabled にする (focus を保つ)。押しても handler 側で無視する */}
        <button type="button" onClick={() => void onSave()} aria-disabled={busy ? 'true' : undefined}
          className={`px-5 py-2 rounded bg-blue-600 text-white font-bold hover:bg-blue-700 aria-disabled:opacity-50 ${focusRing}`}>
          保存
        </button>
        <button type="button" onClick={() => void onRegister()} disabled={events.length === 0}
          aria-disabled={busy ? 'true' : undefined} aria-describedby={`plan-${project.id}-register-hint`}
          className={`px-3 py-2 rounded border border-green-700 bg-white text-green-800 font-bold hover:bg-green-50 disabled:opacity-50 aria-disabled:opacity-50 ${focusRing}`}>
          <span aria-hidden="true">📅</span> 行動をカレンダーに登録
        </button>
      </div>
      <p id={`plan-${project.id}-register-hint`} className="text-xs text-gray-700">
        日付・開始・終了がそろった行動があると登録できます
      </p>
      <div role="status" className="text-sm text-gray-800">{status}</div>
    </section>
  );
}

/** 選んだプロジェクトの最新の cycle を 1 回読み、PlanPanel を出す (EXP-009)。page.tsx で key={project.id} を付ける。 */
export function ProjectPlanTab({ project, onSaved }: { project: Project; onSaved?(cycleId: string): void }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'ready'; cycle: Cycle | null } | { status: 'error'; message: string }>(
    { status: 'loading' },
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/cycles?projectId=${encodeURIComponent(project.id)}`);
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: 'error', message: res.status === 503 ? DB_NOT_CONFIGURED : `Plan を読み込めませんでした (${res.status})` });
          return;
        }
        const body = await readJson(res);
        if (!cancelled) setState({ status: 'ready', cycle: asCycle(body?.cycle) });
      } catch {
        if (!cancelled) setState({ status: 'error', message: 'Plan を読み込めませんでした' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  // 読み込みの状態の知らせは 1 つの常設の role="status" の中身だけを入れ替える
  const message = state.status === 'loading' ? 'Plan を読み込んでいます...' : state.status === 'error' ? state.message : '';
  const tone = state.status === 'error' ? 'p-3 rounded-lg bg-amber-50 border border-amber-300 text-amber-900' : 'text-gray-700';
  return (
    <div className="flex flex-col gap-2">
      <div role="status" className={`text-sm ${message ? tone : ''}`}>{message}</div>
      {state.status === 'ready' && (
        <PlanPanel
          project={project}
          initialPlan={state.cycle?.plan ?? EMPTY_PLAN}
          cycleId={state.cycle?.id ?? null}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
