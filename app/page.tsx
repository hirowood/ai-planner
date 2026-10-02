'use client';

import { useState, useRef, useEffect } from 'react';
import { SessionProvider, useSession, signIn, signOut } from "next-auth/react";
import { formatPerfLine } from "../lib/perf";
import { MessageContent } from "./components/MessageContent";
import { quotaNotice } from "../lib/quota";
import { hasTimeMarker, stripTimeMarker } from "../lib/time-input";
import { TimeDialog } from "./components/TimeDialog";
import { ProjectPanel, useProjectWorkspace } from "./components/ProjectPanel";
import { NotesPanel } from "./components/NotesPanel";
import { PlanFields, usePlanStore } from "./components/PlanFields";
import { PlanTree, useItems } from "./components/PlanTree";
import { choiceButtons, itemsAddedNotice, parseCandidateList, type Candidate } from "../lib/hierarchy-step";
import { hypothesisNotice } from "../lib/progress";
import { completeMessage, judgedNotice } from "../lib/judgement";
import { DailyView, useDaily } from "./components/DailyPanel";
import { TodoScheduleView, useItemEvents } from "./components/TodoSchedule";
import { TechoView } from "./components/Techo";
import type { TechoMode } from "../lib/techo";
import { eventLabel } from "../lib/todo-event";
import { parsePlanDraft, PLAN_FIELDS, PLAN_FIELD_LABEL, type PlanDraft } from "../lib/pdca-plan";
import { greetingFor, startMessage, startChoices, type Choice } from "../lib/greeting";
import { StartChoices } from "./components/StartChoices";
import { AnswerChoices } from "./components/AnswerChoices";
import { SmartPanel } from "./components/SmartPanel";
import { QuickReplies } from "./components/QuickReplies";
import { buildQuickReplies } from "../lib/quick-replies";
import { DEFAULT_START_CHOICES, OPENING, afterCreateMessage } from "../lib/setup-start";
import { OVERLOADED_MESSAGE } from "../lib/gemini-retry";
import { EMPTY_SMART, isSmartReady, parseSmartDraft, todayJst, type SmartDraft } from "../lib/smart";
import { parseChoices } from "../lib/coach-choices";

// 最後に開いたプロジェクトの id だけを端末に置く (EXP-021)。読み書きできなければ黙って諦める
const LAST_PROJECT_KEY = 'ai-planner:lastProjectId';
function readLastProjectId(): string | null {
  try {
    return window.localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}
function writeLastProjectId(id: string): void {
  try {
    window.localStorage.setItem(LAST_PROJECT_KEY, id);
  } catch {
    // 保存できない端末では「前回の続き」を出さないだけ
  }
}

// 返事で変わった Plan の欄を読み上げ用の 1 文にする (変わっていなければ null)
function planChangeNotice(before: PlanDraft, after: PlanDraft): string | null {
  const changed = PLAN_FIELDS.filter((f) => JSON.stringify(before[f]) !== JSON.stringify(after[f]));
  if (changed.length === 0) return null;
  return `Plan の${changed.map((f) => PLAN_FIELD_LABEL[f]).join('・')}を更新しました`;
}

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
  // 上限などのお知らせ (エラーではない)。次に送ったときに消す
  const [notice, setNotice] = useState<string | null>(null);
  // AI が時間を聞いたときに開く入力画面 (EXP-006)
  const [timeDialogOpen, setTimeDialogOpen] = useState(false);
  // 右の列の切り替え (EXP-008)。既定はプロジェクト
  const [sideTab, setSideTab] = useState<'projects' | 'calendar'>('projects');
  const workspace = useProjectWorkspace(Boolean(session));
  // 選んだプロジェクトの中の切り替え (EXP-009)。既定は Plan
  // 既定は「今日」(EXP-020): 毎日開いて Do と Check を回す
  const [projectTab, setProjectTab] = useState<'today' | 'plan' | 'notes'>('today');
  // 選んだプロジェクトの thread "chat" の読み込み中 (EXP-010)
  const [historyLoading, setHistoryLoading] = useState(false);
  // いま会話が属するプロジェクト。遅れて届いた古い読み込みを捨て、保存先を決める
  const chatProjectId = useRef<string | null>(null);
  // 会話の読み込み・保存の失敗 (上限のお知らせとは別の記号で出す)。次に送ったときに消す
  const [chatProblem, setChatProblem] = useState<string | null>(null);
  // 選んだプロジェクトの Plan の欄 (EXP-016)。会話の返事の plan もここへ反映する
  const planStore = usePlanStore(workspace.selectedId);
  // 選んだプロジェクトの階層 (KGI → KPI → KDI → ToDo)
  const it = useItems(workspace.selectedId);
  const daily = useDaily(workspace.selectedId);
  // 手帳の表示 (EXP-036): 日・週・月と、開いている日 (null = 今日)
  const [techo, setTecho] = useState<{ mode: TechoMode; date: string | null }>({ mode: 'day', date: null });
  const techoDate = techo.date ?? daily.today;
  const itemEvents = useItemEvents(workspace.selectedId);
  // 階層の KGI (固定) を Plan の要点に読み取り専用で出す (EXP-018)
  const kgiItem = it.items.find((i) => i.level === 'kgi');
  const kgiText = kgiItem
    ? `${kgiItem.title}${kgiItem.target ? `（${kgiItem.target}）` : ''}${kgiItem.dueDate ? ` ${kgiItem.dueDate} まで` : ''}`
    : undefined;
  // 返事で Plan の欄が変わったときの読み上げ (次に送ったときに消す)
  const [planUpdated, setPlanUpdated] = useState<string | null>(null);
  // AI の最後の質問への答えの候補 (EXP-023)。次に送るときに消す
  const [answerChoices, setAnswerChoices] = useState<string[]>([]);
  // AI が出した次の段の候補 (EXP-035)。押すとそのまま階層に足す
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  // 会話で SMART を決めて新しいプロジェクトを作るモード (EXP-018)。null なら通常
  const [setupDraft, setSetupDraft] = useState<SmartDraft | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  // 作った直後に会話へ出す一言 (EXP-029)。そのプロジェクトの会話を読み込んだ後に足す (effect から最新を読むため ref)
  const pendingAfterCreate = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 最後に開いたプロジェクト (EXP-021)。端末から読むので初回描画の後に入れる
  const [lastProjectId, setLastProjectId] = useState<string | null>(null);
  // 右の列を切り替えた後に、作成欄の名前へフォーカスを移す
  const [focusProjectName, setFocusProjectName] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  // 初回表示の計測 (measure → improve ループ M0): 最初の予定取得の完了時に 1 回だけ出す
  const initialLoadLogged = useRef(false);

  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    messagesEndRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (session) {
      void fetchEvents();
    }
  }, [session]);

  // プロジェクトを選び直したら、その会話に入れ替える。選んでいない間は画面の会話をそのまま残す (EXP-010)
  const selectedProjectId = workspace.selectedId;

  useEffect(() => {
    setLastProjectId(readLastProjectId());
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;
    writeLastProjectId(selectedProjectId);
    setLastProjectId(selectedProjectId);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!focusProjectName || sideTab !== 'projects') return;
    setFocusProjectName(false);
    document.getElementById('project-name-input')?.focus();
  }, [focusProjectName, sideTab]);

  useEffect(() => {
    chatProjectId.current = selectedProjectId;
    if (!selectedProjectId) {
      setHistoryLoading(false);
      return;
    }
    const projectId = selectedProjectId;
    setHistoryLoading(true);
    setPendingPlan(null);
    void (async () => {
      let loaded: Message[] | null = null;
      try {
        const res = await fetch(`/api/messages?projectId=${encodeURIComponent(projectId)}&thread=chat`);
        if (res.ok) {
          const body: unknown = await res.json().catch(() => null);
          const list = (body as { messages?: unknown } | null)?.messages;
          if (Array.isArray(list)) {
            loaded = list
              .filter((m): m is Message =>
                typeof m === 'object' && m !== null &&
                ((m as Message).role === 'user' || (m as Message).role === 'assistant') &&
                typeof (m as Message).content === 'string')
              .map((m) => ({ role: m.role, content: m.content }));
          }
        }
      } catch (err: unknown) {
        console.error("Failed to load chat messages:", err);
      }
      if (chatProjectId.current !== projectId) return;
      const welcome = pendingAfterCreate.current;
      pendingAfterCreate.current = null;
      setMessages([...(loaded ?? []), ...(welcome ? [{ role: 'assistant' as const, content: welcome }] : [])]);
      setChatProblem(loaded === null ? '会話を読み込めませんでした' : null);
      setHistoryLoading(false);
    })();
  }, [selectedProjectId]);

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

  // via: 時間の入力画面から送ったときだけ "time_dialog" (EXP-006・サーバは種類だけを数える)
  const handleSendMessage = async (text: string, via?: 'time_dialog', pick?: Candidate) => {
    if (!text.trim() || isLoading || historyLoading) return;
    setTimeDialogOpen(false);
    // 送った時点のプロジェクトへ保存する (選んでいなければ保存しない)
    const saveTo = chatProjectId.current;

    const userMessage: Message = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setPendingPlan(null);
    setNotice(null);
    setChatProblem(null);
    setPlanUpdated(null);
    setAnswerChoices([]);
    setCandidates([]);
    // 時間の入力画面を開くときはそちらへフォーカスを渡し、それ以外は入力欄へ戻す
    let dialogOpened = false;
    const returnFocus = () => {
      if (!dialogOpened) inputRef.current?.focus();
    };

    // 作成モード (EXP-018): /api/setup に下書きと会話を送る (データベースには書かない)
    if (setupDraft) {
      try {
        const response = await fetch('/api/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            draft: setupDraft,
            history: messages.slice(-20).map((m) => ({ role: m.role, content: m.content })),
            message: userMessage.content,
          }),
        });
        const body: unknown = await response.json().catch(() => null);
        if (response.status === 429) {
          setNotice(quotaNotice(response.status, body));
          setMessages((prev) => prev.slice(0, -1));
          setInput(text);
          return;
        }
        // AI が混み合っている (EXP-028): エラーではなくお知らせにし、文を入力欄に戻す
        if (response.status === 503 && (body as { kind?: unknown } | null)?.kind === 'overloaded') {
          setNotice(OVERLOADED_MESSAGE);
          setMessages((prev) => prev.slice(0, -1));
          setInput(text);
          return;
        }
        const reply = (body as { reply?: unknown } | null)?.reply;
        if (!response.ok || typeof reply !== 'string') {
          setChatProblem('返事を受け取れませんでした。もう一度送ってください');
          return;
        }
        setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
        setAnswerChoices(parseChoices((body as { choices?: unknown }).choices));
        const next = parseSmartDraft((body as { draft?: unknown }).draft);
        if (next) setSetupDraft(next);
      } catch (error: unknown) {
        console.error("Setup Error:", error instanceof Error ? error.name : typeof error);
        setChatProblem('返事を受け取れませんでした。もう一度送ってください');
      } finally {
        setIsLoading(false);
        returnFocus();
      }
      return;
    }

    // プロジェクトを選んでいる間は /api/coach だけを使う (EXP-016)。保存はサーバが行うので画面からは保存しない
    if (saveTo) {
      try {
        const response = await fetch('/api/coach', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: saveTo, message: userMessage.content, ...(via ? { via } : {}), ...(pick ? { pick } : {}) }),
        });
        const body: unknown = await response.json().catch(() => null);
        if (chatProjectId.current !== saveTo) return;
        if (response.status === 429) {
          setNotice(quotaNotice(response.status, body));
          setMessages((prev) => prev.slice(0, -1));
          setInput(text);
          return;
        }
        // AI が混み合っている (EXP-028): エラーではなくお知らせにし、文を入力欄に戻す
        if (response.status === 503 && (body as { kind?: unknown } | null)?.kind === 'overloaded') {
          setNotice(OVERLOADED_MESSAGE);
          setMessages((prev) => prev.slice(0, -1));
          setInput(text);
          return;
        }
        const reply = (body as { reply?: unknown } | null)?.reply;
        if (!response.ok || typeof reply !== 'string') {
          setChatProblem('返事を受け取れませんでした。もう一度送ってください');
          return;
        }
        setMessages((prev) => [...prev, { role: 'assistant', content: stripTimeMarker(reply) }]);
        // 答えの候補 (EXP-023)。サーバで検査済みだが、画面でも同じ検査を通してからボタンにする
        setAnswerChoices(parseChoices((body as { choices?: unknown }).choices));
        setCandidates(parseCandidateList((body as { candidates?: unknown }).candidates));
        const plan = parsePlanDraft((body as { plan?: unknown }).plan);
        if (plan) {
          setPlanUpdated(planChangeNotice(planStore.plan, plan));
          planStore.setPlanFromServer(plan);
        }
        // AI が階層に足した項目 (EXP-019): 階層を読み直して知らせる
        const added = itemsAddedNotice((body as { itemsAdded?: unknown }).itemsAdded);
        if (added) {
          setPlanUpdated(added);
          void it.refresh();
        }
        // AI と決めた判定を ToDo に入れた (EXP-034)
        const judgedMsg = judgedNotice((body as { judged?: unknown }).judged);
        if (judgedMsg) {
          setPlanUpdated(judgedMsg);
          void it.refresh();
        }
        // AI と立てた仮説をノートに残した (EXP-032)
        const hyp = hypothesisNotice((body as { hypothesisSaved?: unknown }).hypothesisSaved);
        if (hyp) {
          setPlanUpdated(added ? `${added}・${hyp}` : hyp);
          void workspace.reloadNotes();
        }
        if ((body as { timePrompted?: unknown }).timePrompted === true) {
          dialogOpened = true;
          setTimeDialogOpen(true);
        }
      } catch (error: unknown) {
        console.error("Coach Error:", error);
        if (chatProjectId.current === saveTo) setChatProblem('返事を受け取れませんでした。もう一度送ってください');
      } finally {
        setIsLoading(false);
        returnFocus();
      }
      return;
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: userMessage.content, 
          // 保存した会話は最大 100 件読み込むので、送るのは直近 20 件だけ (EXP-010 の安全レビュー・サーバは直近 10 件を使う)
          history: messages.slice(-20),
          schedule: events,
          ...(via ? { via } : {}),
        }),
      });
      
      // エラー (401/400/429/500) は JSON、成功はテキストのストリームで返る (EXP-001)
      // 上限 (429) はエラーではなくお知らせとして出し、送れなかった文を入力欄に戻す (EXP-005)
      if (response.status === 429) {
        const body: unknown = await response.json().catch(() => null);
        setNotice(quotaNotice(response.status, body));
        setMessages((prev) => prev.slice(0, -1));
        setInput(text);
        return;
      }
      if (!response.ok) {
        throw new Error('API Error');
      }
      if (!response.body) {
        throw new Error('Invalid API response format');
      }

      // 届いた分から表示する。予定 JSON の抽出は全文がそろってから行う (これまでと同じ規則)
      // 時間の入力画面の目印 [[time]] は画面にも履歴にも残さない (EXP-006)
      setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);
      const showReply = (content: string) =>
        setMessages((prev) => [...prev.slice(0, -1), { role: 'assistant', content: stripTimeMarker(content) }]);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let aiReply = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        aiReply += decoder.decode(value, { stream: true });
        showReply(aiReply);
      }
      aiReply += decoder.decode();
      showReply(aiReply);
      if (hasTimeMarker(aiReply)) {
        dialogOpened = true;
        setTimeDialogOpen(true);
      }

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
      setChatProblem('返事を受け取れませんでした。もう一度送ってください');
    } finally {
      setIsLoading(false);
      returnFocus();
    }
  };

  // 最後に開いたプロジェクトが、読み込んだ一覧に今もあるときだけ「前回の続き」を出す (EXP-021)
  const hasLastProject = lastProjectId !== null && workspace.projects.some((p) => p.id === lastProjectId);
  const chatBusy = isLoading || historyLoading;
  const choices = startChoices({ projectSelected: Boolean(workspace.selected), hasLastProject });
  const firstName = session?.user?.name?.trim().split(/\s+/)[0] || null;

  // 過去の傾向から最初の一言と候補を作る (EXP-027)。まだ本人が何も送っていないときだけ差し替える
  const loadSetupStart = async () => {
    setPlanUpdated('過去の傾向を分析中…');
    try {
      const res = await fetch('/api/setup/start');
      if (!res.ok) return;
      const body: unknown = await res.json().catch(() => null);
      const message = (body as { message?: unknown } | null)?.message;
      const picked = parseChoices((body as { choices?: unknown } | null)?.choices);
      if (typeof message !== 'string') return;
      setMessages((prev) => (prev.length === 1 && prev[0].role === 'assistant' ? [{ role: 'assistant', content: message }] : prev));
      setAnswerChoices((prev) => (picked.length > 0 && prev === DEFAULT_START_CHOICES ? picked : prev));
    } catch {
      // 既定の一言と候補のまま進める
    } finally {
      setPlanUpdated((prev) => (prev === '過去の傾向を分析中…' ? null : prev));
    }
  };

  // 作成モードをやめる (下書きは捨てる・データベースには何も書いていない)
  const exitSetup = () => {
    setSetupDraft(null);
    setMessages([]);
    setAnswerChoices([]);
  };

  // SMART の下書きからプロジェクトと固定の KGI を作り、そのプロジェクトを開く (EXP-018)
  const createFromSetup = async () => {
    if (!setupDraft || creatingProject) return;
    setCreatingProject(true);
    setChatProblem(null);
    try {
      const res = await fetch('/api/setup/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft: setupDraft }),
      });
      const body: unknown = await res.json().catch(() => null);
      const project = (body as { project?: { id?: unknown; name?: unknown } } | null)?.project;
      if (res.status !== 201 || typeof project?.id !== 'string') {
        setChatProblem(res.status === 503 ? 'データベースが未設定です' : `プロジェクトを作れませんでした (${res.status})`);
        return;
      }
      await workspace.loadProjects();
      setSetupDraft(null);
      setAnswerChoices([]);
      workspace.select(project.id);
      // 作った直後は KPI へ案内する (EXP-029)。会話の読み込みが空でもこの一言が残るよう、選んだ後に置く
      pendingAfterCreate.current = afterCreateMessage(typeof project.name === 'string' ? project.name : '');
      setPlanUpdated(`『${typeof project.name === 'string' ? project.name : ''}』を作りました。KGI は固定されました`);
    } catch (error: unknown) {
      console.error("Setup create Error:", error instanceof Error ? error.name : typeof error);
      setChatProblem('プロジェクトを作れませんでした');
    } finally {
      setCreatingProject(false);
    }
  };

  const handleChoose = (choice: Choice) => {
    if (chatBusy) return;
    if (choice.message) {
      void handleSendMessage(choice.message);
      // 押したボタンは会話が始まると消えるので、フォーカスを入力欄へ移す (EXP-021 の a11y レビュー・2.4.3)
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    switch (choice.id) {
      case 'new_project':
        // 会話で SMART を決めて作る (EXP-018)。手で作る欄はプロジェクトのタブに残る
        setSideTab('projects');
        setSetupDraft({ ...EMPTY_SMART });
        // まず既定の一言と候補を出し、過去の傾向から作った一言と候補が届いたら差し替える (EXP-027)
        setMessages([{ role: 'assistant', content: OPENING }]);
        setAnswerChoices(DEFAULT_START_CHOICES);
        setTimeout(() => inputRef.current?.focus(), 0);
        void loadSetupStart();
        return;
      case 'calendar':
        setSideTab('calendar');
        // 右の列が黙って切り替わらないよう、常設の status で知らせる (4.1.3)
        setPlanUpdated('右の列で予定を開きました');
        return;
      case 'resume':
        if (hasLastProject && lastProjectId) {
          setSideTab('projects');
          workspace.select(lastProjectId);
          const name = workspace.projects.find((p) => p.id === lastProjectId)?.name;
          if (name) setPlanUpdated(`『${name}』を開きました`);
        }
        return;
      case 'brainstorm':
        inputRef.current?.focus();
        return;
      default:
        return;
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
    <div className="flex h-screen overflow-hidden bg-gray-50 text-gray-800">
      {/* 左サイド */}
      <div className="relative flex flex-col w-2/3 min-w-0 border-r bg-white">
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

        <main tabIndex={0} aria-label="会話" className="flex-1 overflow-y-auto p-4 space-y-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500">
           {workspace.selected && (
             <p className="text-xs text-gray-600"><span aria-hidden="true">💬</span> 『{workspace.selected.name}』の PDCA (記録を見て答えます)</p>
           )}
           {/* 会話がまだ無い時は、挨拶と選択肢を最初に出す (EXP-021・読み込み中は出さない) */}
           {!setupDraft && messages.length === 0 && !historyLoading && (
             <StartChoices
               message={startMessage({
                 greeting: greetingFor(new Date()),
                 userName: firstName,
                 projectName: workspace.selected?.name ?? null,
                 hasHistory: false,
               })}
               choices={choices}
               busy={chatBusy}
               onChoose={handleChoose}
             />
           )}
           <div role="log" aria-live="polite" aria-relevant="additions" aria-label="会話の履歴" className="space-y-4">
           {messages.map((msg, i) => (
             <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
               <div className={`max-w-[85%] p-3 rounded-lg shadow-sm ${msg.role === 'user' ? 'bg-blue-600 text-white whitespace-pre-wrap' : 'bg-gray-100'}`}>
                 {/* AI の返答は Markdown として整形 (EXP-003)。本人のメッセージは文字のまま */}
                 {msg.role === 'assistant' ? <MessageContent text={msg.content} /> : msg.content}
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
           </div>
           {/* AI が質問で終えたときは、答えの候補を先に出す (EXP-023)。無いときは次にすることの選択肢 */}
           {messages.length > 0 && (candidates.length > 0 || answerChoices.length > 0) && (
             <AnswerChoices
               // 次の段の候補 (EXP-035) を先に・押すと pick を付けて送り、サーバがそのまま足す
               choices={choiceButtons(candidates, answerChoices)}
               busy={chatBusy}
               onPick={(text) => {
                 const c = candidates.find((x) => x.title === text);
                 void handleSendMessage(c ? `『${c.title}』にします` : text, undefined, c);
                 setTimeout(() => inputRef.current?.focus(), 0);
               }}
               onWriteOwn={() => inputRef.current?.focus()}
             />
           )}
           {/* 会話がある時も、一番下に次にすることの選択肢を出す (送信中は押せない) */}
           {!setupDraft && messages.length > 0 && answerChoices.length === 0 && candidates.length === 0 && (
             <StartChoices
               message="次にすることを選べます。"
               choices={choices}
               busy={chatBusy}
               onChoose={handleChoose}
             />
           )}
           {/* 読み込み中・考え中・Plan の更新を 1 つの status で伝える (常に置いておく) */}
           <p role="status" aria-busy={isLoading || historyLoading} className="text-sm text-gray-600">
             {historyLoading ? '会話を読み込み中…' : isLoading ? <span className="animate-pulse motion-reduce:animate-none">考え中...</span> : planUpdated ?? ''}
           </p>
           <div role="status">
             {notice && (
               <p className="p-3 rounded-lg bg-amber-50 border border-amber-300 text-amber-900"><span aria-hidden="true">⏳</span> {notice}</p>
             )}
             {chatProblem && (
               <p className="p-3 rounded-lg bg-red-50 border border-red-300 text-red-900"><span aria-hidden="true">⚠️</span> {chatProblem}</p>
             )}
           </div>
           <div ref={messagesEndRef} />
        </main>

        <footer className="p-4 border-t">
          {/* よく使う入力 (EXP-025): プロジェクトを選んでいる間、記録と過去の発言から作る。押すと入力欄に入る */}
          {workspace.selectedId && !setupDraft && (
            <QuickReplies
              replies={buildQuickReplies({
                items: it.items,
                notes: workspace.notes,
                userMessages: messages.filter((m) => m.role === 'user').map((m) => m.content),
              })}
              onPick={(text) => {
                setInput(text);
                inputRef.current?.focus();
              }}
            />
          )}
          <form onSubmit={onFormSubmit} className="flex gap-2">
            <label htmlFor="chat-input" className="sr-only">メッセージ</label>
            <input
              ref={inputRef}
              type="text"
              name="message"
              id="chat-input"
              autoComplete="off"
              className="flex-1 p-3 border rounded focus:ring-2 focus:ring-blue-500 outline-none" 
              placeholder="例: 明日の10時の予定を詳しく決めて" 
              value={input} 
              onChange={(e) => setInput(e.target.value)} 
              readOnly={isLoading}
              aria-disabled={isLoading}
            />
            {/* 送信中も disabled にしない (フォーカスを失わせない)。二重送信は handleSendMessage が止める */}
            <button type="submit" aria-disabled={isLoading} className={`bg-blue-600 text-white px-6 rounded font-bold hover:bg-blue-700 ${isLoading ? 'opacity-50' : ''}`}>送信</button>
          </form>
        </footer>
        <TimeDialog
          open={timeDialogOpen}
          onSubmit={(text) => void handleSendMessage(text, 'time_dialog')}
          onClose={() => setTimeDialogOpen(false)}
        />
      </div>

      {/* 右サイド */}
      <div className="relative w-1/3 min-w-0 bg-gray-100 p-4 overflow-y-auto flex flex-col gap-6">
        {setupDraft ? (
          <SmartPanel
            draft={setupDraft}
            onChange={setSetupDraft}
            ready={isSmartReady(setupDraft, todayJst())}
            creating={creatingProject}
            onCreate={() => void createFromSetup()}
            onCancel={exitSetup}
          />
        ) : (<>
        <div role="tablist" aria-label="右の列" className="flex gap-2">
          {([['projects', '📁', 'プロジェクト'], ['calendar', '📅', '予定']] as const).map(([tab, icon, label]) => (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`side-tab-${tab}`}
              aria-selected={sideTab === tab}
              aria-controls={`side-panel-${tab}`}
              onClick={() => setSideTab(tab)}
              className={`flex-1 px-3 py-2 rounded-lg border font-bold text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${sideTab === tab ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'}`}
            >
              <span aria-hidden="true">{icon}</span> {label}
            </button>
          ))}
        </div>
        {sideTab === 'projects' ? (
          <div role="tabpanel" id="side-panel-projects" aria-labelledby="side-tab-projects" className="flex flex-col gap-6">
            <div role="status">
              {workspace.problem && (
                <p className="p-3 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-sm">{workspace.problem}</p>
              )}
              {!workspace.problem && workspace.done && (
                <p className="text-sm text-gray-700">{workspace.done}</p>
              )}
            </div>
            {workspace.selected && (
              <div className="flex flex-col gap-4">
                {/* 選んだプロジェクトの Plan / ノートの切り替え (EXP-009)。既定は Plan */}
                <div role="tablist" aria-label="プロジェクトの中身" className="flex gap-2">
                  {([['today', '📒', '手帳'], ['plan', '📝', 'Plan'], ['notes', '📓', 'ノート']] as const).map(([tab, icon, label]) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      id={`project-tab-${tab}`}
                      aria-selected={projectTab === tab}
                      aria-controls={`project-panel-${tab}`}
                      onClick={() => setProjectTab(tab)}
                      className={`flex-1 px-3 py-2 rounded-lg border font-bold text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${projectTab === tab ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'}`}
                    >
                      <span aria-hidden="true">{icon}</span> {label}
                    </button>
                  ))}
                </div>
                {projectTab === 'today' ? (
                  <div role="tabpanel" id="project-panel-today" aria-labelledby="project-tab-today" className="flex flex-col gap-6">
                    <TechoView
                      today={daily.today}
                      mode={techo.mode}
                      date={techoDate}
                      items={it.items}
                      logs={daily.logs}
                      notes={workspace.notes}
                      onChange={(mode, date) => setTecho({ mode, date: date === daily.today ? null : date })}
                      renderDay={(date) => (
                    <div className="flex flex-col gap-6">
                    <DailyView
                      key={`${workspace.selectedId ?? ''}:${date}`}
                      today={daily.today}
                      date={date}
                      items={it.items}
                      logs={daily.logs}
                      problem={daily.problem}
                      saving={daily.saving}
                      saved={daily.savedDay === date}
                      onUpdateItem={(id, p) => void it.update(id, p)}
                      onSave={(d) => void daily.save(date, d)}
                      onAsk={(text) => { void handleSendMessage(text); setTimeout(() => inputRef.current?.focus(), 0); }}
                      onComplete={(item) => {
                        // 実行 (判定待ち) にしてから、会話で判定を頼む (EXP-034)
                        void it.update(item.id, { status: 'done' }).then(() => handleSendMessage(completeMessage(item.title)));
                        setTimeout(() => inputRef.current?.focus(), 0);
                      }}
                      eventLabels={Object.fromEntries(itemEvents.events.map((e) => [e.itemId, eventLabel(e)]))}
                    />
                    {date === daily.today && (
                    <TodoScheduleView
                      today={daily.today}
                      items={it.items}
                      events={itemEvents.events}
                      busyId={itemEvents.busyId}
                      problem={itemEvents.problem}
                      done={itemEvents.done}
                      onSchedule={(item, start, end) => void itemEvents.schedule(item, start, end)}
                    />
                    )}
                    </div>
                      )}
                    />
                  </div>
                ) : projectTab === 'plan' ? (
                  <div role="tabpanel" id="project-panel-plan" aria-labelledby="project-tab-plan" className="flex flex-col gap-6">
                    <section aria-labelledby="plan-tree-heading" className="flex flex-col gap-3">
                      <h3 id="plan-tree-heading" className="text-base font-bold text-gray-800"><span aria-hidden="true">🌳</span> 階層 (KGI → KPI → KDI → ToDo)</h3>
                      <div role="status">
                        {it.loading && <p className="text-sm text-gray-600">読み込み中…</p>}
                        {it.problem && (
                          <p className="p-3 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-sm">{it.problem}</p>
                        )}
                      </div>
                      <PlanTree
                        items={it.items}
                        lastParentId={it.lastParentId}
                        onCreate={(i) => void it.create(i)}
                        onUpdate={(id, p) => void it.update(id, p)}
                        onDelete={(id) => void it.remove(id)}
                        onLastParentChange={it.setLastParentId}
                      />
                    </section>
                    <section aria-labelledby="plan-fields-heading" className="flex flex-col gap-3">
                      <h3 id="plan-fields-heading" className="text-base font-bold text-gray-800">Plan の要点</h3>
                      <PlanFields
                        plan={planStore.plan}
                        onChange={planStore.setPlanByUser}
                        cycleId={planStore.cycleId}
                        saveStatus={planStore.saveStatus}
                        lockedKgi={kgiText}
                        onRegisterCalendar={() => void planStore.registerCalendar()}
                      />
                    </section>
                  </div>
                ) : (
                  <div role="tabpanel" id="project-panel-notes" aria-labelledby="project-tab-notes">
                    <NotesPanel
                      project={workspace.selected}
                      notes={workspace.notes}
                      onCreate={(input) => void workspace.createNote(input)}
                      onDelete={(id) => void workspace.deleteNote(id)}
                    />
                  </div>
                )}
              </div>
            )}
            <ProjectPanel
              projects={workspace.projects}
              selectedId={workspace.selectedId}
              onSelect={workspace.select}
              onCreate={(input) => void workspace.createProject(input)}
            />
          </div>
        ) : (
          <div role="tabpanel" id="side-panel-calendar" aria-labelledby="side-tab-calendar" className="flex flex-col gap-6">
        <div>
          <h2 className="text-lg font-bold mb-3 text-blue-700"><span aria-hidden="true">📅</span> 今日の予定</h2>
          <div className="space-y-3">
            {todayEvents.map(e => <EventCard key={e.id || crypto.randomUUID()} event={e} isToday={true} />)}
          </div>
        </div>
        <div>
          <h2 className="text-lg font-bold mb-3 text-gray-600"><span aria-hidden="true">🗓️</span> 今後の予定</h2>
          <div className="space-y-3">
            {upcomingEvents.map(e => <EventCard key={e.id || crypto.randomUUID()} event={e} isToday={false} />)}
          </div>
        </div>
          </div>
        )}
        </>)}
      </div>
    </div>
  );
}

export default function Home() {
  return <SessionProvider><AppContent /></SessionProvider>;
}