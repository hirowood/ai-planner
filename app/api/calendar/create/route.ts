import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../auth/[...nextauth]/route";
import { startPerf } from "../../../../lib/perf";

// --- 型定義 ---

// Google Calendar APIが要求する最小限の構造定義
type GoogleDate = { dateTime: string } | { date: string };

type CalendarEventInput = {
  summary: string;
  description?: string;
  start: GoogleDate;
  end: GoogleDate;
  colorId?: string;
};

type CreateResult = {
  summary: string;
  status: 'success' | 'error';
  data?: unknown;
  error?: string;
};

// --- Type Guards (型ガード) ---

function isGoogleDate(arg: unknown): arg is GoogleDate {
  if (typeof arg !== 'object' || arg === null) return false;
  const d = arg as Record<string, unknown>;
  return typeof d.dateTime === 'string' || typeof d.date === 'string';
}

function isCalendarEventInput(arg: unknown): arg is CalendarEventInput {
  if (typeof arg !== 'object' || arg === null) return false;
  const e = arg as Record<string, unknown>;
  return (
    typeof e.summary === 'string' &&
    isGoogleDate(e.start) &&
    isGoogleDate(e.end)
  );
}

function isEventArray(arg: unknown): arg is CalendarEventInput[] {
  return Array.isArray(arg) && arg.every(isCalendarEventInput);
}

// --- メイン処理 ---

type Perf = ReturnType<typeof startPerf>;

// 計測はここで一括して行う: handle のどの return 経路でも `[perf]` 行が 1 行出る
export async function POST(req: Request) {
  const perf = startPerf("api/calendar/create", ["calendar_ms"]);
  try {
    return perf.finish(await handle(req, perf));
  } catch (error: unknown) {
    perf.finish(new Response(null, { status: 500 }));
    throw error;
  }
}

async function handle(req: Request, perf: Perf): Promise<NextResponse> {
  // 🔒 1. 認証チェック
  const session = await getServerSession(authOptions);

  if (!session || !session.user || !session.accessToken) {
    return NextResponse.json({ error: "Unauthorized: ログインが必要です" }, { status: 401 });
  }

  try {
    // 🛡️ 2. JSONパースと構造検証
    let body: unknown;
    try {
      body = await req.json();
    } catch (e) {
      return NextResponse.json({ error: "Invalid JSON format" }, { status: 400 });
    }

    if (typeof body !== 'object' || body === null || !('events' in body)) {
      return NextResponse.json({ error: "Missing 'events' field" }, { status: 400 });
    }

    const rawEvents = (body as { events: unknown }).events;

    // 配列であるか、中身が正しいかチェック
    if (!isEventArray(rawEvents)) {
      return NextResponse.json({ error: "Invalid event data structure" }, { status: 400 });
    }

    // 🛡️ 3. 制約チェック (DoS対策/API制限対策)
    // 一度に大量の登録リクエストが来たら拒否する
    if (rawEvents.length > 20) {
      return NextResponse.json({ error: "一度に登録できるイベントは20件までです" }, { status: 400 });
    }

    // 🔄 4. 登録処理ループ
    // 1件ずつ処理し、成功/失敗を個別に記録する
    const results: CreateResult[] = [];
    let successCount = 0;

    for (const event of rawEvents) {
      try {
        // Calendar の時間 = 全イベント分の (fetch + 応答本文の受信) の合計
        const { response, data } = await perf.time("calendar_ms", async () => {
          const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(event),
          });
          const data: unknown = await response.json();
          return { response, data };
        });

        if (!response.ok) {
          // Google APIからのエラーレスポンス
          const errorMsg = (data as { error?: { message?: string } })?.error?.message || "Unknown API Error";
          // 予定のタイトルはログに出さない (実行ログの回収で予定の内容が外へ出るため)
          console.error("Failed to create calendar event:", errorMsg);
          
          results.push({
            summary: event.summary,
            status: 'error',
            error: errorMsg
          });
        } else {
          // 成功
          successCount++;
          results.push({
            summary: event.summary,
            status: 'success',
            data: data
          });
        }
      } catch (fetchError: unknown) {
        // 通信エラーなど
        console.error("Network error creating calendar event:", fetchError);
        results.push({
          summary: event.summary,
          status: 'error',
          error: "Network or Server Error"
        });
      }
    }

    // ✅ 5. 結果返却
    // 一部失敗しても、全体としては 200 OK (または 207 Multi-Status) を返し、
    // フロントエンド側で「○件成功、×件失敗」と表示させるのが親切です。
    return NextResponse.json({
      success: successCount > 0,
      message: `${rawEvents.length}件中 ${successCount}件 の登録に成功しました`,
      results,
    });

  } catch (error: unknown) {
    console.error("Critical Server Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}