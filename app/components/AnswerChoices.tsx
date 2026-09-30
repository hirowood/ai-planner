'use client';

/**
 * AI の質問への答えの候補 (EXP-023)。押すとその文を送る。「自分で書く」は入力欄へ移る。
 * 候補はサーバとここで二重に検査した文だけ (parseChoices)。送信中は押せない (aria-disabled でフォーカスは残す)。
 */
export function AnswerChoices({ choices, busy, onPick, onWriteOwn }: {
  choices: string[];
  busy: boolean;
  onPick(text: string): void;
  onWriteOwn(): void;
}) {
  const base =
    'min-h-9 px-4 py-1.5 rounded-full border text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1';
  const cls = busy
    ? `${base} border-gray-300 bg-gray-100 text-gray-600 cursor-not-allowed`
    : `${base} border-blue-600 bg-white text-blue-700 hover:bg-blue-50`;
  return (
    <div role="group" aria-label="答えの候補" className="flex flex-wrap gap-2">
      {choices.map((c) => (
        <button key={c} type="button" aria-disabled={busy ? 'true' : undefined} onClick={() => { if (!busy) onPick(c); }} className={cls}>
          {c}
        </button>
      ))}
      <button type="button" aria-disabled={busy ? 'true' : undefined} onClick={() => { if (!busy) onWriteOwn(); }} className={cls}>
        自分で書く
      </button>
    </div>
  );
}
