'use client';

import { useId, useState } from 'react';
import { CATEGORY_LABEL } from '../../lib/projects';
import { SMART_FIELDS, SMART_LABEL, nextSmartField, type SmartDraft, type SmartField } from '../../lib/smart';
import { KindPicker, OTHER } from './KindPicker';

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1';
const inputClass = `p-2 border border-gray-500 rounded text-base text-gray-900 ${focusRing}`;

// 文章で答える欄 (それ以外は日付・名前・種類)
const TEXT_FIELDS: SmartField[] = ['specific', 'measurable', 'relevant', 'achievable'];

/**
 * 新しいゴールの SMART カード (EXP-018)。会話で埋まった欄が入り、直接書いても直せる。
 * すべて埋まり期限が今日以降なら「このゴールで作る」が押せる。作ると KGI は固定 (EXP-024)。
 */
export function SmartPanel({ draft, onChange, ready, creating, onCreate, onCancel }: {
  draft: SmartDraft;
  onChange(d: SmartDraft): void;
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

      <p id={reasonId} className="text-sm text-gray-700">
        {creating ? '作っています…' : ready ? 'この内容で作れます。' : 'すべての欄を埋め、期限を今日以降にすると作れます'}
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
