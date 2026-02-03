import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../auth/[...nextauth]/route";

export async function GET() {
  // 1. ログインしているかチェック
  const session = await getServerSession(authOptions);

  if (!session || !session.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 2. 今日の日付を取得 (ISO形式)
    const now = new Date();
    const timeMin = now.toISOString();

    // 3. Googleカレンダーから予定を取得
    // 直近10件、開始時間順で取得します
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.append("timeMin", timeMin);
    url.searchParams.append("maxResults", "10");
    url.searchParams.append("singleEvents", "true");
    url.searchParams.append("orderBy", "startTime");

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || "Failed to fetch calendar");
    }

    // 4. データを返却
    return NextResponse.json(data.items);

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}