/**
 * Deep Research API proxy
 *
 * Forward requests to the Python AI Server and stream back SSE events.
 */
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { apiError, AUTH_ERRORS, DEEP_RESEARCH_ERRORS } from "@/lib/api-errors";
import { getServerCapabilities } from "@/lib/capabilities";

const AI_SERVER_URL = process.env.AI_SERVER_URL || "http://localhost:6612";

interface ResearchRequest {
  query: string;
  arxiv_papers?: number;
  web_pages?: number;
  structured?: boolean;
  max_iterations?: number;
  projectId?: string;
}

export async function POST(req: NextRequest) {
  try {
    const caps = getServerCapabilities();
    if (!caps.deepResearchEnabled) {
      return apiError({ code: "feature.disabled", message: caps.deepResearchReason }, 403);
    }

    // Verify user login
    const session = await auth();
    if (!session?.user) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const body: ResearchRequest = await req.json();
    const { query, arxiv_papers = 10, web_pages = 10, structured = true, max_iterations = 3, projectId } = body;

    if (!query?.trim()) {
      return apiError(DEEP_RESEARCH_ERRORS.QUERY_REQUIRED, 400);
    }

    // Forward to AI Server
    const response = await fetch(`${AI_SERVER_URL}/api/deep-research/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        arxiv_papers,
        web_pages,
        structured,
        max_iterations,
        projectId: projectId || "",
      }),
    });

    if (!response.ok) {
      return apiError(DEEP_RESEARCH_ERRORS.AI_SERVER_ERROR, 502, { status: response.status });
    }

    // Stream-forward SSE
    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            controller.enqueue(new TextEncoder().encode(chunk));
          }
        } catch (error) {
          console.error("Stream error:", error);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("Deep research error:", error);
    return apiError(DEEP_RESEARCH_ERRORS.STREAM_FAILED, 500);
  }
}
