'use client';

/**
 * 「よく使う入力」(EXP-025)。過去の記録と会話から作った文を並べ、押すと入力欄に入れる (送信はしない)。
 */
export function QuickReplies({ replies, onPick }: { replies: string[]; onPick(text: string): void }) {
  if (replies.length === 0) return null;
  return (
    <div role="group" aria-label="よく使う入力" className="flex flex-wrap gap-2 mb-2">
      {replies.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onPick(r)}
          className="min-h-8 px-3 py-1 rounded-full border border-gray-500 bg-white text-sm text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
        >
          {r}
        </button>
      ))}
    </div>
  );
}
