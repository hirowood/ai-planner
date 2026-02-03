import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../auth/[...nextauth]/route";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session || !session.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { events } = await req.json(); // フロントエンドから予定のリストを受け取る

    // 複数の予定を順番に登録する
    const results = [];
    for (const event of events) {
      const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      });
      const data = await response.json();
      results.push(data);
    }

    return NextResponse.json({ success: true, results });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to create events" }, { status: 500 });
  }
}