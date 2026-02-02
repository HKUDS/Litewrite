/**
 * AI Table Chat API Route (Proxy Mode)
 *
 * Proxies requests to the Python backend and returns a Vercel AI SDK-compatible response format.
 *
 * @deprecated This standalone Table API is deprecated.
 * Use /api/chat with Agent mode instead.
 * This route is kept for backwards compatibility but may be removed in future versions.
 */

import { proxyToBackend, getBackendUrl } from "@/lib/ai-proxy-utils"

export const maxDuration = 300

async function handleChatRequest(req: Request): Promise<Response> {
    const { messages, sessionId } = await req.json()

    // Proxy request to the Python backend.
    const backendUrl = getBackendUrl("/api/ai-table/chat")

    return proxyToBackend(backendUrl, {
        messages,
        sessionId,
    })
}

function handleError(error: unknown): Response {
    console.error("Error in ai-table chat route:", error)

    const isDev = process.env.NODE_ENV === "development"
    const message =
        error instanceof Error ? error.message : "An unexpected error occurred"
    const status = (error as any)?.statusCode || (error as any)?.status || 500

    const lowerMessage = message.toLowerCase()
    const safeMessage =
        lowerMessage.includes("key") ||
        lowerMessage.includes("token") ||
        lowerMessage.includes("sig") ||
        lowerMessage.includes("signature") ||
        lowerMessage.includes("secret") ||
        lowerMessage.includes("password") ||
        lowerMessage.includes("credential")
            ? "Authentication failed. Please check your credentials."
            : message

    return Response.json(
        {
            error: safeMessage,
            ...(isDev && {
                details: message,
                stack: error instanceof Error ? error.stack : undefined,
            }),
        },
        { status },
    )
}

async function safeHandler(req: Request): Promise<Response> {
    try {
        return await handleChatRequest(req)
    } catch (error) {
        return handleError(error)
    }
}

export async function POST(req: Request) {
    return safeHandler(req)
}
