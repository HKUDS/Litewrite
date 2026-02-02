/**
 * AI Proxy Utilities
 *
 * Converts SSE responses from the Python backend into a format compatible with Vercel AI SDK 5.x.
 * Uses UI Message Stream Protocol v1.
 */

// Python backend SSE event types
export type BackendEventType =
    | "text_delta"
    | "tool_call_start"
    | "tool_call_delta"
    | "tool_call_end"
    | "tool_result"
    | "finish"
    | "error"

export interface BackendEvent {
    type: BackendEventType
    data: Record<string, any>
}

/**
 * AI SDK 5.x UI Message Stream v1 event types.
 * https://v5.ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
 *
 * Tool-related events use the tool-input-* and tool-output-* naming.
 */
type UIStreamEvent =
    | { type: "start"; messageId: string }
    | { type: "text-start"; id: string }
    | { type: "text-delta"; id: string; delta: string }
    | { type: "text-end"; id: string }
    | { type: "tool-input-start"; toolCallId: string; toolName: string }
    | { type: "tool-input-delta"; toolCallId: string; inputTextDelta: string }
    | { type: "tool-input-available"; toolCallId: string; toolName: string; input: Record<string, any> }
    | { type: "tool-output-available"; toolCallId: string; output: any }
    | { type: "finish"; finishReason: string }
    | { type: "error"; errorText: string }

/**
 * Convert a UI Stream event to an SSE-formatted string.
 */
function toSSE(event: UIStreamEvent): string {
    return `data: ${JSON.stringify(event)}\n\n`
}

/**
 * Parse an SSE line.
 */
function parseSSELine(line: string): { event?: string; data?: string } {
    if (line.startsWith("event: ")) {
        return { event: line.slice(7) }
    }
    if (line.startsWith("data: ")) {
        return { data: line.slice(6) }
    }
    return {}
}

/**
 * Parse backend SSE stream and yield Backend events.
 */
export async function* parseBackendSSE(
    response: Response
): AsyncGenerator<BackendEvent> {
    const reader = response.body?.getReader()
    if (!reader) {
        throw new Error("No response body")
    }

    const decoder = new TextDecoder()
    let buffer = ""
    let currentEvent = ""
    let readCount = 0

    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) {
                console.log("[SSE Parser] Stream done. Total reads:", readCount)
                break
            }

            readCount++
            const chunk = decoder.decode(value, { stream: true })
            if (readCount <= 2) {
                console.log(`[SSE Parser] Read #${readCount}, chunk length: ${chunk.length}`)
            }

            buffer += chunk
            const lines = buffer.split("\n")
            buffer = lines.pop() || ""

            for (const line of lines) {
                const trimmed = line.trim()
                if (!trimmed) {
                    // Empty line indicates end of an event
                    continue
                }

                const { event, data } = parseSSELine(trimmed)

                if (event) {
                    currentEvent = event
                }

                if (data && currentEvent) {
                    try {
                        const parsed = JSON.parse(data)
                        yield {
                            type: currentEvent as BackendEventType,
                            data: parsed.data || parsed,
                        }
                    } catch (e) {
                        console.error("Failed to parse SSE data:", data, e)
                    }
                }
            }
        }

        // Process remaining buffer
        if (buffer.trim()) {
            console.log("[SSE Parser] Processing remaining buffer:", buffer.slice(0, 100))
            const { data } = parseSSELine(buffer.trim())
            if (data && currentEvent) {
                try {
                    const parsed = JSON.parse(data)
                    yield {
                        type: currentEvent as BackendEventType,
                        data: parsed.data || parsed,
                    }
                } catch (e) {
                    console.error("Failed to parse final SSE data:", data, e)
                }
            }
        }
    } finally {
        reader.releaseLock()
    }
}

/**
 * Stateful stream converter.
 * Converts backend events into AI SDK 5.x UI Message Stream v1 format.
 */
class StreamConverter {
    private messageStarted = false
    private textBlockStarted = false
    private messageId: string
    private textBlockId: string

    constructor() {
        this.messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        this.textBlockId = `text_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    }

    /**
     * Convert backend events into AI SDK 5.x SSE chunks.
     */
    convert(event: BackendEvent): string[] {
        const chunks: string[] = []

        switch (event.type) {
            case "text_delta": {
                const content = event.data.content || ""
                if (!content) break

                // First text: send start and text-start
                if (!this.messageStarted) {
                    this.messageStarted = true
                    chunks.push(toSSE({ type: "start", messageId: this.messageId }))
                }

                if (!this.textBlockStarted) {
                    this.textBlockStarted = true
                    chunks.push(toSSE({ type: "text-start", id: this.textBlockId }))
                }

                // Send text delta
                chunks.push(toSSE({ type: "text-delta", id: this.textBlockId, delta: content }))
                break
            }

            case "tool_call_start": {
                // Ensure the message has started
                if (!this.messageStarted) {
                    this.messageStarted = true
                    chunks.push(toSSE({ type: "start", messageId: this.messageId }))
                }

                // If a text block is active, end it first
                if (this.textBlockStarted) {
                    this.textBlockStarted = false
                    chunks.push(toSSE({ type: "text-end", id: this.textBlockId }))
                }

                const toolCallId = event.data.toolCallId || ""
                const toolName = event.data.toolName || ""
                // AI SDK 5.x uses tool-input-start
                chunks.push(toSSE({ type: "tool-input-start", toolCallId, toolName }))
                break
            }

            case "tool_call_delta": {
                const toolCallId = event.data.toolCallId || ""
                const argsDelta = event.data.argsDelta || ""
                if (argsDelta) {
                    // AI SDK 5.x uses tool-input-delta and inputTextDelta
                    chunks.push(toSSE({ type: "tool-input-delta", toolCallId, inputTextDelta: argsDelta }))
                }
                break
            }

            case "tool_call_end": {
                const toolCallId = event.data.toolCallId || ""
                const toolName = event.data.toolName || ""
                const args = event.data.args || {}
                // AI SDK 5.x uses tool-input-available and input
                chunks.push(toSSE({ type: "tool-input-available", toolCallId, toolName, input: args }))
                break
            }

            case "tool_result": {
                const toolCallId = event.data.toolCallId || ""
                const result = event.data.result || ""
                const isError = event.data.isError || false
                // AI SDK 5.x uses tool-output-available and output
                chunks.push(toSSE({
                    type: "tool-output-available",
                    toolCallId,
                    output: isError ? { error: result } : result
                }))
                break
            }

            case "finish": {
                // If a text block is active, end it first
                if (this.textBlockStarted) {
                    this.textBlockStarted = false
                    chunks.push(toSSE({ type: "text-end", id: this.textBlockId }))
                }

                // Convert finishReason format: backend uses underscores; AI SDK 5.x uses hyphens.
                // Valid values: "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other" | "unknown"
                let finishReason = event.data.finishReason || "stop"
                if (finishReason === "tool_calls") {
                    finishReason = "tool-calls"
                } else if (finishReason === "content_filter") {
                    finishReason = "content-filter"
                }

                // AI SDK 5.x finish event accepts finishReason only (no usage)
                chunks.push(toSSE({
                    type: "finish",
                    finishReason,
                }))
                break
            }

            case "error": {
                const errorText = event.data.message || "Unknown error"
                chunks.push(toSSE({ type: "error", errorText }))
                break
            }
        }

        return chunks
    }
}

/**
 * Proxy request to Python backend and convert the response.
 *
 * @param backendUrl Python backend URL
 * @param body Request body
 * @returns A Response compatible with AI SDK 5.x
 */
export async function proxyToBackend(
    backendUrl: string,
    body: Record<string, any>
): Promise<Response> {
    console.log("[AI Proxy] Calling backend:", backendUrl)

    // Call backend
    const backendResponse = await fetch(backendUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    })

    console.log("[AI Proxy] Backend response status:", backendResponse.status)

    if (!backendResponse.ok) {
        const errorText = await backendResponse.text()
        console.error("[AI Proxy] Backend error:", errorText)
        return new Response(
            JSON.stringify({ error: errorText }),
            { status: backendResponse.status }
        )
    }

    // Create a stateful converter
    const converter = new StreamConverter()
    const encoder = new TextEncoder()
    let eventCount = 0
    let isClosed = false

    const readable = new ReadableStream({
        async start(controller) {
            try {
                for await (const event of parseBackendSSE(backendResponse)) {
                    eventCount++
                    if (eventCount <= 3 || event.type === "finish" || event.type === "error") {
                        console.log(`[AI Proxy] Event #${eventCount}:`, event.type, JSON.stringify(event.data).slice(0, 100))
                    }

                    const chunks = converter.convert(event)
                    for (const chunk of chunks) {
                        if (!isClosed) {
                            controller.enqueue(encoder.encode(chunk))
                        }
                    }
                }
                console.log(`[AI Proxy] Stream complete. Total events: ${eventCount}`)
            } catch (error) {
                console.error("[AI Proxy] Error in proxy stream:", error)
                if (!isClosed) {
                    try {
                        controller.enqueue(
                            encoder.encode(toSSE({ type: "error", errorText: String(error) }))
                        )
                    } catch (e) {
                        // Ignore errors when writing to a closed stream
                    }
                }
            } finally {
                if (!isClosed) {
                    isClosed = true
                    controller.close()
                }
            }
        },
    })

    return new Response(readable, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            // AI SDK 5.x UI Message Stream v1 marker
            "x-vercel-ai-ui-message-stream": "v1",
        },
    })
}

/**
 * Get backend service URL.
 */
export function getBackendUrl(path: string): string {
    const baseUrl = process.env.AI_SERVER_URL || "http://localhost:6612"
    return `${baseUrl}${path}`
}
