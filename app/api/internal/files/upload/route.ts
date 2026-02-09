/**
 * Internal API: Upload Binary File
 * ==================================
 *
 * Internal endpoint for nanobot to upload binary files (images, PDFs, etc.)
 * to a Litewrite project. Accepts base64-encoded content.
 *
 * Protected by INTERNAL_API_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { getStorage, StoragePaths } from "@/lib/storage";

// Common MIME type mapping
const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".webp": "image/webp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".pdf": "application/pdf",
  ".eps": "application/postscript",
  ".ps": "application/postscript",
  ".tex": "text/x-tex",
  ".bib": "text/x-bibtex",
  ".sty": "text/x-tex",
  ".cls": "text/x-tex",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".xml": "application/xml",
  ".csv": "text/csv",
};

function getMimeType(fileName: string): string {
  const ext = fileName.lastIndexOf(".") >= 0
    ? fileName.substring(fileName.lastIndexOf(".")).toLowerCase()
    : "";
  return MIME_TYPES[ext] || "application/octet-stream";
}

function verifyInternalAuth(request: NextRequest): boolean {
  const secret = request.headers.get("X-Internal-Secret");
  const expectedSecret = process.env.INTERNAL_API_SECRET;
  if (!expectedSecret) {
    console.warn("[Internal API] INTERNAL_API_SECRET not configured");
    return false;
  }
  return secret === expectedSecret;
}

export async function POST(request: NextRequest) {
  if (!verifyInternalAuth(request)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const {
      projectId,
      filePath,
      contentBase64,
      content,
      overwrite = true,
    } = body as {
      projectId: string;
      filePath: string;
      contentBase64?: string;  // Base64-encoded binary content
      content?: string;        // Plain text content (for text files)
      overwrite?: boolean;
    };

    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json(
        { success: false, error: "Project ID is required" },
        { status: 400 }
      );
    }

    if (!filePath || typeof filePath !== "string") {
      return NextResponse.json(
        { success: false, error: "File path is required" },
        { status: 400 }
      );
    }

    if (!contentBase64 && content === undefined) {
      return NextResponse.json(
        { success: false, error: "Either contentBase64 or content is required" },
        { status: 400 }
      );
    }

    const storage = await getStorage();
    const key = StoragePaths.projectFile(projectId, filePath);

    // Check if file already exists (unless overwrite is allowed)
    if (!overwrite) {
      const exists = await storage.exists(key);
      if (exists) {
        return NextResponse.json(
          { success: false, error: "File already exists" },
          { status: 409 }
        );
      }
    }

    const fileName = filePath.split("/").pop() || filePath;
    const mimeType = getMimeType(fileName);

    if (contentBase64) {
      // Binary upload: decode base64 to Buffer
      const buffer = Buffer.from(contentBase64, "base64");
      await storage.upload(key, buffer, mimeType);

      console.log(
        `[Internal/UploadFile] Uploaded binary file "${filePath}" ` +
          `(${buffer.length} bytes, ${mimeType}) to project ${projectId}`
      );

      return NextResponse.json({
        success: true,
        data: {
          path: filePath,
          size: buffer.length,
          mimeType,
        },
      });
    } else {
      // Text upload
      await storage.upload(key, content || "", mimeType);

      console.log(
        `[Internal/UploadFile] Uploaded text file "${filePath}" ` +
          `(${(content || "").length} chars, ${mimeType}) to project ${projectId}`
      );

      return NextResponse.json({
        success: true,
        data: {
          path: filePath,
          size: (content || "").length,
          mimeType,
        },
      });
    }
  } catch (error) {
    console.error("[Internal/UploadFile] Error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
