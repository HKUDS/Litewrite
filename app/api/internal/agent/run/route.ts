/**
 * Internal API: Run Litewrite AI Agent (Synchronous)
 * ====================================================
 *
 * Internal endpoint for nanobot to invoke litewrite's built-in AI agent.
 * Proxies to ai-server's /api/chat/run-sync endpoint.
 *
 * The agent runs in direct-apply mode: file edits are written directly
 * to storage instead of creating shadow documents.
 *
 * This is NOT exposed to the public - protected by INTERNAL_API_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";

const AI_SERVER_URL = process.env.AI_SERVER_URL || "http://localhost:6612";

// Timeout for agent execution (5 minutes)
const AGENT_TIMEOUT_MS = 300_000;

// Verify internal API secret
function verifyInternalAuth(request: NextRequest): boolean {
  const secret = request.headers.get("X-Internal-Secret");
  const expectedSecret = process.env.INTERNAL_API_SECRET;

  if (!expectedSecret) {
    console.warn("[Internal API] INTERNAL_API_SECRET not configured");
    return false;
  }

  return secret === expectedSecret;
}

interface AgentRunRequest {
  projectId: string;
  userId?: string;
  message: string;
  mode?: "ask" | "agent";
  referencedFiles?: string[];
}

export async function POST(request: NextRequest) {
  // Verify authentication
  if (!verifyInternalAuth(request)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const body = (await request.json()) as AgentRunRequest;
    const { projectId, userId, message, mode, referencedFiles } = body;

    if (!projectId || !message) {
      return NextResponse.json({
        success: false,
        error: "projectId and message are required",
      });
    }

    console.log(
      `[Internal/AgentRun] Invoking agent: project=${projectId}, mode=${mode || "agent"}, message_len=${message.length}`
    );

    // Build request for ai-server's sync endpoint
    const aiServerPayload = {
      projectId,
      userId: userId || "",
      message,
      mode: mode || "agent",
      referencedFiles: referencedFiles || [],
    };

    // Call ai-server's synchronous endpoint
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

    try {
      const response = await fetch(`${AI_SERVER_URL}/api/chat/run-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(aiServerPayload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[Internal/AgentRun] AI server error ${response.status}: ${errorText.slice(0, 500)}`
        );
        return NextResponse.json({
          success: false,
          error: `AI server returned ${response.status}`,
        });
      }

      const result = await response.json();

      console.log(
        `[Internal/AgentRun] Agent completed: success=${result.success}, response_len=${result.response?.length || 0}`
      );

      return NextResponse.json(result);
    } catch (fetchError) {
      clearTimeout(timeoutId);

      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        console.error(
          `[Internal/AgentRun] Timeout after ${AGENT_TIMEOUT_MS / 1000}s`
        );
        return NextResponse.json({
          success: false,
          error: `Agent execution timed out after ${AGENT_TIMEOUT_MS / 1000} seconds`,
        });
      }

      throw fetchError;
    }
  } catch (error) {
    console.error("[Internal/AgentRun] Error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
