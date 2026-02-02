import { NextRequest } from "next/server";

const COMPILE_SERVER_URL = process.env.COMPILE_SERVER_URL || "http://localhost:3002";

/**
 * POST /api/compile/stream - SSE streaming compile proxy.
 * Forwards the request to the compile server and streams events back.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mainFile, projectFiles, compiler } = body;

    if (!mainFile || !projectFiles) {
      return new Response(
        `event: error\ndata: ${JSON.stringify({ message: "Missing required parameters" })}\n\n`,
        {
          status: 400,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        }
      );
    }

    // Call compile server streaming endpoint
    const response = await fetch(`${COMPILE_SERVER_URL}/compile-stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mainFile,
        projectFiles,
        compiler,
      }),
    });

    if (!response.ok || !response.body) {
      return new Response(
        `event: error\ndata: ${JSON.stringify({ message: "Compile server connection failed" })}\n\n`,
        {
          status: 503,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        }
      );
    }

    // Create a readable stream for proxying
    const reader = response.body.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    /**
     * Process a complete SSE event.
     * For done events, convert pdfBase64 to pdfUrl.
     */
    const processSSEEvent = (event: string): string => {
      // Check whether this is a done event (contains the \"event: done\" line)
      if (!event.includes("event: done")) {
        return event;
      }

      // Handle pdfBase64 inside done event
      const lines = event.split("\n");
      const modifiedLines = lines.map(line => {
        if (line.startsWith("data: ") && line.includes("pdfBase64")) {
          try {
            const data = JSON.parse(line.substring(6));
            if (data.success && data.pdfBase64) {
              data.pdfUrl = `data:application/pdf;base64,${data.pdfBase64}`;
              delete data.pdfBase64;
            }
            return `data: ${JSON.stringify(data)}`;
          } catch {
            return line;
          }
        }
        return line;
      });
      return modifiedLines.join("\n");
    };

    const stream = new ReadableStream({
      async start(controller) {
        // Buffer for accumulating incomplete SSE events
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              // When stream ends, process any remaining buffered data
              if (buffer.length > 0) {
                const processed = processSSEEvent(buffer);
                controller.enqueue(encoder.encode(processed));
              }
              break;
            }

            // Append new data to buffer
            buffer += decoder.decode(value, { stream: true });

            // SSE events are separated by double newlines (\n\n)
            // Find and process all complete events
            let eventEndIndex: number;
            while ((eventEndIndex = buffer.indexOf("\n\n")) !== -1) {
              // Extract a complete event (including trailing \n\n)
              const completeEvent = buffer.substring(0, eventEndIndex + 2);
              buffer = buffer.substring(eventEndIndex + 2);

              // Process and forward the complete event
              const processed = processSSEEvent(completeEvent);
              controller.enqueue(encoder.encode(processed));
            }
          }
        } catch (error) {
          console.error("[Compile Stream] Error:", error);
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify({ message: "Stream error" })}\n\n`)
          );
        } finally {
          reader.cancel();
          controller.close();
        }
      },
      cancel() {
        reader.cancel();
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
    console.error("[Compile Stream API] Error:", error);
    return new Response(
      `event: error\ndata: ${JSON.stringify({ message: "Internal server error" })}\n\n`,
      {
        status: 500,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      }
    );
  }
}
