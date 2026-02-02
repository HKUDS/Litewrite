/**
 * TAP completion API proxy
 *
 * The frontend sends prefix/suffix/preamble directly, and the backend forwards to the Python TAP Server.
 * This avoids context mismatch caused by Yjs sync latency.
 *
 * TAP completion is free.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { apiError, AUTH_ERRORS, TAP_ERRORS } from "@/lib/api-errors";
import { getServerCapabilities } from "@/lib/capabilities";

const TAP_SERVER_URL = process.env.TAP_SERVER_URL || "http://localhost:6612";

interface TapRequest {
  projectId: string;
  fileId: string;
  prefix: string;
  suffix: string;
  preamble?: string;
}

interface TapServerResponse {
  latency_ms: number;
  should_complete?: boolean;
  confidence?: number;
  proposed_changes?: {
    prefix_diff: DiffSegment[];
    inserted_text: string;
    suffix_diff: DiffSegment[];
  };
  raw_model_output?: {
    revised_prefix: string;
    inserted_text: string;
    revised_suffix: string;
  };
  usage?: {
    model: string;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    api_cost: number;
  };
  reason?: string;
}

interface DiffSegment {
  op: "equal" | "replace" | "insert" | "delete";
  text?: string;
  original?: string;
  revised?: string;
}

export async function POST(req: NextRequest) {
  try {
    const caps = getServerCapabilities();
    if (!caps.aiEnabled) {
      return apiError({ code: "feature.disabled", message: caps.aiReason }, 403);
    }

    // Verify user login (NextAuth v5)
    const session = await auth();
    if (!session?.user) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const body = await req.json();
    const { projectId, fileId, prefix, suffix, preamble } = body as TapRequest;

    // Param validation: prefix and suffix are required
    if (!projectId) {
      return apiError(TAP_ERRORS.PROJECT_ID_REQUIRED, 400);
    }
    if (!fileId) {
      return apiError(TAP_ERRORS.FILE_ID_REQUIRED, 400);
    }

    if (!prefix && !suffix) {
      return apiError(TAP_ERRORS.CONTENT_REQUIRED, 400);
    }

    // Forward directly to the Python TAP Server
    const tapResponse = await fetch(`${TAP_SERVER_URL}/api/tap/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preamble: preamble || "",
        prefix: prefix || "",
        suffix: suffix || "",
        projectId: projectId || "",
      }),
      signal: AbortSignal.timeout(30000), // 30s timeout (LLM may be slow)
    });

    if (!tapResponse.ok) {
      return apiError(TAP_ERRORS.SERVER_ERROR, 502, { status: tapResponse.status });
    }

    const result: TapServerResponse = await tapResponse.json();

    return NextResponse.json(result);

  } catch (error) {
    // Distinguish different error types
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return apiError(TAP_ERRORS.TIMEOUT, 504);
      }
      if (error.message.includes("fetch")) {
        return apiError(TAP_ERRORS.SERVER_NOT_AVAILABLE, 503);
      }
    }

    return apiError(TAP_ERRORS.REQUEST_FAILED, 500);
  }
}

/**
 * Health check endpoint
 */
export async function GET() {
  try {
    // Check whether the TAP server is available
    const tapHealthResponse = await fetch(`${TAP_SERVER_URL}/docs`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);

    return NextResponse.json({
      status: "ok",
      tapServer: tapHealthResponse?.ok ? "connected" : "disconnected",
      config: {
        tapServerUrl: TAP_SERVER_URL,
      }
    });
  } catch {
    return NextResponse.json({
      status: "error",
      tapServer: "unknown",
    });
  }
}
