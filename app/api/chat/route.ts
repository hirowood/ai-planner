import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

// Geminiの準備
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

// 型定義を作成
type Message = {
  role: 'user' | 'assistant';
  content: string;
};

export async function POST(req: Request) {
  try {
    // リクエストの型を想定して受け取る
    const body = await req.json();
    const { message, history } = body as { message: string; history: Message[] };

    // モデルの設定
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    // AIへの「役割」の指示
    const systemPrompt = `
あなたは「無理のない計画」を立てるのを手伝う、優しいプランニング・パートナーです。
ユーザーが「これをやりたい」と言ったら、そのままタスクリストに入れるのではなく、以下のように対話してください。

1. **見積もりの確認**: 「それは何分くらいかかりそうですか？」と聞いてください。
2. **分解の提案**: タスクが大きすぎる（例：「アプリを作る」など）場合は、「まずは環境構築から始めませんか？」のように小さく分解することを提案してください。
3. **共感と調整**: ユーザーが「疲れている」「時間がない」と言ったら、タスクを減らすか、明日に回すよう優しく提案してください。
4. **トーン**: 親しみやすく、でも論理的に整理してくれるコーチのような口調で話してください。
`;

    // 過去の会話履歴を含めてチャットを開始
    const chat = model.startChat({
      history: [
        {
          role: "user",
          parts: [{ text: systemPrompt + "\n\nこれからの会話はこの設定に従ってください。" }],
        },
        {
          role: "model",
          parts: [{ text: "承知いたしました。無理のない計画づくりをサポートします。今やりたいことや、目標を教えてください。" }],
        },
        // ここで型定義を使用
        ...history.map((msg: Message) => ({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        })),
      ],
    });

    // メッセージを送信して返答をもらう
    const result = await chat.sendMessage(message);
    const response = result.response.text();

    return NextResponse.json({ reply: response });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "AIとの通信に失敗しました" }, { status: 500 });
  }
}