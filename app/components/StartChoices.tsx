'use client';

import type { Choice } from '../../lib/greeting';

/**
 * 挨拶と「次にすること」の選択肢 (EXP-021)。
 * 何を打てばよいか迷わないよう、AI の発言と同じ吹き出しで問いかけ、答えをボタンで示す。
 */
export function StartChoices(props: { message: string; choices: Choice[]; busy: boolean; onChoose(c: Choice): void }) {
  const { message, choices, busy, onChoose } = props;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-start">
        {/* AI の発言と同じ見た目 (会話の流れの中で読めるように) */}
        <div className="max-w-[85%] p-3 rounded-lg shadow-sm bg-gray-100 text-gray-900">{message}</div>
      </div>
      <div role="group" aria-label="次にすること" className="flex flex-wrap gap-2">
        {choices.map((c) => (
          <button
            key={c.id}
            type="button"
            // disabled だとフォーカスが外れ読み上げで存在が消えるため、aria-disabled で押せないことを伝える
            aria-disabled={busy ? 'true' : undefined}
            onClick={() => {
              if (busy) return;
              onChoose(c);
            }}
            className={`min-h-9 px-4 py-1.5 rounded-full border text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${busy ? 'bg-gray-100 text-gray-600 border-gray-300 cursor-not-allowed' : 'bg-white text-blue-700 border-blue-600 hover:bg-blue-50'}`}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
