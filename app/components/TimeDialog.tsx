'use client';

import { useEffect, useRef, useState } from 'react';
import { DURATION_OPTIONS, durationLabel, durationMessage, rangeMessage } from '../../lib/time-input';

type Mode = 'duration' | 'range';

// 今日の日付 "YYYY-MM-DD" と、次の正時 "HH:00" (入力の初期値)
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function nextHour(offset = 1): string {
  const h = (new Date().getHours() + offset) % 24;
  return `${String(h).padStart(2, '0')}:00`;
}

/**
 * 時間の入力画面 (EXP-006)。AI が時間を聞いたときに開く。
 * 「何時間」か「何時から何時まで」を選んで送信すると、決まった形の文を onSubmit に渡す。
 * 「自分で入力」で閉じれば、今までどおり文字で答えられる。
 */
export function TimeDialog({ open, onSubmit, onClose }: {
  open: boolean;
  onSubmit: (text: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<Mode>('duration');
  const [minutes, setMinutes] = useState(60);
  const [date, setDate] = useState(today);
  const [start, setStart] = useState(() => nextHour(1));
  const [end, setEnd] = useState(() => nextHour(2));

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const message = mode === 'duration' ? durationMessage(minutes) : rangeMessage(date, start, end);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message) onSubmit(message);
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="time-dialog-title"
      className="rounded-xl p-0 shadow-xl backdrop:bg-black/40 w-[min(28rem,calc(100vw-2rem))]"
    >
      <form onSubmit={submit} className="p-5 flex flex-col gap-4">
        <h2 id="time-dialog-title" className="text-lg font-bold text-gray-900">🕒 時間を入力</h2>

        <fieldset className="flex gap-2">
          <legend className="sr-only">入れ方</legend>
          {([['duration', '何時間'], ['range', '何時から何時まで']] as const).map(([value, label]) => (
            <label
              key={value}
              className={`flex-1 text-center px-3 py-2 rounded-lg border cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 ${mode === value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300'}`}
            >
              <input type="radio" name="time-mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="sr-only" />
              {label}
            </label>
          ))}
        </fieldset>

        {mode === 'duration' ? (
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            所要時間
            <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="p-2 border rounded text-base text-gray-900">
              {DURATION_OPTIONS.map((m) => <option key={m} value={m}>{durationLabel(m)}</option>)}
            </select>
          </label>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm text-gray-700">
              日付
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="p-2 border rounded text-base text-gray-900" />
            </label>
            <div className="flex gap-3">
              <label className="flex-1 flex flex-col gap-1 text-sm text-gray-700">
                開始
                <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="p-2 border rounded text-base text-gray-900" />
              </label>
              <label className="flex-1 flex flex-col gap-1 text-sm text-gray-700">
                終了
                <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="p-2 border rounded text-base text-gray-900" />
              </label>
            </div>
            {!message && <p role="alert" className="text-sm text-red-700">終了は開始より後の時刻にしてください。</p>}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded border border-gray-300 text-gray-800 hover:bg-gray-50">自分で入力</button>
          <button type="submit" disabled={!message} className="px-5 py-2 rounded bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-50">送信</button>
        </div>
      </form>
    </dialog>
  );
}
