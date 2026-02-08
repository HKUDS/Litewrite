/**
 * Internal API: Compile Project
 * ===============================
 *
 * Internal endpoint for nanobot to trigger project compilation.
 * Returns the compiled PDF as base64 (also saves to storage for web preview).
 *
 * This is NOT exposed to the public - protected by INTERNAL_API_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths } from "@/lib/storage";
import { VALID_COMPILERS, Compiler } from "@/lib/compiler-utils";

const COMPILE_SERVER_URL =
  process.env.COMPILE_SERVER_URL || "http://localhost:3002";

// Text file extensions (sent as UTF-8 strings)
const TEXT_EXTENSIONS = new Set([
  ".tex", ".bib", ".bbl", ".sty", ".cls", ".txt", ".md", ".bst",
  ".json", ".xml", ".cfg", ".def", ".fd", ".aux", ".toc",
  ".lof", ".lot", ".idx", ".ind", ".glo", ".gls", ".out", ".blg",
]);

// Binary file extensions (sent as base64)
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".pdf", ".eps", ".ps",
  ".svg", ".bmp", ".tiff", ".tif",
]);

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

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot >= 0 ? filename.substring(lastDot).toLowerCase() : "";
}

function shouldIncludeFile(filename: string): boolean {
  const excludePatterns = [
    ".log", ".aux", ".out", ".toc", ".synctex.gz", ".fls", ".fdb_latexmk",
  ];
  if (excludePatterns.some((p) => filename.endsWith(p))) return false;
  if (filename === "project.json" || filename.startsWith(".")) return false;
  return true;
}

/**
 * Read all project files from storage for compilation.
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

  const files = await storage.list(prefix);

  for (const file of files) {
    const relativePath = file.key.substring(prefixLen);
    if (!relativePath) continue;

    const filename = relativePath.split("/").pop() || "";
    if (!shouldIncludeFile(filename)) continue;
    if (file.key.endsWith("/")) continue;

    try {
      const content = await storage.download(file.key);
      const ext = getExtension(filename);

      if (TEXT_EXTENSIONS.has(ext)) {
        textFiles[relativePath] = content.toString("utf8");
      } else if (BINARY_EXTENSIONS.has(ext)) {
        binaryFiles[relativePath] = content.toString("base64");
      }
    } catch (error) {
      console.error(
        `[Internal/Compile] Failed to read file: ${file.key}`,
        error
      );
    }
  }

  return { textFiles, binaryFiles };
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
    const body = await request.json();
    const { projectId, compiler: requestedCompiler } = body as {
      projectId: string;
      compiler?: string;
    };

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "projectId is required" },
        { status: 400 }
      );
    }

    // Look up the project in the database
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return NextResponse.json(
        { success: false, error: `Project not found: ${projectId}` },
        { status: 404 }
      );
    }

    // Read all project files
    console.log(`[Internal/Compile] Reading project files for: ${projectId}`);
    const { textFiles, binaryFiles } = await readProjectFiles(projectId);

    console.log(
      `[Internal/Compile] Text files: ${Object.keys(textFiles).length}, ` +
        `Binary files: ${Object.keys(binaryFiles).length}`
    );

    const mainFile = project.mainFile || "main.tex";

    // Check whether the main file exists
    if (!textFiles[mainFile]) {
      return NextResponse.json({
        success: false,
        error: `Main file not found: ${mainFile}`,
      });
    }

    // Resolve compiler: request param > project setting > default
    let compiler = "pdflatex";
    if (
      requestedCompiler &&
      VALID_COMPILERS.has(requestedCompiler as Compiler)
    ) {
      compiler = requestedCompiler;
    } else if (
      project.compiler &&
      VALID_COMPILERS.has(project.compiler as Compiler)
    ) {
      compiler = project.compiler;
    }

    console.log(`[Internal/Compile] Using compiler: ${compiler}`);

    // Call compile server
    const compileResponse = await fetch(`${COMPILE_SERVER_URL}/compile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mainFile,
        compiler,
        projectFiles: textFiles,
        binaryFiles,
      }),
      cache: "no-store",
    });

    if (!compileResponse.ok) {
      let errorDetail = "";
      try {
        const errBody = await compileResponse.json();
        errorDetail = errBody.logs || errBody.error || "";
      } catch {
        errorDetail = `HTTP ${compileResponse.status}`;
      }

      console.error("[Internal/Compile] Compile server error:", errorDetail);

      return NextResponse.json({
        success: false,
        error: "Compilation failed",
        logs: errorDetail,
      });
    }

    const result = await compileResponse.json();

    if (!result.success || !result.pdfBase64) {
      return NextResponse.json({
        success: false,
        error: "Compilation did not produce a PDF",
        logs: result.logs || "",
      });
    }

    // Save PDF to storage (keeps web preview working)
    const storage = await getStorage();
    const timestamp = Date.now();
    const pdfFileName = `output-${timestamp}.pdf`;
    const pdfKey = StoragePaths.compiledFile(projectId, pdfFileName);
    const pdfBuffer = Buffer.from(result.pdfBase64, "base64");
    await storage.upload(pdfKey, pdfBuffer, "application/pdf");
    console.log(`[Internal/Compile] PDF saved to storage: ${pdfKey}`);

    // Save SyncTeX file if present
    if (result.synctexBase64) {
      const synctexFileName = `output-${timestamp}.synctex.gz`;
      const synctexKey = StoragePaths.compiledFile(projectId, synctexFileName);
      const synctexBuffer = Buffer.from(result.synctexBase64, "base64");
      await storage.upload(synctexKey, synctexBuffer, "application/gzip");
    }

    // Clean up old compiled files
    try {
      const prefix = StoragePaths.compiledPrefix(projectId);
      const oldFiles = await storage.list(prefix);
      for (const f of oldFiles) {
        const fname = f.key.split("/").pop() || "";
        if (
          !fname.includes(String(timestamp)) &&
          (fname.endsWith(".pdf") || fname.endsWith(".synctex.gz"))
        ) {
          await storage.delete(f.key);
        }
      }
    } catch (e) {
      console.warn("[Internal/Compile] Failed to clean old files:", e);
    }

    console.log(
      `[Internal/Compile] Compilation successful, PDF size: ${pdfBuffer.length} bytes`
    );

    return NextResponse.json({
      success: true,
      data: {
        pdfBase64: result.pdfBase64,
        pdfFileName,
        logs: result.logs || "",
      },
    });
  } catch (error) {
    console.error("[Internal/Compile] Error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
