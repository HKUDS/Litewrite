import { NextRequest, NextResponse } from "next/server";

const COMPILE_SERVER_URL = process.env.COMPILE_SERVER_URL || "http://localhost:3002";

interface CompileRequest {
  mainFile: string;
  projectFiles: Record<string, string>;
}

// Error codes for frontend i18n
export type CompileErrorCode =
  | "MISSING_PARAMS"
  | "SERVER_NOT_RUNNING"
  | "SERVER_START_HINT"
  | "SERVER_CONNECTION_FAILED"
  | "SERVER_RESPONSE_ERROR"
  | "SECURITY_RISK"
  | "UNKNOWN_ERROR";

interface CompileError {
  line?: number;
  column?: number;
  message: string;
  file?: string;
  severity: "error" | "warning";
  code?: CompileErrorCode; // Error code for frontend translation
}

interface CompileResponse {
  success: boolean;
  pdfBase64?: string;
  pdfUrl?: string;
  errors?: CompileError[];
  logs?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: CompileRequest = await request.json();
    const { mainFile, projectFiles } = body;

    if (!mainFile || !projectFiles) {
      return NextResponse.json(
        {
          success: false,
          errors: [{
            message: "Missing required parameters: mainFile or projectFiles",
            code: "MISSING_PARAMS" as CompileErrorCode,
            severity: "error"
          }],
        },
        { status: 400 }
      );
    }

    console.log(`[Compile API] Starting compile, main file: ${mainFile}, file count: ${Object.keys(projectFiles).length}`);

    // Try calling the compile server
    try {
      const response = await fetch(`${COMPILE_SERVER_URL}/compile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mainFile,
          projectFiles,
        }),
      });

      // Handle compile-server errors (e.g. security check failure)
      if (!response.ok) {
        // Try parsing the error JSON response, but handle parse failures
        let result;
        try {
          result = await response.json();
        } catch {
          return NextResponse.json({
            success: false,
            errors: [{
              message: `Compile server error: ${response.status}`,
              code: "SERVER_RESPONSE_ERROR" as CompileErrorCode,
              severity: "error" as const,
            }],
          }, { status: response.status });
        }

        // Check whether there is an error code (for i18n)
        const errorCode = result.errorCode as CompileErrorCode || "SERVER_RESPONSE_ERROR";

        return NextResponse.json({
          success: false,
          errors: [{
            message: result.error || `Compile server error: ${response.status}`,
            code: errorCode,
            severity: "error" as const,
          }],
          logs: result.details ? JSON.stringify(result.details, null, 2) : undefined,
        }, { status: response.status });
      }

      const result = await response.json();

      // If there is a base64 PDF, convert it to a data URL
      if (result.success && result.pdfBase64) {
        result.pdfUrl = `data:application/pdf;base64,${result.pdfBase64}`;
        delete result.pdfBase64;
      }

      return NextResponse.json(result);
    } catch (error) {
      console.error("[Compile API] Compile server connection failed:", error);

      // Return a mock response in development when compile server is not running
      if (process.env.NODE_ENV === "development") {
        return NextResponse.json({
          success: false,
          errors: [
            {
              message: "Compile server not running",
              code: "SERVER_NOT_RUNNING" as CompileErrorCode,
              severity: "error",
            },
            {
              message: "Run 'cd compile-server && docker-compose up -d' to start",
              code: "SERVER_START_HINT" as CompileErrorCode,
              severity: "warning",
            },
          ],
          logs: "Compile server connection failed.\n\nStart methods:\n1. Docker: cd compile-server && docker-compose up -d\n2. Or run directly: npm install && node server.js (requires local TeXLive)",
        });
      }

      return NextResponse.json(
        {
          success: false,
          errors: [{
            message: "Compile server connection failed",
            code: "SERVER_CONNECTION_FAILED" as CompileErrorCode,
            severity: "error"
          }],
        },
        { status: 503 }
      );
    }
  } catch (error) {
    console.error("[Compile API] Request processing error:", error);

    return NextResponse.json(
      {
        success: false,
        errors: [
          {
            message: error instanceof Error ? error.message : "Unknown error",
            code: "UNKNOWN_ERROR" as CompileErrorCode,
            severity: "error",
          },
        ],
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Health check
  try {
    const response = await fetch(`${COMPILE_SERVER_URL}/health`);
    if (response.ok) {
      return NextResponse.json({ status: "ok", compileServer: "connected" });
    }
  } catch {
    // Compile server is unavailable
  }

  return NextResponse.json({
    status: "ok",
    compileServer: "disconnected",
    message: "COMPILE_SERVER_NOT_CONNECTED",
  });
}
