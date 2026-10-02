import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// AI の返答を Markdown として整形して表示する (EXP-003)。
// - 生の HTML は表示しない: react-markdown の既定のまま (rehype-raw は使わない)
// - javascript: 等の危険な URL は react-markdown の既定の urlTransform が取り除く
// - Tailwind の preflight が見出し・箇条書きの見た目を消すので、要素ごとにクラスを付ける
const components: Components = {
  h1: ({ children }) => <h3 className="mt-3 mb-2 text-lg font-bold">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-3 mb-2 text-base font-bold">{children}</h3>,
  h3: ({ children }) => <h3 className="mt-3 mb-1 font-bold">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-2 mb-1 font-semibold">{children}</h4>,
  p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc pl-5 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal pl-5 space-y-1">{children}</ol>,
  strong: ({ children }) => <strong className="font-bold">{children}</strong>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-gray-300 bg-gray-50 px-2 py-1 text-left">{children}</th>,
  td: ({ children }) => <td className="border border-gray-300 px-2 py-1">{children}</td>,
  pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded bg-gray-800 p-2 text-xs text-gray-100">{children}</pre>,
  code: ({ children }) => <code className="rounded bg-gray-200/60 px-1 font-mono text-[0.9em]">{children}</code>,
  // 画像は読み込まない (EXP-010 の安全レビュー): AI に外部の画像 URL を出させると、
  // 表示した時点で URL に入れた会話の中身が外へ送られる。保存した会話は開くたびに描画されるので、代わりの文字だけを出す
  img: ({ alt }) => <span className="text-gray-700">[画像: {alt || "説明なし"}]</span>,
};

export function MessageContent({ text }: { text: string }) {
  return (
    <div className="break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
