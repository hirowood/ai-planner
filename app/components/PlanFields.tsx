'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  EMPTY_PLAN,
  PLAN_FIELDS,
  PLAN_FIELD_LABEL,
  nextField,
  planToEvents,
  type Kdi,
  type Kpi,
  type PlanDraft,
  type PlanField,
} from '../../lib/pdca-plan';

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
const LOAD_FAILED = 'Plan を読み込めませんでした';
const CALENDAR_FAILED = 'カレンダーに登録できませんでした';
const CALENDAR_DONE = 'カレンダーに登録しました';

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

function asCycle(x: unknown): { id: string; plan: PlanDraft } | null {
  if (typeof x !== 'object' || x === null) return null;
  const c = x as Record<string, unknown>;
  if (typeof c.id !== 'string') return null;
  return { id: c.id, plan: asPlan(c.plan, EMPTY_PLAN) };
}

/**
 * プロジェクトの Plan (最新の cycle) を読み、本人の入力を自動保存する。
 * setPlanByUser は保存する・setPlanFromServer は保存しない (サーバーが保存済み)。
 */
export function usePlanStore(projectId: string | null): {
  plan: PlanDraft;
  cycleId: string | null;
  loading: boolean;
  saveStatus: string;
  setPlanByUser(next: PlanDraft): void;
  setPlanFromServer(next: PlanDraft, cycleId?: string | null): void;
  registerCalendar(): Promise<void>;
  reload(): Promise<void>;
} {
  const [plan, setPlan] = useState<PlanDraft>(EMPTY_PLAN);
  const [cycleId, setCycleId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(projectId !== null);
  const [saveStatus, setSaveStatus] = useState('');

  // プロジェクトを切り替えたら古い応答を捨てる (世代番号)
  const genRef = useRef(0);
  const projectIdRef = useRef<string | null>(projectId);
  const planRef = useRef<PlanDraft>(EMPTY_PLAN);
  const cycleIdRef = useRef<string | null>(null);
  const lastSavedRef = useRef<string>(JSON.stringify(EMPTY_PLAN));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 保存の直列化: 実行中の保存があれば最新の Plan だけを待たせる (重ねて PUT しない)
  const inFlightRef = useRef<Promise<string | null> | null>(null);
  const queuedRef = useRef<PlanDraft | null>(null);
  // 読み上げは失敗と、状態が変わった後の最初の「保存済み」だけ (自動保存のたびに status を変えない)
  const saveStateRef = useRef<'none' | 'saved' | 'failed'>('none');
  const registeringRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const failSave = (gen: number, message: string) => {
    if (gen !== genRef.current) return;
    saveStateRef.current = 'failed';
    setSaveStatus(message);
  };

  /** 1 回 PUT する。cycle の id を返す (失敗は null・状態は saveStatus に出す)。 */
  const putCycle = async (gen: number, p: PlanDraft): Promise<string | null> => {
    const pid = projectIdRef.current;
    if (!pid || gen !== genRef.current) return null;
    if (saveStateRef.current !== 'saved') setSaveStatus(SAVING);
    try {
      const res = await fetch('/api/cycles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: pid, cycleId: cycleIdRef.current, plan: p, phase: 'plan' }),
      });
      if (gen !== genRef.current) return null;
      if (!res.ok) {
        failSave(gen, res.status === 503 ? DB_NOT_CONFIGURED : `${SAVE_FAILED} (${res.status})`);
        return null;
      }
      const cycle = asCycle((await readJson(res))?.cycle);
      if (gen !== genRef.current) return null;
      if (!cycle) {
        failSave(gen, SAVE_FAILED);
        return null;
      }
      cycleIdRef.current = cycle.id;
      lastSavedRef.current = JSON.stringify(p);
      setCycleId(cycle.id);
      if (saveStateRef.current !== 'saved') setSaveStatus(SAVED);
      saveStateRef.current = 'saved';
      return cycle.id;
    } catch {
      failSave(gen, SAVE_FAILED);
      return null;
    }
  };

  /** 保存する。実行中なら最新の Plan を待たせ、待ちが全部終わった時点の結果を返す。 */
  const persist = (p: PlanDraft): Promise<string | null> => {
    if (inFlightRef.current) {
      queuedRef.current = p;
      return inFlightRef.current;
    }
    const gen = genRef.current;
    const holder: { run: Promise<string | null> | null } = { run: null };
    const run: Promise<string | null> = (async () => {
      try {
        let result = await putCycle(gen, p);
        while (queuedRef.current && gen === genRef.current) {
          const q = queuedRef.current;
          queuedRef.current = null;
          result = await putCycle(gen, q);
        }
        return result;
      } finally {
        if (inFlightRef.current === holder.run) inFlightRef.current = null;
      }
    })();
    holder.run = run;
    inFlightRef.current = run;
    return run;
  };

  const load = useCallback(async (pid: string | null, gen: number) => {
    if (!pid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/cycles?projectId=${encodeURIComponent(pid)}`);
      if (gen !== genRef.current) return;
      if (!res.ok) {
        setSaveStatus(res.status === 503 ? DB_NOT_CONFIGURED : `${LOAD_FAILED} (${res.status})`);
        return;
      }
      const cycle = asCycle((await readJson(res))?.cycle);
      if (gen !== genRef.current) return;
      const p = cycle?.plan ?? EMPTY_PLAN;
      planRef.current = p;
      cycleIdRef.current = cycle?.id ?? null;
      lastSavedRef.current = JSON.stringify(p);
      setPlan(p);
      setCycleId(cycle?.id ?? null);
    } catch {
      if (gen === genRef.current) setSaveStatus(LOAD_FAILED);
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    genRef.current += 1;
    const gen = genRef.current;
    projectIdRef.current = projectId;
    clearTimer();
    inFlightRef.current = null;
    queuedRef.current = null;
    saveStateRef.current = 'none';
    planRef.current = EMPTY_PLAN;
    cycleIdRef.current = null;
    lastSavedRef.current = JSON.stringify(EMPTY_PLAN);
    setPlan(EMPTY_PLAN);
    setCycleId(null);
    setSaveStatus('');
    void load(projectId, gen);
    return () => {
      clearTimer();
    };
  }, [projectId, load]);

  const setPlanByUser = (next: PlanDraft) => {
    planRef.current = next;
    setPlan(next);
    clearTimer();
    if (!projectIdRef.current) return;
    if (JSON.stringify(next) === lastSavedRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (JSON.stringify(planRef.current) !== lastSavedRef.current) void persist(planRef.current);
    }, AUTOSAVE_MS);
  };

  const setPlanFromServer = (next: PlanDraft, id?: string | null) => {
    // サーバーが保存済みなので自動保存しない (待っている本人の入力の保存も取り消す)
    clearTimer();
    planRef.current = next;
    lastSavedRef.current = JSON.stringify(next);
    setPlan(next);
    if (id !== undefined) {
      cycleIdRef.current = id;
      setCycleId(id);
    }
  };

  const registerCalendar = async () => {
    if (registeringRef.current || !projectIdRef.current) return;
    const gen = genRef.current;
    if (planToEvents(planRef.current, cycleIdRef.current ?? 'unsaved').length === 0) return;
    registeringRef.current = true;
    try {
      let id = cycleIdRef.current;
      const pending = timerRef.current !== null || JSON.stringify(planRef.current) !== lastSavedRef.current;
      if (!id || pending || inFlightRef.current) {
        clearTimer();
        id = await persist(planRef.current);
        // 待ちの間に入った最新の入力も保存し終えてから登録する
        if (id && JSON.stringify(planRef.current) !== lastSavedRef.current) id = await persist(planRef.current);
      }
      if (!id || gen !== genRef.current) return;
      const res = await fetch('/api/calendar/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: planToEvents(planRef.current, id), source: 'plan_form' }),
      });
      const body = await readJson(res);
      if (gen !== genRef.current) return;
      // 結果は必ず読み上げる。次の保存では「保存済み」を出し直す
      saveStateRef.current = 'none';
      if (!res.ok) {
        setSaveStatus(`${CALENDAR_FAILED} (${res.status})`);
        return;
      }
      setSaveStatus(typeof body?.message === 'string' ? body.message : CALENDAR_DONE);
    } catch {
      if (gen === genRef.current) {
        saveStateRef.current = 'none';
        setSaveStatus(CALENDAR_FAILED);
      }
    } finally {
      registeringRef.current = false;
    }
  };

  const reload = async () => {
    clearTimer();
    await load(projectIdRef.current, genRef.current);
  };

  return { plan, cycleId, loading, saveStatus, setPlanByUser, setPlanFromServer, registerCalendar, reload };
}

/** Plan の 6 欄だけ (会話・送信・反映は持たない)。値は plan・変更は onChange で親へ返す。 */
export function PlanFields({ plan, onChange, cycleId, saveStatus, onRegisterCalendar, lockedKgi }: {
  plan: PlanDraft;
  onChange(next: PlanDraft): void;
  cycleId: string | null;
  saveStatus: string;
  onRegisterCalendar?(): void;
  // 階層に KGI があればその内容。目標 (KGI) を読み取り専用にする (EXP-018・KGI は固定 EXP-024)
  lockedKgi?: string;
}) {
  const baseId = useId();
  // ＋で足した行の最初の入力欄へ移す (足した直後の描画の後で focus する)
  const focusAfterAdd = useRef<string | null>(null);

  useEffect(() => {
    if (!focusAfterAdd.current) return;
    document.getElementById(focusAfterAdd.current)?.focus();
    focusAfterAdd.current = null;
  }, [plan.kpis.length, plan.kdis.length]);

  const next = nextField(plan);
  const events = planToEvents(plan, cycleId ?? 'unsaved');

  const setText = (field: 'purpose' | 'kgi' | 'criteria' | 'deliverable', value: string) =>
    onChange({ ...plan, [field]: value });
  const setKpi = (i: number, patch: Partial<Kpi>) =>
    onChange({ ...plan, kpis: plan.kpis.map((k, j) => (j === i ? { ...k, ...patch } : k)) });
  const setKdi = (i: number, patch: Partial<Kdi>) =>
    onChange({ ...plan, kdis: plan.kdis.map((k, j) => (j === i ? { ...k, ...patch } : k)) });

  const rowId = (kind: 'kpi' | 'kdi', i: number) => `plan-${baseId}-${kind}-${i}`;
  const addKpi = () => {
    if (plan.kpis.length >= KPI_MAX) return;
    focusAfterAdd.current = rowId('kpi', plan.kpis.length);
    onChange({ ...plan, kpis: [...plan.kpis, { name: '', target: '' }] });
  };
  const addKdi = () => {
    if (plan.kdis.length >= KDI_MAX) return;
    focusAfterAdd.current = rowId('kdi', plan.kdis.length);
    onChange({ ...plan, kdis: [...plan.kdis, { action: '', date: '', start: '', end: '' }] });
  };
  const hintClass = 'text-xs text-gray-700';
  const lengthHintId = `plan-${baseId}-length-hint`;

  const groupClass = (field: PlanField) =>
    `flex flex-col gap-1 p-2 rounded-lg border ${next === field ? 'border-blue-600 bg-blue-50' : 'border-transparent'}`;
  const marker = (field: PlanField) =>
    next === field ? <span className="text-xs font-bold text-blue-800"><span aria-hidden="true">← </span>次に決める</span> : null;

  const renderField = (field: PlanField) => {
    const label = PLAN_FIELD_LABEL[field];
    const id = `plan-${baseId}-${field}`;
    if (field === 'kpis') {
      return (
        <fieldset key={field} className={groupClass(field)} aria-current={next === field ? 'step' : undefined}>
          <legend className="text-sm font-bold text-gray-900">{label} {marker(field)}</legend>
          {plan.kpis.map((k, i) => (
            <div key={i} className="flex flex-wrap gap-2">
              <input id={rowId('kpi', i)} aria-label={`${label} ${i + 1} の名前`} className={`${inputClass} flex-1 min-w-0`} value={k.name}
                maxLength={500} aria-describedby={lengthHintId} onChange={(e) => setKpi(i, { name: e.target.value })} />
              <input aria-label={`${label} ${i + 1} の目標値`} className={`${inputClass} w-24 max-w-full`} value={k.target}
                maxLength={500} aria-describedby={lengthHintId} onChange={(e) => setKpi(i, { target: e.target.value })} />
            </div>
          ))}
          <button type="button" disabled={plan.kpis.length >= KPI_MAX} onClick={addKpi}
            aria-describedby={`plan-${baseId}-kpi-hint`}
            className={`self-start text-sm px-2 py-1 rounded border border-gray-500 bg-white text-gray-900 hover:bg-gray-50 disabled:opacity-50 ${focusRing}`}>
            ＋指標を足す
          </button>
          <p id={`plan-${baseId}-kpi-hint`} className={hintClass}>KPI は {KPI_MAX} 件まで</p>
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
                maxLength={500} aria-describedby={lengthHintId} onChange={(e) => setKdi(i, { action: e.target.value })} />
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
            aria-describedby={`plan-${baseId}-kdi-hint`}
            className={`self-start text-sm px-2 py-1 rounded border border-gray-500 bg-white text-gray-900 hover:bg-gray-50 disabled:opacity-50 ${focusRing}`}>
            ＋行動を足す
          </button>
          <p id={`plan-${baseId}-kdi-hint`} className={hintClass}>行動は {KDI_MAX} 件まで</p>
        </fieldset>
      );
    }
    if (field === 'kgi' && lockedKgi) {
      return (
        <div key={field} className={groupClass(field)}>
          <p className="text-sm font-bold text-gray-900">{label} <span className="font-normal text-gray-700"><span aria-hidden="true">🔒 </span>階層の KGI (固定)</span></p>
          <p className="text-gray-900 break-words">{lockedKgi}</p>
        </div>
      );
    }
    return (
      <div key={field} className={groupClass(field)} aria-current={next === field ? 'step' : undefined}>
        <label htmlFor={id} className="text-sm font-bold text-gray-900">{label} {marker(field)}</label>
        <textarea id={id} rows={2} maxLength={500} aria-describedby={lengthHintId} className={inputClass} value={plan[field]}
          onChange={(e) => setText(field, e.target.value)} />
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p id={lengthHintId} className={hintClass}>文字の欄は 500 字まで</p>
        {PLAN_FIELDS.map(renderField)}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onRegisterCalendar?.()} disabled={events.length === 0}
          aria-describedby={`plan-${baseId}-register-hint`}
          className={`px-3 py-2 rounded border border-green-700 bg-white text-green-800 font-bold hover:bg-green-50 disabled:opacity-50 ${focusRing}`}>
          <span aria-hidden="true">📅</span> 行動をカレンダーに登録
        </button>
      </div>
      <p id={`plan-${baseId}-register-hint`} className="text-xs text-gray-700">
        日付・開始・終了がそろった行動があると登録できます
      </p>
      {/* 常設の live region。中身だけを入れ替える */}
      <div role="status" className="text-sm text-gray-800">{saveStatus}</div>
    </div>
  );
}
