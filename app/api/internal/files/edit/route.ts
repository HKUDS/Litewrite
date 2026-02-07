/**
 * Internal API: Edit File (Full Replacement)
 * =============================================
 *
 * Internal endpoint for nanobot to replace a file's entire content.
 * Simpler than the shadow-document based files/write endpoint.
 * Writes directly to storage and clears Yjs cache.
 *
 * This is NOT exposed to the public - protected by INTERNAL_API_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { getStorage, StoragePaths } from "@/lib/storage";

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

/**
 * Clear Yjs in-memory document cache on the WS server.
 * This ensures the next time a user opens the file in the editor,
 * they get the updated content from storage.
 */
async function clearYjsCache(
  projectId: string,
  filePath: string
): Promise<void> {
  const wsServerUrl =
    process.env.WS_SERVER_URL ||
    process.env.NEXT_PUBLIC_WS_URL?.replace(/^wss?:\/\//, (m) =>
      m === "wss://" ? "https://" : "http://"
    ) ||
    "http://localhost:1234";

  try {
    const base = wsServerUrl.replace(/\/+$/, "");
    await fetch(
      `${base}/clear/${projectId}/${encodeURIComponent(filePath)}`,
      {
        method: "POST",
        headers: process.env.INTERNAL_API_SECRET
          ? { "x-internal-secret": process.env.INTERNAL_API_SECRET }
          : undefined,
      }
    );
    console.log(
      `[Internal/EditFile] Cleared Yjs cache for ${projectId}/${filePath}`
    );
  } catch (err) {
    // Non-fatal: WS server may be unavailable
    console.warn(
      `[Internal/EditFile] Failed to clear Yjs cache for ${filePath}:`,
      err
    );
  }
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
    const { projectId, filePath, content } = body as {
      projectId: string;
      filePath: string;
      content: string;
    };

    if (!projectId || !filePath) {
      return NextResponse.json({
        success: false,
        error: "projectId and filePath are required",
      });
    }

    if (typeof content !== "string") {
      return NextResponse.json({
        success: false,
        error: "content must be a string",
      });
    }

    const storage = await getStorage();
    const key = StoragePaths.projectFile(projectId, filePath);

    // Write content to storage (full replacement)
    await storage.upload(key, content, "text/plain");
    console.log(
      `[Internal/EditFile] Written ${content.length} chars to ${projectId}/${filePath}`
    );

    // Clear Yjs cache so the editor picks up the new content
    await clearYjsCache(projectId, filePath);

    return NextResponse.json({
      success: true,
      data: {
        filePath,
        length: content.length,
      },
    });
  } catch (error) {
    console.error("[Internal/EditFile] Error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
