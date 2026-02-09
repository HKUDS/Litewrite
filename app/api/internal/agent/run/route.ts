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
 * Session support: when sessionId is provided, the agent uses the session's
 * conversation history for context. When not provided, a new session named
 * "nanobot" is created. The session is saved after each interaction so it
 * appears in the web UI's Conversation History.
 *
 * This is NOT exposed to the public - protected by INTERNAL_API_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  createSession,
  getSessionById,
  addUserMessage,
  addAssistantMessage,
} from "@/lib/ask-session";
import type { SessionMessageItem } from "@/types/ask";

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
  sessionId?: string;
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
    const { projectId, userId, message, mode, referencedFiles, sessionId } =
      body;

    if (!projectId || !message) {
      return NextResponse.json({
        success: false,
        error: "projectId and message are required",
      });
    }

    const effectiveUserId = userId || "";

    console.log(
      `[Internal/AgentRun] Invoking agent: project=${projectId}, mode=${mode || "agent"}, message_len=${message.length}, sessionId=${sessionId || "(new)"}`
    );

    // ---------------------------------------------------------------
    // Session management: load or create session
    // ---------------------------------------------------------------
    let currentSessionId = sessionId || "";
    let conversationHistory: Array<{ role: string; content: string }> | null =
      null;

    if (effectiveUserId) {
      if (currentSessionId) {
        // Load existing session
        const session = await getSessionById(
          projectId,
          effectiveUserId,
          currentSessionId
        );
        if (session) {
          // Build conversation history from session messages
          conversationHistory = session.messages
            .map((msg) => {
              const textContent = msg.items
                ?.filter(
                  (item: SessionMessageItem) => item.type === "text"
                )
                .map(
                  (item: SessionMessageItem) =>
                    item.type === "text" ? item.content : ""
                )
                .join("");
              return {
                role: msg.role,
                content: textContent || msg.content || "",
              };
            })
            .filter((m) => m.content);

          console.log(
            `[Internal/AgentRun] Loaded session ${currentSessionId}: ${conversationHistory.length} history messages`
          );
        } else {
          console.warn(
            `[Internal/AgentRun] Session ${currentSessionId} not found, creating new`
          );
          currentSessionId = "";
        }
      }

      if (!currentSessionId) {
        // Create a new session named "nanobot"
        const newSession = await createSession(
          projectId,
          effectiveUserId,
          "nanobot"
        );
        currentSessionId = newSession.id;
        console.log(
          `[Internal/AgentRun] Created new session: ${currentSessionId}`
        );
      }

      // Save the user message to the session
      await addUserMessage(
        projectId,
        effectiveUserId,
        currentSessionId,
        message
      );
    }

    // ---------------------------------------------------------------
    // Build request for ai-server's sync endpoint
    // ---------------------------------------------------------------
    const aiServerPayload: Record<string, unknown> = {
      projectId,
      userId: effectiveUserId,
      message,
      mode: mode || "agent",
      referencedFiles: referencedFiles || [],
    };

    if (conversationHistory && conversationHistory.length > 0) {
      aiServerPayload.conversationHistory = conversationHistory;
    }

    // Call ai-server's synchronous endpoint
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

    try {
      const response = await fetch(`${AI_SERVER_URL}/api/chat/run-sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.INTERNAL_API_SECRET
            ? { "X-Internal-Secret": process.env.INTERNAL_API_SECRET }
            : {}),
        },
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
          sessionId: currentSessionId || undefined,
        });
      }

      const result = await response.json();

      console.log(
        `[Internal/AgentRun] Agent completed: success=${result.success}, response_len=${result.response?.length || 0}`
      );

      // ---------------------------------------------------------------
      // Save assistant response to session
      // ---------------------------------------------------------------
      if (effectiveUserId && currentSessionId && result.response) {
        const assistantItems: SessionMessageItem[] = [
          { type: "text", content: result.response },
        ];
        await addAssistantMessage(
          projectId,
          effectiveUserId,
          currentSessionId,
          assistantItems
        );
        console.log(
          `[Internal/AgentRun] Saved assistant message to session ${currentSessionId}`
        );
      }

      return NextResponse.json({
        ...result,
        sessionId: currentSessionId || undefined,
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);

      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        console.error(
          `[Internal/AgentRun] Timeout after ${AGENT_TIMEOUT_MS / 1000}s`
        );
        return NextResponse.json({
          success: false,
          error: `Agent execution timed out after ${AGENT_TIMEOUT_MS / 1000} seconds`,
          sessionId: currentSessionId || undefined,
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
