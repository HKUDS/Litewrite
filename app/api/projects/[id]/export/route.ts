import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths } from "@/lib/storage";
import { apiError, AUTH_ERRORS, COMPILE_ERRORS, EXPORT_ERRORS, PROJECT_ERRORS } from "@/lib/api-errors";

const COMPILE_SERVER_URL = process.env.COMPILE_SERVER_URL || "http://localhost:3002";

// Text file extensions
const TEXT_EXTENSIONS = new Set([
  ".tex", ".bib", ".sty", ".cls", ".txt", ".md", ".bst",
  ".json", ".xml", ".cfg", ".def", ".fd", ".aux", ".toc",
  ".lof", ".lot", ".idx", ".ind", ".glo", ".gls", ".out"
]);

// Binary file extensions
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".pdf", ".eps", ".ps",
  ".svg", ".bmp", ".tiff", ".tif"
]);

/**
 * Determine whether a file should be included.
 */
function shouldIncludeFile(filename: string): boolean {
  const excludePatterns = [".log", ".aux", ".out", ".toc", ".synctex.gz", ".fls", ".fdb_latexmk"];
  if (excludePatterns.some(pattern => filename.endsWith(pattern))) {
    return false;
  }
  if (filename === "project.json" || filename.startsWith(".") || filename.includes("/.")) {
    return false;
  }
  return true;
}

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot >= 0 ? filename.substring(lastDot).toLowerCase() : "";
}

function isTextFile(filename: string): boolean {
  const ext = getExtension(filename);
  return TEXT_EXTENSIONS.has(ext);
}

function isBinaryFile(filename: string): boolean {
  const ext = getExtension(filename);
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Read project files from storage.
 */
async function readProjectFilesFromStorage(
  projectId: string
): Promise<{ textFiles: Record<string, string>; binaryFiles: Record<string, string> }> {
  const textFiles: Record<string, string> = {};
  const binaryFiles: Record<string, string> = {};

  try {
    const storage = await getStorage();
    const projectPrefix = StoragePaths.projectPrefix(projectId);
    const files = await storage.list(projectPrefix);

    for (const fileInfo of files) {
      const relativePath = fileInfo.key.replace(projectPrefix, "");

      // Skip .compiled directory and excluded files
      if (relativePath.startsWith(".compiled/") || !shouldIncludeFile(relativePath)) {
          continue;
        }

      const content = await storage.download(fileInfo.key);

      if (isTextFile(relativePath)) {
        textFiles[relativePath] = content.toString("utf8");
      } else if (isBinaryFile(relativePath)) {
        binaryFiles[relativePath] = content.toString("base64");
      }
    }
  } catch (error) {
    console.error(`Error reading project files:`, error);
  }

  return { textFiles, binaryFiles };
}

/**
 * POST /api/projects/[id]/export - Export a project to other formats.
 * Body: { format: 'markdown' | 'docx' }
 * Note: HTML export is temporarily disabled; plan to use LaTeXML in the future.
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

    // Validate project access
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

    // Parse request params
    const body = await request.json();
    const { format } = body;

    // HTML export is temporarily disabled
    const supportedFormats = ['markdown', 'docx'];
    if (!format || !supportedFormats.includes(format)) {
      return apiError(EXPORT_ERRORS.UNSUPPORTED_FORMAT, 400, { supportedFormats, format });
    }

    // Read project files
    const { textFiles, binaryFiles } = await readProjectFilesFromStorage(projectId);

    if (Object.keys(textFiles).length === 0) {
      return apiError(EXPORT_ERRORS.DATA_FAILED, 400);
    }

    // Determine main file
    const mainFile = project.mainFile || "main.tex";

    if (!textFiles[mainFile]) {
      return apiError(COMPILE_ERRORS.FILE_NOT_FOUND, 400, { file: mainFile });
    }

    // Call conversion service
    let response;
    try {
      response = await fetch(`${COMPILE_SERVER_URL}/convert`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          format,
          mainFile,
          projectName: project.name,
          projectFiles: textFiles,
          binaryFiles,
        }),
      });
    } catch (error) {
      console.error("Convert server connection error:", error);
      return apiError(COMPILE_ERRORS.SERVER_NOT_RUNNING, 503);
    }

    if (!response.ok) {
      const errorText = await response.text();
      return apiError(EXPORT_ERRORS.FAILED, response.status, { serverError: errorText.slice(0, 500) });
    }

    const result = await response.json();

    if (!result.success) {
      return apiError(EXPORT_ERRORS.FAILED, 500);
    }

    // Decode base64 to binary and return the file directly
    const binaryData = Buffer.from(result.contentBase64, 'base64');

    return new Response(binaryData, {
      headers: {
        'Content-Type': result.mimeType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(result.filename)}"`,
        'Content-Length': binaryData.length.toString(),
      },
    });
  } catch (error) {
    console.error("Export error:", error);
    return apiError(EXPORT_ERRORS.FAILED, 500);
  }
}

/**
 * GET /api/projects/[id]/export - Get supported export formats.
 * Note: HTML export is temporarily disabled.
 */
export async function GET() {
  return NextResponse.json({
    formats: [
      { id: 'markdown', name: 'Markdown', extension: '.md', mimeType: 'text/markdown' },
      { id: 'docx', name: 'Word Document', extension: '.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      // HTML export is temporarily disabled; plan to use LaTeXML in the future
      // { id: 'html', name: 'HTML page', extension: '.html', mimeType: 'text/html' },
    ],
  });
}
