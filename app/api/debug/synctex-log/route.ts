import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * POST /api/debug/synctex-log - receives frontend SyncTeX debug logs.
 * Intended for admins only; logs are printed to server stdout (viewable via docker logs).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    // Only allow authenticated users to send logs (optional: restrict to admins).
    if (!session?.user?.id) {
      return NextResponse.json({ success: false }, { status: 401 });
    }

    const body = await request.json();
    const { logs, context } = body;

    // Print to server logs (viewable via docker logs).
    const timestamp = new Date().toISOString();
    const userId = session.user.id;
    const userEmail = session.user.email || "unknown";

    console.log(`\n========== [SyncTeX Debug] ${timestamp} ==========`);
    console.log(`User: ${userEmail} (${userId})`);
    if (context) {
      console.log(`Context: ${JSON.stringify(context)}`);
    }
    console.log("--- Logs ---");
    if (Array.isArray(logs)) {
      logs.forEach((log: string, i: number) => {
        console.log(`  ${i + 1}. ${log}`);
      });
    } else {
      console.log(logs);
    }
    console.log("============================================\n");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[SyncTeX Debug] Error:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
