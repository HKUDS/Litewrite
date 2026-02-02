import { NextResponse } from "next/server";

// AI Server URL
const AI_SERVER_URL = process.env.AI_SERVER_URL || "http://localhost:8000";

/**
 * GET /api/internal/chat-config
 *
 * Returns chat configuration from AI server.
 * This allows frontend to sync with backend configuration (e.g., context limits).
 */
export async function GET() {
  try {
    // Fetch config from AI server
    const response = await fetch(`${AI_SERVER_URL}/api/chat/config`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      // Fallback to default values if AI server is unavailable
      console.warn("[chat-config] AI server unavailable, using defaults");
      return NextResponse.json({
        historyLimit: 64000,
        executionLimit: 64000,
        compressionThreshold: 0.95,
      });
    }

    const config = await response.json();
    return NextResponse.json(config);
  } catch (error) {
    console.error("[chat-config] Error fetching config:", error);
    // Return defaults on error
    return NextResponse.json({
      historyLimit: 64000,
      executionLimit: 64000,
      compressionThreshold: 0.95,
    });
  }
}
