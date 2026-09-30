'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
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
import type { StoredMessage, Thread } from '../../lib/messages';
import type { Project } from '../../lib/projects';
import { quotaNotice } from '../../lib/quota';
import { MessageContent } from './MessageContent';

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1';
const inputClass = `p-2 border border-gray-500 rounded text-base text-gray-900 bg-white ${focusRing}`;
const KPI_MAX = 3;
const KDI_MAX = 5;
const DB_NOT_CONFIGURED = 'データベースが未設定です';

// 自動保存 (EXP-010): 欄が変わってから 1 秒後に保存する
const AUTOSAVE_MS = 1000;
const SAVING = '保存中…';
const SAVED = '保存済み';
const SAVE_FAILED = '保存できませんでした';
const MESSAGES_SAVE_FAILED = '会話を保存できませんでした';
// チャットの壁打ちを Plan に反映 (EXP-010)
const REFLECT_MESSAGE = 'ここまでの壁打ちの内容から、Plan の欄を埋めてください。';
const REFLECT_HISTORY = 20;
const NO_CHAT = 'チャットの会話がまだありません';
const REFLECTED = 'Plan の欄に反映しました';
// /api/plan/chat の受け付ける上限 (超えると 400 になるため、送る前に合わせる)
const PLAN_CHAT_HISTORY_MAX = 50;
const PLAN_CHAT_CONTENT_MAX = 2000;

type ChatMessage = { role: 'user' | 'assistant'; content: string };
type Cycle = { id: string; plan: PlanDraft; phase?: string };

/** /api/plan/chat へ送る history の形にそろえる (件数と字数を route の上限に合わせる)。 */
function toHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .slice(-PLAN_CHAT_HISTORY_MAX)
    .map((m) => ({ role: m.role, content: [...m.content].slice(0, PLAN_CHAT_CONTENT_MAX).join('') }));
}

function asStoredMessages(x: unknown): StoredMessage[] {
  if (!Array.isArray(x)) return [];
  return x.filter((m): m is StoredMessage => {
    if (typeof m !== 'object' || m === null) return false;
    const r = m as Record<string, unknown>;
    return (r.role === 'user' || r.role === 'assistant') && typeof r.content === 'string';
  });
}

async function fetchThread(projectId: string, thread: Thread): Promise<{ ok: true; messages: StoredMessage[] } | { ok: false; status: number }> {
  const res = await fetch(`/api/messages?projectId=${encodeURIComponent(projectId)}&thread=${thread}`);
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, messages: asStoredMessages((await readJson(res))?.messages) };
}

/** 会話を保存する。空の発言は送らない。成功なら true。 */
async function postThread(projectId: string, thread: Thread, messages: ChatMessage[]): Promise<boolean> {
  const items = messages.filter((m) => m.content.trim() !== '');
  if (items.length === 0) return true;
  try {
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, thread, messages: items }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

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
export function PlanPanel({ project, initialPlan, cycleId: initialCycleId, onSaved, initialMessages }: {
  project: Project;
  initialPlan: PlanDraft;
  cycleId: string | null;
  onSaved?(cycleId: string): void;
  /** 保存されている thread plan の会話 (EXP-010)。あれば最初の一言の代わりに続きを出す。 */
  initialMessages?: StoredMessage[];
}) {
  const [plan, setPlan] = useState<PlanDraft>(initialPlan);
  const [cycleId, setCycleId] = useState<string | null>(initialCycleId);
  // 最初の一言は画面で作ったもの (保存しない・history にも入れない)
  const [hasOpening] = useState(() => !initialMessages || initialMessages.length === 0);
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    initialMessages && initialMessages.length > 0
      ? initialMessages.map((m) => ({ role: m.role, content: m.content }))
      : [{ role: 'assistant', content: openingMessage(project, initialPlan) }],
  );
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  // 保存中は見た目だけで示す (live region に入れない)・反映ボタンの表示名の切り替え
  const [saving, setSaving] = useState(false);
  const [reflecting, setReflecting] = useState(false);
  // 読み込んだ会話の件数 (この後ろに「ここから続き」を出す)
  const [loadedCount] = useState(() => initialMessages?.length ?? 0);
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

  // 保存の直列化: 実行中の保存があれば最新の Plan だけを待たせる (重ねて PUT しない)
  const cycleIdRef = useRef<string | null>(initialCycleId);
  const lastSavedRef = useRef<string>(JSON.stringify(initialPlan));
  const inFlightRef = useRef<Promise<string | null> | null>(null);
  const queuedRef = useRef<PlanDraft | null>(null);

  /** 1 回 PUT する。cycle の id を返す (失敗は null・状態は status に出す)。 */
  // 読み上げは失敗と、状態が変わった後の最初の「保存済み」だけ (自動保存のたびに読まない)
  const saveStateRef = useRef<'none' | 'saved' | 'failed'>('none');
  const failSave = (message: string) => {
    saveStateRef.current = 'failed';
    setStatus(message);
  };
  const putCycle = async (p: PlanDraft): Promise<string | null> => {
    setSaving(true);
    try {
      const res = await fetch('/api/cycles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, cycleId: cycleIdRef.current, plan: p, phase: 'plan' }),
      });
      if (!res.ok) {
        failSave(res.status === 503 ? DB_NOT_CONFIGURED : `${SAVE_FAILED} (${res.status})`);
        return null;
      }
      const cycle = asCycle((await readJson(res))?.cycle);
      if (!cycle) {
        failSave(SAVE_FAILED);
        return null;
      }
      cycleIdRef.current = cycle.id;
      lastSavedRef.current = JSON.stringify(p);
      setCycleId(cycle.id);
      if (saveStateRef.current !== 'saved') setStatus(SAVED);
      saveStateRef.current = 'saved';
      onSaved?.(cycle.id);
      return cycle.id;
    } catch {
      failSave(SAVE_FAILED);
      return null;
    } finally {
      setSaving(false);
    }
  };

  /** 保存する。実行中なら最新の Plan を待たせ、待ちが全部終わった時点の結果を返す。 */
  const persist = (p: PlanDraft): Promise<string | null> => {
    if (inFlightRef.current) {
      queuedRef.current = p;
      return inFlightRef.current;
    }
    const run = (async () => {
      let result = await putCycle(p);
      while (queuedRef.current) {
        const q = queuedRef.current;
        queuedRef.current = null;
        result = await putCycle(q);
      }
      inFlightRef.current = null;
      return result;
    })();
    inFlightRef.current = run;
    return run;
  };

  // 欄が変わったら (本人の入力・AI の反映) 1 秒待って自動で保存する
  useEffect(() => {
    if (JSON.stringify(plan) === lastSavedRef.current) return;
    const timer = setTimeout(() => {
      if (JSON.stringify(plan) !== lastSavedRef.current) void persist(plan);
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // persist は ref だけを使うので plan の変化だけで張り直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  /** 1 往復を thread plan に保存する (待たない・失敗は status に出す)。 */
  const saveExchange = (pair: ChatMessage[]) => {
    // Plan の保存の status と分ける (次の自動保存で上書きされないように会話側の alert に出す)
    void postThread(project.id, 'plan', pair).then((ok) => {
      if (!ok) setChatError(MESSAGES_SAVE_FAILED);
    });
  };

  const next = nextField(plan);
  const events = planToEvents(plan, cycleId ?? 'unsaved');

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    const history = toHistory(hasOpening ? messages.slice(1) : messages);
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
      saveExchange([{ role: 'user', content: text }, { role: 'assistant', content: reply }]);
    } catch {
      setChatError('返事を受け取れませんでした');
    } finally {
      setSending(false);
    }
  };

  /** 通常のチャット (thread chat) の直近の会話から Plan の欄を埋める (EXP-010 H3)。 */
  const reflectChat = async () => {
    if (sending) return;
    setSending(true);
    setReflecting(true);
    setNotice(null);
    setChatError(null);
    try {
      const loaded = await fetchThread(project.id, 'chat');
      if (!loaded.ok) {
        setChatError(loaded.status === 503 ? DB_NOT_CONFIGURED : `チャットの会話を読み込めませんでした (${loaded.status})`);
        return;
      }
      if (loaded.messages.length === 0) {
        setNotice(NO_CHAT);
        return;
      }
      const history = toHistory(loaded.messages.slice(-REFLECT_HISTORY).map((m) => ({ role: m.role, content: m.content })));
      const res = await fetch('/api/plan/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: { name: project.name, category: project.category, purpose: project.purpose },
          plan,
          history,
          message: REFLECT_MESSAGE,
        }),
      });
      if (res.status === 429) {
        const body: unknown = await res.json().catch(() => null);
        setNotice(quotaNotice(res.status, body));
        return;
      }
      if (!res.ok) {
        setChatError(`返事を受け取れませんでした (${res.status})`);
        return;
      }
      const body = await readJson(res);
      const reply = typeof body?.reply === 'string' ? body.reply : '';
      const pair: ChatMessage[] = [{ role: 'user', content: REFLECT_MESSAGE }];
      if (reply) pair.push({ role: 'assistant', content: reply });
      setMessages((prev) => [...prev, ...pair]);
      if (body?.plan) setPlan((prev) => asPlan(body.plan, prev));
      setNotice(REFLECTED);
      saveExchange(pair);
    } catch {
      setChatError('返事を受け取れませんでした');
    } finally {
      setSending(false);
      setReflecting(false);
    }
  };

  const onSave = async () => {
    if (busy) return;
    setBusy(true);
    await persist(plan);
    setBusy(false);
  };

  const onRegister = async () => {
    if (busy || events.length === 0) return;
    setBusy(true);
    try {
      const id = cycleIdRef.current ?? (await persist(plan));
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
            <Fragment key={i}>
              <div className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[90%] p-2 rounded-lg text-sm ${m.role === 'user' ? 'bg-blue-600 text-white whitespace-pre-wrap' : 'bg-gray-100 text-gray-900'}`}>
                  {m.role === 'assistant' ? <MessageContent text={m.content} /> : m.content}
                </div>
              </div>
              {loadedCount > 0 && i === loadedCount - 1 && (
                <div className="flex items-center gap-2 text-xs text-gray-700">
                  <span aria-hidden="true" className="flex-1 border-t border-gray-400" />
                  ここから続き
                  <span aria-hidden="true" className="flex-1 border-t border-gray-400" />
                </div>
              )}
            </Fragment>
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
        <button type="button" onClick={() => void reflectChat()} aria-disabled={sending ? 'true' : undefined}
          className={`self-start text-sm px-3 py-1 rounded border border-blue-700 bg-white text-blue-800 font-bold hover:bg-blue-50 aria-disabled:opacity-50 ${focusRing}`}>
          <span aria-hidden="true">💬</span> {reflecting ? '反映中…' : 'チャットの壁打ちを Plan に反映'}
        </button>
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
        {/* 保存中は見た目だけ (live region の外)。読み上げは下の status の失敗・最初の保存済みだけ */}
        <span className="self-center text-sm text-gray-700">{saving ? SAVING : ''}</span>
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
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'ready'; cycle: Cycle | null; messages: StoredMessage[] } | { status: 'error'; message: string }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // cycle と thread plan の会話を並べて読む。会話が読めない時 (503 など) は最初から始める
        const messagesTask = fetchThread(project.id, 'plan').then(
          (r) => (r.ok ? r.messages : []),
          () => [] as StoredMessage[],
        );
        const [res, messages] = await Promise.all([
          fetch(`/api/cycles?projectId=${encodeURIComponent(project.id)}`),
          messagesTask,
        ]);
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: 'error', message: res.status === 503 ? DB_NOT_CONFIGURED : `Plan を読み込めませんでした (${res.status})` });
          return;
        }
        const body = await readJson(res);
        if (!cancelled) setState({ status: 'ready', cycle: asCycle(body?.cycle), messages });
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
          initialMessages={state.messages}
        />
      )}
    </div>
  );
}
