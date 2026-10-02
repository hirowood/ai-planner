'use client';

import { useId, useState } from 'react';
import { CATEGORY_LABEL } from '../../lib/projects';
import { SMART_FIELDS, SMART_LABEL, nextSmartField, type SmartDraft, type SmartField } from '../../lib/smart';
import { KindPicker, OTHER } from './KindPicker';
import { SETUP_KPI_MAX, type KpiDraft } from '../../lib/setup-kpi';

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1';
const inputClass = `p-2 border border-gray-500 rounded text-base text-gray-900 ${focusRing}`;

// 文章で答える欄 (それ以外は日付・名前・種類)
const TEXT_FIELDS: SmartField[] = ['specific', 'measurable', 'relevant', 'achievable'];

/**
 * 新しいゴールの SMART カード (EXP-018)。会話で埋まった欄が入り、直接書いても直せる。
 * すべて埋まり期限が今日以降なら「このゴールで作る」が押せる。作ると KGI は固定 (EXP-024)。
 */
export function SmartPanel({ draft, onChange, ready, creating, onCreate, onCancel, kpis = [], onKpisChange }: {
  draft: SmartDraft;
  onChange(d: SmartDraft): void;
  /** KPI (仮置き・EXP-037)。 */
  kpis?: KpiDraft[];
  onKpisChange?(k: KpiDraft[]): void;
  ready: boolean;
  creating: boolean;
  onCreate(): void;
  onCancel(): void;
}) {
  const ids = useId();
  const next = nextSmartField(draft);
  const set = (f: SmartField, v: string) => onChange({ ...draft, [f]: v });

  // 種類: 既定の値ならそのラジオ、自由入力の名前なら「その他」(KindPicker と同じ扱い)
  const isPreset = Object.hasOwn(CATEGORY_LABEL, draft.category);
  const [otherChosen, setOtherChosen] = useState(false);
  const choice = isPreset ? draft.category : draft.category || otherChosen ? OTHER : '';

  const disabled = !ready || creating;
  const reasonId = `${ids}-reason`;

  const wrap = (f: SmartField) =>
    `flex flex-col gap-1 text-sm text-gray-700 ${next === f ? 'p-2 -m-2 rounded-lg bg-blue-50 border border-blue-600' : ''}`;
  const marker = (f: SmartField) =>
    next === f ? <span className="text-blue-800 font-bold"><span aria-hidden="true">← </span>次に決める</span> : null;

  return (
    <section aria-labelledby={`${ids}-title`} className="flex flex-col gap-4">
      <h2 id={`${ids}-title`} className="text-lg font-bold text-blue-700"><span aria-hidden="true">🎯</span> 新しいゴール (SMART)</h2>
      <p className="text-sm text-gray-700">作ると、KGI は固定されます (変えるのは KPI・KDI・ToDo)。</p>

      {SMART_FIELDS.map((f) => {
        const id = `${ids}-${f}`;
        if (f === 'category') {
          return (
            <div key={f} className={wrap(f)} aria-current={next === f ? 'step' : undefined}>
              <KindPicker
                legend={SMART_LABEL.category}
                groupName={`${ids}-category`}
                presets={CATEGORY_LABEL}
                choice={choice}
                custom={isPreset ? '' : draft.category}
                onChoice={(c) => {
                  setOtherChosen(c === OTHER);
                  set('category', c === OTHER ? '' : c);
                }}
                onCustom={(t) => set('category', t)}
              />
              {marker(f)}
            </div>
          );
        }
        return (
          <div key={f} className={wrap(f)} aria-current={next === f ? 'step' : undefined}>
            <label htmlFor={id}>
              {SMART_LABEL[f]} {marker(f)}
            </label>
            {TEXT_FIELDS.includes(f) ? (
              <textarea id={id} rows={2} maxLength={300} value={draft[f]} onChange={(e) => set(f, e.target.value)} className={inputClass} />
            ) : f === 'timeBound' ? (
              <input id={id} type="date" value={draft[f]} onChange={(e) => set(f, e.target.value)} className={inputClass} />
            ) : (
              <input id={id} type="text" maxLength={60} autoComplete="off" value={draft[f]} onChange={(e) => set(f, e.target.value)} className={inputClass} />
            )}
          </div>
        );
      })}

      <fieldset className={`flex flex-col gap-2 ${!next && kpis.length === 0 ? 'p-2 -m-2 rounded-lg bg-blue-50 border border-blue-600' : ''}`}>
        <legend className="text-sm font-bold text-gray-800">
          KPI (仮置き・あとで AI と話しながら変えられます)
          {!next && kpis.length === 0 && <span className="ml-1 text-blue-800"><span aria-hidden="true">← </span>次に決める</span>}
        </legend>
        <p className="text-sm text-gray-700">KGI を期限までに達成できているかを途中で測る数です。1〜{SETUP_KPI_MAX} 個。</p>
        {kpis.length === 0 && <p className="text-sm text-gray-700">まだありません。会話で決めるか、下で足せます。</p>}
        {kpis.map((k, i) => (
          <div key={i} className="flex flex-col gap-1 rounded border border-gray-300 bg-white p-2">
            <label className="flex flex-col gap-1 text-sm text-gray-700">
              KPI {i + 1}
              <input type="text" maxLength={200} value={k.title} onChange={(e) => onKpisChange?.(kpis.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-gray-700">
              判定基準
              <input type="text" maxLength={200} value={k.target} onChange={(e) => onKpisChange?.(kpis.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-gray-700">
              期日 (KGI の期限まで)
              <input type="date" max={draft.timeBound || undefined} value={k.dueDate} onChange={(e) => onKpisChange?.(kpis.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} className={inputClass} />
            </label>
            <button type="button" onClick={() => onKpisChange?.(kpis.filter((_, j) => j !== i))} className={`self-end px-3 py-1 rounded border border-gray-500 text-sm text-gray-800 hover:bg-gray-50 ${focusRing}`}>
              KPI {i + 1} を消す
            </button>
          </div>
        ))}
        {kpis.length < SETUP_KPI_MAX && (
          <button type="button" onClick={() => onKpisChange?.([...kpis, { title: '', target: '', dueDate: '' }])} className={`self-start px-3 py-1 rounded border border-blue-600 text-sm text-blue-700 hover:bg-blue-50 ${focusRing}`}>
            KPI を足す
          </button>
        )}
      </fieldset>

      <p id={reasonId} className="text-sm text-gray-700">
        {creating ? '作っています…' : ready ? 'この内容で作れます。' : 'SMART のすべての欄を埋め (期限は今日以降)、KPI を 1 つ以上決めると作れます'}
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={`px-4 py-2 rounded border border-gray-500 text-gray-800 hover:bg-gray-50 ${focusRing}`}>
          やめる
        </button>
        <button
          type="button"
          aria-disabled={disabled ? 'true' : undefined}
          aria-describedby={reasonId}
          onClick={() => { if (!disabled) onCreate(); }}
          className={`px-5 py-2 rounded font-bold ${focusRing} ${disabled ? 'bg-gray-300 text-gray-700 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
        >
          このゴールで作る
        </button>
      </div>
    </section>
  );
}
