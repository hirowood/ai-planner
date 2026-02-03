import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";

// --- 環境変数の確認 ---
if (!process.env.GOOGLE_API_KEY) {
  throw new Error("SERVER CONFIG ERROR: GOOGLE_API_KEY is not defined");
}
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// --- 型定義 ---

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

type ScheduleItem = {
  summary: string;
  start: { dateTime: string };
  end: { dateTime: string };
};

type RequestBody = {
  message: string;
  history: Message[];
  schedule?: ScheduleItem[];
};

interface GenAIError {
  status?: number;
  message?: string;
  statusText?: string;
}

// --- Type Guards (実行時型チェック関数) ---
// "any" を使わず、不明なデータ(unknown)が正しい型か厳密に検証します

function isMessage(arg: unknown): arg is Message {
  if (typeof arg !== 'object' || arg === null) return false;
  const m = arg as Record<string, unknown>;
  return (
    (m.role === 'user' || m.role === 'assistant') &&
    typeof m.content === 'string'
  );
}

function isMessageArray(arg: unknown): arg is Message[] {
  return Array.isArray(arg) && arg.every(isMessage);
}

// スケジュール情報の簡易チェック（オプショナルなデータのため）
function isScheduleItemArray(arg: unknown): arg is ScheduleItem[] {
  if (!Array.isArray(arg)) return false;
  return arg.every(item => 
    typeof item === 'object' && 
    item !== null && 
    'summary' in item
  );
}

function isGenAIError(error: unknown): error is GenAIError {
  return (
    typeof error === 'object' &&
    error !== null &&
    ('status' in error || 'message' in error)
  );
}

// --- メイン処理 ---

export async function POST(req: Request) {
  // 🔒 1. 認証チェック (Authentication)
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized: ログインが必要です" },
      { status: 401 }
    );
  }

  try {
    // 🛡️ 2. JSON解析と構造検証 (Parsing & Structure Validation)
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch (e) {
      return NextResponse.json({ error: "Invalid JSON format" }, { status: 400 });
    }

    if (typeof rawBody !== 'object' || rawBody === null) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    // プロパティへのアクセスを安全に行うため、一時的に Record 型として扱う
    const bodyMap = rawBody as Record<string, unknown>;

    // 必須フィールドのチェック
    if (typeof bodyMap.message !== 'string') {
      return NextResponse.json({ error: "Message is required and must be a string" }, { status: 400 });
    }
    if (!isMessageArray(bodyMap.history)) {
      return NextResponse.json({ error: "History must be an array of messages" }, { status: 400 });
    }
    
    // スケジュールは任意だが、存在するなら型チェック
    let validSchedule: ScheduleItem[] | undefined = undefined;
    if ('schedule' in bodyMap && isScheduleItemArray(bodyMap.schedule)) {
      validSchedule = bodyMap.schedule;
    }

    // ここで初めて型安全な変数に代入
    const safeBody: RequestBody = {
      message: bodyMap.message,
      history: bodyMap.history,
      schedule: validSchedule
    };

    // 🛡️ 3. 入力値の制約チェック (Constraint Validation)
    // 空文字チェック
    if (!safeBody.message.trim()) {
      return NextResponse.json({ error: "メッセージが空です" }, { status: 400 });
    }
    // 文字数制限 (DoS対策: 長すぎる入力は拒否)
    if (safeBody.message.length > 2000) {
      return NextResponse.json({ error: "メッセージは2000文字以内にしてください" }, { status: 400 });
    }

    // 🛡️ 4. AIモデルの準備
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

    const systemPrompt = `
あなたは、ユーザーの目標達成を支援する「戦略的タスク・アーキテクト」です。
単にスケジュールを埋めるのではなく、**「What（何をするか）」と「Why（なぜするか）」**を重視し、質の高い計画を作成してください。

### 現在の状況
- 現在時刻: ${now}
- ユーザーの既存予定: ${safeBody.schedule ? JSON.stringify(safeBody.schedule) : "なし"}

### 必須の対話フロー（この順序を守ってください）

**フェーズ1: 本質の追求（What & Why）**
ユーザーからタスクの要望があったら、まずは以下をセットで質問してください。
1. **What**: 具体的に何をしたいですか？
2. **Why**: なぜそれをやる必要がありますか？（目的・動機）

**フェーズ2: 制約と定義（Time & Goal）**
WhatとWhyが明確になったら、次に以下を質問してください。
1. **学習時間**: 確保できる時間はどれくらいですか？（または開始・終了時刻）
2. **ゴール**: 今回のセッションが終わった時、どういう状態になっていれば「完了」としますか？

**フェーズ3: プランの提案（Plan Proposal）**
ここまでの情報（Goalと時間）を元に、最適なタイムスケジュール案を提示してください。
- 視認性を高めるため絵文字を使ってください。
- 集中と休憩（ポモドーロなど）を組み込んでください。

**フェーズ4: 判定基準の合意（Judgment）**
提案したプランに対し、**「ゴール判定の基準（どうやって成果を確認するか）」**をあなたから提案し、ユーザーに合意を求めてください。

**フェーズ5: カレンダー登録（Finalization）**
ユーザーがプランと判定基準に合意したら、**最後に必ず以下のJSON形式**を出力してカレンダー登録を促してください。

\`\`\`json
[
  {
    "summary": "🎯 [Goal] React記事の執筆",
    "description": "Why: スキル定着のため\\n判定基準: 記事の下書き完了",
    "start": { "dateTime": "ISO形式" },
    "end": { "dateTime": "ISO形式" },
    "colorId": "11"
  }
]
\`\`\`

### 注意点
- JSONの日付は必ず正しいISO 8601形式（YYYY-MM-DDTHH:mm:ss+09:00）にしてください。
`;

    // 🛡️ 5. コンテキストウィンドウの保護 (Context Window Protection)
    // 履歴が長すぎるとAPIコストが増大し、エラーの原因になるため、直近10件のみ使用する
    const MAX_HISTORY_LENGTH = 10;
    const recentHistory = safeBody.history
      .slice(-MAX_HISTORY_LENGTH) 
      .filter((msg) => msg.content && msg.content.trim() !== "")
      .map((msg) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      }));

    const chat = model.startChat({
      history: [
        {
          role: "user",
          parts: [{ text: systemPrompt + "\n\nこのペルソナになりきって対話を開始してください。" }],
        },
        ...recentHistory,
      ],
    });

    // 🛡️ 6. プロンプトインジェクション対策
    // ユーザー入力をタグで囲むことで、AIに「これは命令ではなく入力値である」と認識させる効果があります
    const safePrompt = `<UserInput>${safeBody.message}</UserInput>`;

    const result = await chat.sendMessage(safePrompt);
    const response = result.response.text();

    return NextResponse.json({ reply: response });

  } catch (error: unknown) {
    // 🛡️ 7. 安全なエラーハンドリング (Secure Error Handling)
    // サーバー内部の詳細なエラーログはコンソールにのみ出し、クライアントには汎用メッセージを返す
    console.error("Chat API Error:", error);

    if (isGenAIError(error)) {
      // 429 Too Many Requests
      if (error.status === 429 || error.message?.includes('429')) {
        return NextResponse.json(
          { error: "現在AIへのアクセスが混み合っています。しばらく時間を置いてから再度お試しください。" },
          { status: 429 }
        );
      }
    }

    return NextResponse.json(
      { error: "サーバー内部でエラーが発生しました。" },
      { status: 500 }
    );
  }
}