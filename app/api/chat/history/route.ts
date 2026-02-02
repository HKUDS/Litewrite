/**
 * Chat History API
 * =================
 *
 * Endpoints for managing session's compressedHistory.
 * Called by frontend when AI server compresses the history.
 *
 * Endpoints:
 * - PATCH: Update compressedHistory after compression
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { replaceCompressedHistory, getSessionById } from "@/lib/ask-session";
import { apiError, AUTH_ERRORS, CHAT_ERRORS } from "@/lib/api-errors";
import { getServerCapabilities } from "@/lib/capabilities";

// ============================================================================
// PATCH - Update compressedHistory
// ============================================================================

export async function PATCH(request: NextRequest) {
  try {
    const caps = getServerCapabilities();
    if (!caps.aiEnabled) {
      return apiError({ code: "feature.disabled", message: caps.aiReason }, 403);
    }

    // Authenticate user
    const session = await auth();
    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const userId = session.user.id;
    const body = await request.json();

    const {
      projectId,
      sessionId,
      compressedHistory,
      historyTokens,
    } = body;

    // Validate required fields
    if (!projectId || !sessionId || compressedHistory === undefined) {
      return apiError(CHAT_ERRORS.HISTORY_UPDATE_PARAMS_REQUIRED, 400);
    }

    // Update the session's compressedHistory
    const updatedSession = await replaceCompressedHistory(
      projectId,
      userId,
      sessionId,
      compressedHistory,
      historyTokens || 0
    );

    if (!updatedSession) {
      return apiError(CHAT_ERRORS.SESSION_NOT_FOUND, 404);
    }

    return NextResponse.json({
      success: true,
      historyTokens: updatedSession.historyTokens,
    });

  } catch (error) {
    console.error("[/api/chat/history] PATCH error:", error);
    return apiError(CHAT_ERRORS.HISTORY_UPDATE_FAILED, 500);
  }
}

// ============================================================================
// GET - Get current compressedHistory (for debugging)
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const caps = getServerCapabilities();
    if (!caps.aiEnabled) {
      return apiError({ code: "feature.disabled", message: caps.aiReason }, 403);
    }

    const session = await auth();
    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const userId = session.user.id;
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const sessionId = searchParams.get("sessionId");

    if (!projectId || !sessionId) {
      return apiError(CHAT_ERRORS.PROJECT_AND_SESSION_ID_REQUIRED, 400);
    }

    const askSession = await getSessionById(projectId, userId, sessionId);
    if (!askSession) {
      return apiError(CHAT_ERRORS.SESSION_NOT_FOUND, 404);
    }

    return NextResponse.json({
      compressedHistory: askSession.compressedHistory || "",
      historyTokens: askSession.historyTokens || 0,
    });

  } catch (error) {
    console.error("[/api/chat/history] GET error:", error);
    return apiError(CHAT_ERRORS.HISTORY_GET_FAILED, 500);
  }
}
