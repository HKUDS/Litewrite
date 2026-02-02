import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths, getMimeType } from "@/lib/storage";
import { VALID_COMPILERS, Compiler } from "@/lib/compiler-utils";
import { apiError, AUTH_ERRORS, COMPILE_ERRORS, PROJECT_ERRORS } from "@/lib/api-errors";

const COMPILE_SERVER_URL = process.env.COMPILE_SERVER_URL || "http://localhost:3002";

// Text file extensions (sent as UTF-8 strings)
const TEXT_EXTENSIONS = new Set([
  ".tex", ".bib", ".bbl", ".sty", ".cls", ".txt", ".md", ".bst",
  ".json", ".xml", ".cfg", ".def", ".fd", ".aux", ".toc",
  ".lof", ".lot", ".idx", ".ind", ".glo", ".gls", ".out", ".blg"
]);

// Binary file extensions (sent as base64)
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".pdf", ".eps", ".ps",
  ".svg", ".bmp", ".tiff", ".tif"
]);

/**
 * Determine whether a file should be included in compilation.
 */
function shouldIncludeFile(filename: string): boolean {
  // Exclude intermediate files produced during compilation
  const excludePatterns = [".log", ".aux", ".out", ".toc", ".synctex.gz", ".fls", ".fdb_latexmk"];
  if (excludePatterns.some(pattern => filename.endsWith(pattern))) {
    return false;
  }
  // Exclude special files
  if (filename === "project.json" || filename.startsWith(".") || filename === ".gitkeep") {
    return false;
  }
  return true;
}

/**
 * Determine whether a file is a text file.
 */
function isTextFile(filename: string): boolean {
  const ext = getExtension(filename);
  return TEXT_EXTENSIONS.has(ext);
}

/**
 * Determine whether a file is a binary file.
 */
function isBinaryFile(filename: string): boolean {
  const ext = getExtension(filename);
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Get file extension.
 */
function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot >= 0 ? filename.substring(lastDot).toLowerCase() : "";
}

/**
 * Read project files from storage.
 */
async function readProjectFiles(projectId: string): Promise<{
  textFiles: Record<string, string>;
  binaryFiles: Record<string, string>;
}> {
  const storage = await getStorage();
  const prefix = StoragePaths.projectPrefix(projectId);
  const prefixLen = prefix.length;

  const textFiles: Record<string, string> = {};
  const binaryFiles: Record<string, string> = {};

  // List all files under the project prefix
  const files = await storage.list(prefix);

  for (const file of files) {
    // Get relative path
    const relativePath = file.key.substring(prefixLen);
    if (!relativePath) continue;

    // Get file name
    const filename = relativePath.split("/").pop() || "";
    if (!shouldIncludeFile(filename)) continue;

    // Skip directories (keys ending with /)
    if (file.key.endsWith("/")) continue;

    try {
      const content = await storage.download(file.key);

      if (isTextFile(filename)) {
        textFiles[relativePath] = content.toString("utf8");
      } else if (isBinaryFile(filename)) {
        binaryFiles[relativePath] = content.toString("base64");
    }
  } catch (error) {
      console.error(`[Compile] Failed to read file: ${file.key}`, error);
    }
  }

  return { textFiles, binaryFiles };
}

/**
 * POST /api/projects/[id]/compile - Compile a project.
 *
 * Reads all project files from storage (including binary assets like images)
 * and sends them to the compile server.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const { id: projectId } = await params;

    // Verify that the user has access to the project
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { ownerId: session.user.id },
          { collaborators: { some: { userId: session.user.id } } },
        ],
      },
    });

    if (!project) {
      return apiError(PROJECT_ERRORS.NO_ACCESS, 404);
    }

    // Read all project files
    console.log(`[Compile] Reading project files for: ${projectId}`);
    const { textFiles, binaryFiles } = await readProjectFiles(projectId);

    console.log(`[Compile] Text files: ${Object.keys(textFiles).length}, Binary files: ${Object.keys(binaryFiles).length}`);
    console.log(`[Compile] Text files: ${Object.keys(textFiles).join(", ")}`);
    console.log(`[Compile] Binary files: ${Object.keys(binaryFiles).join(", ")}`);

    const mainFile = project.mainFile || "main.tex";

    // Check whether the main file exists
    if (!textFiles[mainFile]) {
      return apiError(COMPILE_ERRORS.FILE_NOT_FOUND, 400, { file: mainFile });
    }

    // Resolve compiler setting (project setting overrides user setting; backward-compatible)
    let compiler = "pdflatex";

    // 1) Project-level compiler
    if (project.compiler && VALID_COMPILERS.has(project.compiler as Compiler)) {
      compiler = project.compiler;
    } else {
      // 2) Fallback: user settings compiler
      try {
        const userSettings = await prisma.userSettings.findUnique({
          where: { userId: session.user.id },
          select: { compiler: true },
        });
        if (userSettings?.compiler && VALID_COMPILERS.has(userSettings.compiler as Compiler)) {
          compiler = userSettings.compiler;
        }
      } catch (e) {
        console.warn("[Compile] Failed to fetch user settings; using default compiler:", e);
      }
    }

    console.log(`[Compile] Using compiler: ${compiler}`);

    // Call compile server
    try {
      const response = await fetch(`${COMPILE_SERVER_URL}/compile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mainFile,
          compiler,
          projectFiles: textFiles,
          binaryFiles,
        }),
        cache: "no-store",
      });

      // Check response status
      if (!response.ok) {
        let result: { error?: string; details?: Array<{ file: string; issues?: string[] }>; logs?: string } | null = null;
        let responseText = "";

        try {
          responseText = await response.text();
          result = JSON.parse(responseText);
        } catch {
          console.error(`[Compile] Compile server returned non-JSON response (${response.status}):`, responseText.substring(0, 500));

          return NextResponse.json({
            success: false,
            errors: [{
              message: `Compile server returned an error (HTTP ${response.status} ${response.statusText})`,
              code: "COMPILE_SERVER_HTTP_ERROR",
              severity: "error" as const,
            }],
            logs: `Compile server returned an unexpected response (HTTP ${response.status}).\n\nResponse (first 500 chars):\n${responseText.substring(0, 500)}`,
          });
        }

        console.error("[Compile] Compile server error:", response.status, result);

        const errors = [];

        if (result?.error) {
          let errorCode = "COMPILE_SERVER_ERROR";
          if (result.details && Array.isArray(result.details)) {
            errorCode = "SECURITY_VIOLATION";
            errors.push({
              message: result.error,
              code: errorCode,
              severity: "error" as const,
            });
            for (const detail of result.details) {
              errors.push({
                message: `${detail.file}: ${detail.issues?.join(", ") || "Unknown issue"}`,
                code: "SECURITY_DETAIL",
                severity: "warning" as const,
              });
            }
          } else if (response.status === 429) {
            errorCode = "SERVER_BUSY";
            errors.push({
              message: result.error,
              code: errorCode,
              severity: "error" as const,
            });
          } else if (response.status === 413) {
            errorCode = "FILE_TOO_LARGE";
            errors.push({
              message: result.error,
              code: errorCode,
              severity: "error" as const,
            });
          } else {
            errors.push({
              message: result.error,
              code: errorCode,
              severity: "error" as const,
            });
          }
        }

        return NextResponse.json({
          success: false,
          errors: errors.length > 0 ? errors : [{
            message: `Compile server error (${response.status})`,
            code: "COMPILE_SERVER_ERROR",
            severity: "error" as const,
          }],
          logs: result?.logs || result?.error || "",
        });
      }

      // Response OK: parse JSON
      const result = await response.json();

      // If a base64 PDF is returned, save it to storage and return a URL
      if (result.success && result.pdfBase64) {
        const storage = await getStorage();
        const timestamp = Date.now();
        const pdfFileName = `output-${timestamp}.pdf`;
        const pdfKey = StoragePaths.compiledFile(projectId, pdfFileName);
        const pdfBuffer = Buffer.from(result.pdfBase64, "base64");

        await storage.upload(pdfKey, pdfBuffer, "application/pdf");
        console.log(`[Compile] PDF saved: ${pdfKey}`);

        // Save SyncTeX file (if present)
        if (result.synctexBase64) {
          const synctexFileName = `output-${timestamp}.synctex.gz`;
          const synctexKey = StoragePaths.compiledFile(projectId, synctexFileName);
          const synctexBuffer = Buffer.from(result.synctexBase64, "base64");
          await storage.upload(synctexKey, synctexBuffer, "application/gzip");
          console.log(`[Compile] SyncTeX saved: ${synctexKey}`);
        }

        // Clean up old compiled files (keep the latest)
        try {
          const prefix = StoragePaths.compiledPrefix(projectId);
          const files = await storage.list(prefix);

          for (const file of files) {
            const filename = file.key.split("/").pop() || "";
            // Only remove PDF and synctex files that are not for the current timestamp
            if (!filename.includes(String(timestamp)) && (filename.endsWith(".pdf") || filename.endsWith(".synctex.gz"))) {
              await storage.delete(file.key);
            }
          }
        } catch (e) {
          console.warn("[Compile] Failed to clean old files:", e);
        }

        // Return the PDF file URL
        result.pdfUrl = `/api/projects/${projectId}/pdf/${pdfFileName}`;
        delete result.pdfBase64;
        delete result.synctexBase64;
      }

      return NextResponse.json(result);
    } catch (error) {
      console.error("[Compile] Compile server connection failed:", error);

      return NextResponse.json({
        success: false,
        errors: [
          {
            message: "Failed to connect to compile server",
            code: "SERVER_CONNECTION_FAILED",
            severity: "error",
          },
          {
            message: "Run 'cd compile-server && docker-compose up -d' to start the compile service",
            code: "SERVER_START_HINT",
            severity: "warning",
          },
        ],
        logs: "Failed to connect to the compile server. Please make sure the service is running.",
      });
    }
  } catch (error) {
    console.error("[Compile] Error:", error);
    return NextResponse.json(
      {
        success: false,
        errors: [{
          message: error instanceof Error ? error.message : "Compilation failed",
          code: "UNKNOWN_ERROR",
          severity: "error"
        }]
      },
      { status: 500 }
    );
  }
}
