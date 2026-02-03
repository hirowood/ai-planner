import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route"; // 認証設定を読み込み

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

type Message = { role: 'user' | 'assistant'; content: string };
type ScheduleItem = { summary: string; start: { dateTime: string }; end: { dateTime: string } };

export async function POST(req: Request) {
  // 🔒 セキュリティチェック: ログインしていないアクセスをここで弾く
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized: ログインが必要です" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { message, history, schedule } = body as { 
      message: string; 
      history: Message[];
      schedule?: ScheduleItem[];
    };

    // 🛡️ 入力チェック: メッセージが空、または長すぎる場合の対策
    if (!message || message.trim().length === 0) {
      return NextResponse.json({ error: "メッセージが空です" }, { status: 400 });
    }
    if (message.length > 2000) { // 異常に長い入力を防ぐ
      return NextResponse.json({ error: "メッセージが長すぎます" }, { status: 400 });
    }

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

    const chat = model.startChat({
      history: [
        {
          role: "user",
          parts: [{ text: systemPrompt + "\n\nこのペルソナになりきって対話を開始してください。" }],
        },
        ...history
          .filter(msg => msg.content && msg.content.trim() !== "")
          .map((msg: Message) => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }],
          })),
      ],
    });

    const result = await chat.sendMessage(message);
    const response = result.response.text();

    return NextResponse.json({ reply: response });

  } catch (error) {
    // 🛡️ エラー情報の隠蔽: ユーザーには詳細なスタックトレースを見せない
    console.error("Server Error:", error);
    return NextResponse.json({ error: "処理中にエラーが発生しました。" }, { status: 500 });
  }
}