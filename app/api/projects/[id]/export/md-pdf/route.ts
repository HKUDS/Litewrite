import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths } from "@/lib/storage";
import { apiError, AUTH_ERRORS, COMPILE_ERRORS, EXPORT_ERRORS, GENERAL_ERRORS, PROJECT_ERRORS } from "@/lib/api-errors";

const COMPILE_SERVER_URL = process.env.COMPILE_SERVER_URL || "http://localhost:3002";

/**
 * Extract relative image references from Markdown content.
 * Supports two formats:
 * - Markdown: ![alt](path)
 * - HTML: <img src="path">
 */
function extractImagePaths(content: string): string[] {
  const paths: string[] = [];

  // Markdown image syntax: ![alt](path)
  const mdImageRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
  let match;
  while ((match = mdImageRegex.exec(content)) !== null) {
    const src = match[1].split(/\s+/)[0]; // Handle ![](path "title") format
    if (isRelativePath(src)) {
      paths.push(cleanPath(src));
    }
  }

  // HTML img tag: <img src="path">
  const htmlImageRegex = /<img[^>]+src=["']([^"']+)["']/gi;
  while ((match = htmlImageRegex.exec(content)) !== null) {
    const src = match[1];
    if (isRelativePath(src)) {
      paths.push(cleanPath(src));
    }
  }

  // Deduplicate
  return [...new Set(paths)];
}

/**
 * Check whether a path is relative (not an external URL).
 */
function isRelativePath(src: string): boolean {
  if (!src) return false;
  // External URL or data URL
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:") || src.startsWith("blob:")) {
    return false;
  }
  // Protocol-relative URL (e.g. //cdn.example.com/image.png)
  if (src.startsWith("//")) {
    return false;
  }
  // Absolute path (already an API path)
  if (src.startsWith("/api/")) {
    return false;
  }
  return true;
}

/**
 * Clean the path by removing leading ./ or /.
 */
function cleanPath(src: string): string {
  return src.replace(/^\.?\//, "");
}

/**
 * POST /api/projects/[id]/export/md-pdf - Export Markdown to PDF.
 * Body: { content: string, filename?: string }
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
    const { content, filename = "document" } = body;

    if (!content || typeof content !== "string") {
      return apiError(GENERAL_ERRORS.MISSING_PARAMS, 400);
    }

    // Extract image paths and fetch binary data
    const imagePaths = extractImagePaths(content);
    const binaryFiles: Record<string, string> = {};

    if (imagePaths.length > 0) {
      const storage = await getStorage();

      await Promise.all(
        imagePaths.map(async (imagePath) => {
          try {
            const key = StoragePaths.projectFile(projectId, imagePath);
            const exists = await storage.exists(key);
            if (exists) {
              const buffer = await storage.download(key);
              binaryFiles[imagePath] = buffer.toString("base64");
            }
          } catch (err) {
            // Ignore image fetch failures and do not block PDF generation
            console.warn(`Failed to fetch image: ${imagePath}`, err);
          }
        })
      );
    }

    // Call compile-server /convert-md endpoint
    let response;
    try {
      response = await fetch(`${COMPILE_SERVER_URL}/convert-md`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content,
          filename,
          projectName: project.name,
          binaryFiles,
        }),
      });
    } catch (error) {
      console.error("Compile server connection error:", error);
      return apiError(COMPILE_ERRORS.SERVER_NOT_RUNNING, 503);
    }

    if (!response.ok) {
      const errorText = await response.text();
      return apiError(EXPORT_ERRORS.FAILED, response.status, { serverError: errorText.slice(0, 500) });
    }

    const result = await response.json();

    if (!result.success) {
      return apiError(EXPORT_ERRORS.PREVIEW_FAILED, 500);
    }

    // Decode base64 to binary and return the file directly
    const binaryData = Buffer.from(result.contentBase64, 'base64');

    return new Response(binaryData, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(result.filename)}"`,
        'Content-Length': binaryData.length.toString(),
      },
    });
  } catch (error) {
    console.error("Markdown PDF export error:", error);
    return apiError(EXPORT_ERRORS.FAILED, 500);
  }
}
