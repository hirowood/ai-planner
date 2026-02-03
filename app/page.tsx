'use client';

import { useState, useRef, useEffect } from 'react';

// メッセージの型定義
type Message = {
  role: 'user' | 'assistant';
  content: string;
};

export default function Home() {
  // 状態管理（メッセージ履歴、入力中のテキスト、通信中かどうか）
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // 自動スクロール用の参照
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // メッセージが増えるたびに一番下までスクロール
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // メッセージ送信処理
  const sendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    // 1. ユーザーのメッセージを画面に表示
    const userMessage: Message = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // 2. APIに送信
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.content,
          history: messages, // 文脈を維持するために過去ログも送る
        }),
      });

      const data = await response.json();

      if (!response.ok) throw new Error(data.error);

      // 3. AIの返事を画面に表示
      const aiMessage: Message = { role: 'assistant', content: data.reply };
      setMessages((prev) => [...prev, aiMessage]);
    } catch (error) {
      console.error('Error:', error);
      alert('エラーが発生しました。もう一度試してください。');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-800">
      {/* ヘッダー */}
      <header className="p-4 bg-white shadow-sm border-b">
        <h1 className="text-xl font-bold text-center text-blue-600">AI Planner 🗓️</h1>
      </header>

      {/* チャットエリア */}
      <main className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-10">
            <p>何でも相談してください。</p>
            <p className="text-sm">「明日の計画を立てたい」「Reactの勉強がしたい」など</p>
          </div>
        )}

        {messages.map((msg, index) => (
          <div
            key={index}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] p-3 rounded-lg shadow-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-none'
                  : 'bg-white border border-gray-200 text-gray-800 rounded-bl-none'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        
        {/* 通信中のローディング表示 */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-200 text-gray-500 p-3 rounded-lg rounded-bl-none text-sm animate-pulse">
              考え中...
            </div>
          </div>
        )}
        
        {/* ここまでスクロールさせるための見えない要素 */}
        <div ref={messagesEndRef} />
      </main>

      {/* 入力エリア */}
      <footer className="p-4 bg-white border-t">
        <form onSubmit={sendMessage} className="flex gap-2 max-w-3xl mx-auto">
          <input
            type="text"
            className="flex-1 p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="ここにやりたいことを入力..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            送信
          </button>
        </form>
      </footer>
    </div>
  );
}