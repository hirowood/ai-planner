import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";

// 環境変数の型チェック（起動時にチェックするのが理想ですが、ここでは簡易的に）
if (!process.env.GOOGLE_API_KEY) {
  throw new Error("GOOGLE_API_KEY is not defined");
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

// Google Generative AIのエラー構造に近い型定義
interface GenAIError {
  status?: number;
  message?: string;
  statusText?: string;
}

// 型ガード関数: エラーオブジェクトが GenAIError の形状をしているか判定
function isGenAIError(error: unknown): error is GenAIError {
  return (
    typeof error === 'object' &&
    error !== null &&
    ('status' in error || 'message' in error)
  );
}

export async function POST(req: Request) {
  // 🔒 1. 認証チェック
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized: ログインが必要です" },
      { status: 401 }
    );
  }

  try {
    // 🛡️ 2. リクエストボディの安全な取得
    const body = (await req.json()) as RequestBody;
    const { message, history, schedule } = body;

    // 🛡️ 3. 入力バリデーション
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json(
        { error: "有効なメッセージを入力してください" },
        { status: 400 }
      );
    }
    if (message.length > 2000) {
      return NextResponse.json(
        { error: "メッセージが長すぎます（2000文字以下にしてください）" },
        { status: 400 }
      );
    }

    // モデル指定: ユーザー指定の gemini-2.5-flash
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

    const systemPrompt = `
あなたは、ユーザーの目標達成を支援する「戦略的タスク・アーキテクト」です。
単にスケジュールを埋めるのではなく、**「What（何をするか）」と「Why（なぜするか）」**を重視し、質の高い計画を作成してください。

### 現在の状況
- 現在時刻: ${now}
- ユーザーの既存予定: ${schedule ? JSON.stringify(schedule) : "なし"}

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

    // チャット履歴の構築（空メッセージの除外）
    const cleanHistory = history
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
        ...cleanHistory,
      ],
    });

    const result = await chat.sendMessage(message);
    const response = result.response.text();

    return NextResponse.json({ reply: response });

  } catch (error: unknown) {
    // 🛡️ 4. 型安全なエラーハンドリング
    console.error("Chat API Error:", error);

    // 型ガードを使ってエラーオブジェクトのプロパティを安全にチェック
    if (isGenAIError(error)) {
      // 429 Too Many Requests (Rate Limit)
      if (error.status === 429 || error.message?.includes('429')) {
        return NextResponse.json(
          { error: "AIの利用制限に達しました。しばらく時間を置いてから再度お試しください。" },
          { status: 429 }
        );
      }
    }

    // 内部エラーの詳細はユーザーに見せず、汎用的なメッセージを返す
    return NextResponse.json(
      { error: "サーバー内部でエラーが発生しました。" },
      { status: 500 }
    );
  }
}