'use client';

import { useState, useRef, useEffect } from 'react';
import { SessionProvider, useSession, signIn, signOut } from "next-auth/react";
import { formatPerfLine } from "../lib/perf";

// --- 型定義 ---

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

type EventDate = {
  dateTime?: string;
  date?: string;
};

type CalendarEvent = {
  id?: string;
  summary: string;
  description?: string;
  start: EventDate;
  end: EventDate;
  colorId?: string;
};

type ApiChatResponse = {
  reply: string;
  error?: string;
};

// --- 型ガード (Type Guards) ---

function isEventDate(obj: unknown): obj is EventDate {
  if (typeof obj !== 'object' || obj === null) return false;
  const d = obj as Record<string, unknown>;
  return typeof d.dateTime === 'string' || typeof d.date === 'string' || d.dateTime === undefined || d.date === undefined;
}

function isCalendarEvent(obj: unknown): obj is CalendarEvent {
  if (typeof obj !== 'object' || obj === null) return false;
  const e = obj as Record<string, unknown>;
  return (
    typeof e.summary === 'string' &&
    typeof e.start === 'object' &&
    typeof e.end === 'object'
  );
}

function isCalendarEventArray(obj: unknown): obj is CalendarEvent[] {
  return Array.isArray(obj) && obj.every(isCalendarEvent);
}

// --- コンポーネント実装 ---

function AppContent() {
  const { data: session } = useSession();
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [pendingPlan, setPendingPlan] = useState<CalendarEvent[] | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // 初回表示の計測 (measure → improve ループ M0): 最初の予定取得の完了時に 1 回だけ出す
  const initialLoadLogged = useRef(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (session) {
      void fetchEvents();
    }
  }, [session]);

  const fetchEvents = async () => {
    try {
      const res = await fetch('/api/calendar/get');
      if (!initialLoadLogged.current) {
        initialLoadLogged.current = true;
        // ブラウザの performance.now() はナビゲーション開始からの経過時間。値だけを出す
        console.log(formatPerfLine({ route: "page:/ initial-calendar", status: res.status, total_ms: performance.now() }));
      }
      if (res.ok) {
        const data: unknown = await res.json();
        if (isCalendarEventArray(data)) {
          setEvents(data);
        } else {
          console.error("API returned invalid event data format");
        }
      }
    } catch (err: unknown) {
      console.error("Failed to fetch events:", err);
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setPendingPlan(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: userMessage.content, 
          history: messages,
          schedule: events
        }),
      });
      
      const data = await response.json() as unknown;
      
      if (!response.ok) {
        throw new Error('API Error');
      }

      if (typeof data !== 'object' || data === null || !('reply' in data)) {
        throw new Error('Invalid API response format');
      }

      const typedData = data as ApiChatResponse;
      const aiReply = typedData.reply;
      
      setMessages((prev) => [...prev, { role: 'assistant', content: aiReply }]);

      const jsonMatch = aiReply.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        try {
          const parsed: unknown = JSON.parse(jsonMatch[1]);
          if (isCalendarEventArray(parsed)) {
            setPendingPlan(parsed);
          } else {
            console.warn("AI generated JSON but it did not match CalendarEvent[] schema.");
          }
        } catch (e: unknown) {
          console.error("JSON parse error:", e);
        }
      }

    } catch (error: unknown) {
      console.error("Chat Error:", error);
      alert('エラーが発生しました。');
    } finally {
      setIsLoading(false);
    }
  };

  const onFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void handleSendMessage(input);
  };

  const handleSubdivide = (event: CalendarEvent) => {
    let dateInfo = "日時不明";
    if (event.start.dateTime) {
      const d = new Date(event.start.dateTime);
      dateInfo = `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
    } else if (event.start.date) {
      dateInfo = `${event.start.date} (終日)`;
    }
    const prompt = `予定「${event.summary}」（${dateInfo}）を、この時間枠内で終わるように具体的なサブタスクに細分化してください。`;
    void handleSendMessage(prompt);
  };

  const handleAddToCalendar = async () => {
    if (!pendingPlan) return;
    if (!confirm("これらの予定をGoogleカレンダーに追加しますか？")) return;

    try {
      const res = await fetch('/api/calendar/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: pendingPlan }),
      });

      if (res.ok) {
        alert("カレンダーに追加しました！🎉");
        setPendingPlan(null);
        void fetchEvents();
      } else {
        alert("追加に失敗しました...");
      }
    } catch (e: unknown) {
      console.error("Add Calendar Error:", e);
      alert("エラーが発生しました");
    }
  };

  const formatEventInfo = (start: EventDate, end: EventDate) => {
    if (start.date) {
      return `${new Date(start.date).toLocaleDateString('ja-JP')} [終日]`;
    }
    if (start.dateTime && end.dateTime) {
      const s = new Date(start.dateTime);
      const e = new Date(end.dateTime);
      return `${s.toLocaleDateString('ja-JP', {weekday:'short'})} ${s.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}〜${e.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}`;
    }
    return '日時不明';
  };

  const isToday = (event: CalendarEvent) => {
    const now = new Date();
    const dateStr = event.start.dateTime || event.start.date;
    if (!dateStr) return false;
    const eventDate = new Date(dateStr);
    return now.toDateString() === eventDate.toDateString();
  };

  const todayEvents = events.filter(isToday);
  const upcomingEvents = events.filter((e) => !isToday(e));

  const EventCard = ({ event, isToday }: { event: CalendarEvent; isToday: boolean }) => (
    <div className={`p-3 rounded-lg shadow-sm border-l-4 group relative ${isToday ? 'bg-blue-50 border-blue-600' : 'bg-white border-gray-400'}`}>
      <div className={`text-xs font-bold mb-1 ${isToday ? 'text-blue-600' : 'text-gray-500'}`}>
        {formatEventInfo(event.start, event.end)}
      </div>
      <div className="font-semibold text-gray-800 mb-1">{event.summary}</div>
      <button 
        onClick={() => handleSubdivide(event)}
        className="mt-2 text-xs bg-white border border-blue-200 text-blue-600 px-2 py-1 rounded hover:bg-blue-50 transition-colors flex items-center gap-1"
      >
        ✂️ 細分化する
      </button>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-50 text-gray-800">
      {/* 左サイド */}
      <div className="flex flex-col w-2/3 border-r bg-white">
        <header className="p-4 border-b flex justify-between items-center bg-white h-16">
          <h1 className="text-xl font-bold text-blue-600">AI Planner 🗓️</h1>
          
          {/* 🔴 修正箇所: ユーザー情報表示エリア */}
          {!session ? (
            <button onClick={() => signIn("google")} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 transition">
              Googleログイン
            </button>
          ) : (
            <div className="flex items-center gap-3">
              {/* アイコン画像 */}
              {session.user?.image && (
                <img 
                  src={session.user.image} 
                  alt={session.user.name || "User Icon"} 
                  className="w-9 h-9 rounded-full border border-gray-200 shadow-sm"
                />
              )}
              {/* 名前とログアウトボタン */}
              <div className="flex flex-col items-end">
                <span className="text-xs font-bold text-gray-700">
                  {session.user?.name}
                </span>
                <button onClick={() => signOut()} className="text-[10px] text-red-500 hover:text-red-700 hover:underline">
                  ログアウト
                </button>
              </div>
            </div>
          )}
        </header>

        <main className="flex-1 overflow-y-auto p-4 space-y-4">
           {messages.map((msg, i) => (
             <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
               <div className={`max-w-[85%] p-3 rounded-lg shadow-sm whitespace-pre-wrap ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>
                 {msg.content}
                 {msg.role === 'assistant' && i === messages.length - 1 && pendingPlan && (
                   <div className="mt-4 pt-4 border-t border-gray-300">
                     <p className="text-sm font-bold text-gray-600 mb-2">💡 カレンダーに追加しますか？</p>
                     <button onClick={handleAddToCalendar} className="bg-green-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-green-700 w-full flex items-center justify-center gap-2">
                       📅 プランをカレンダーに登録
                     </button>
                   </div>
                 )}
               </div>
             </div>
           ))}
           {isLoading && <div className="text-gray-400 animate-pulse">考え中...</div>}
           <div ref={messagesEndRef} />
        </main>

        <footer className="p-4 border-t">
          <form onSubmit={onFormSubmit} className="flex gap-2">
            <input 
              type="text" 
              name="message"
              id="chat-input"
              autoComplete="off"
              className="flex-1 p-3 border rounded focus:ring-2 focus:ring-blue-500 outline-none" 
              placeholder="例: 明日の10時の予定を詳しく決めて" 
              value={input} 
              onChange={(e) => setInput(e.target.value)} 
              disabled={isLoading} 
            />
            <button type="submit" disabled={isLoading} className="bg-blue-600 text-white px-6 rounded font-bold hover:bg-blue-700 disabled:opacity-50">送信</button>
          </form>
        </footer>
      </div>

      {/* 右サイド */}
      <div className="w-1/3 bg-gray-100 p-4 overflow-y-auto flex flex-col gap-6">
        <div>
          <h2 className="text-lg font-bold mb-3 text-blue-700">📅 今日の予定</h2>
          <div className="space-y-3">
            {todayEvents.map(e => <EventCard key={e.id || crypto.randomUUID()} event={e} isToday={true} />)}
          </div>
        </div>
        <div>
          <h2 className="text-lg font-bold mb-3 text-gray-600">🗓️ 今後の予定</h2>
          <div className="space-y-3">
            {upcomingEvents.map(e => <EventCard key={e.id || crypto.randomUUID()} event={e} isToday={false} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return <SessionProvider><AppContent /></SessionProvider>;
}