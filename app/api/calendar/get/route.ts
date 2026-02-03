import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../auth/[...nextauth]/route";

// このAPIルートは常に動的に実行する必要がある（キャッシュ無効化）
export const dynamic = 'force-dynamic';

// --- 型定義 ---

// 必要なイベント情報の型（Google APIのレスポンス構造の一部）
interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  htmlLink?: string;
}

// カレンダーリスト取得APIのレスポンス型
interface GoogleCalendarListResponse {
  kind: string;
  items: GoogleCalendarEvent[];
}

// --- Type Guards (型ガード) ---

function isGoogleCalendarListResponse(data: unknown): data is GoogleCalendarListResponse {
  if (typeof data !== 'object' || data === null) return false;
  const list = data as Record<string, unknown>;
  
  return (
    list.kind === 'calendar#events' &&
    Array.isArray(list.items)
  );
}

// --- メイン処理 ---

export async function GET() {
  try {
    // 🔒 1. 認証チェック
    const session = await getServerSession(authOptions);

    if (!session || !session.accessToken) {
      return NextResponse.json({ error: "Unauthorized: ログインが必要です" }, { status: 401 });
    }

    // 🕒 2. パラメータ設定
    // 今日の日付 (ISO形式)
    const now = new Date();
    const timeMin = now.toISOString();

    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.append("timeMin", timeMin);
    url.searchParams.append("maxResults", "10"); // 直近10件
    url.searchParams.append("singleEvents", "true"); // 繰り返し予定を展開する
    url.searchParams.append("orderBy", "startTime");

    // 📡 3. Google APIへのリクエスト
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "Content-Type": "application/json",
      },
      // キャッシュを明示的に無効化
      cache: "no-store", 
    });

    const data: unknown = await response.json();

    // 🚨 4. Google APIのエラーハンドリング
    if (!response.ok) {
      const errorData = data as { error?: { message?: string; code?: number } };
      const errorMessage = errorData?.error?.message || "Google Calendar API Error";
      
      console.error("Google API Error:", errorMessage);

      // トークン期限切れ(401)の場合は、クライアント側で再ログインが必要なため
      // ステータスコードをそのまま中継する
      if (response.status === 401) {
        return NextResponse.json({ error: "Token expired", details: errorMessage }, { status: 401 });
      }

      return NextResponse.json({ error: "Failed to fetch calendar", details: errorMessage }, { status: response.status });
    }

    // 🛡️ 5. レスポンスデータの検証 (Validation)
    if (!isGoogleCalendarListResponse(data)) {
      console.error("Invalid Google API Response format:", data);
      return NextResponse.json({ error: "Invalid data format received from Google" }, { status: 502 });
    }

    // ✅ 6. データを返却
    // 型ガードを通過しているので、data.items は安全にアクセス可能
    return NextResponse.json(data.items);

  } catch (error: unknown) {
    console.error("Internal Server Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}