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
 * Push updated content into the WS server's Yjs document.
 *
 * If the document is loaded in memory (i.e. a browser has it open), the
 * ws-server replaces the Y.Text content in-place and the change is
 * automatically synced to every connected browser via the Yjs protocol.
 *
 * If no browser has the document open, the ws-server clears its Redis
 * persistence so the next connection loads the fresh content from S3.
 */
async function replaceYjsContent(
  projectId: string,
  filePath: string,
  content: string
): Promise<void> {
  const wsServerUrl =
    process.env.WS_SERVER_URL ||
    process.env.NEXT_PUBLIC_WS_URL?.replace(/^wss?:\/\//, (m) =>
      m === "wss://" ? "https://" : "http://"
    ) ||
    "http://localhost:1234";

  try {
    const base = wsServerUrl.replace(/\/+$/, "");
    const resp = await fetch(
      `${base}/replace/${projectId}/${encodeURIComponent(filePath)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.INTERNAL_API_SECRET
            ? { "x-internal-secret": process.env.INTERNAL_API_SECRET }
            : {}),
        },
        body: JSON.stringify({ content }),
      }
    );

    if (!resp.ok) {
      const text = await resp.text();
      console.warn(
        `[Internal/EditFile] WS /replace returned ${resp.status}: ${text}`
      );
    } else {
      const result = await resp.json();
      console.log(
        `[Internal/EditFile] Yjs document replaced for ${projectId}/${filePath}` +
          ` (inMemory=${result.inMemory}, length=${result.contentLength})`
      );
    }
  } catch (err) {
    // Non-fatal: WS server may be unavailable
    console.warn(
      `[Internal/EditFile] Failed to replace Yjs content for ${filePath}:`,
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
      return NextResponse.json(
        { success: false, error: "projectId and filePath are required" },
        { status: 400 }
      );
    }

    if (typeof content !== "string") {
      return NextResponse.json(
        { success: false, error: "content must be a string" },
        { status: 400 }
      );
    }

    // Validate filePath to prevent path traversal
    if (filePath.includes("..") || filePath.startsWith("/")) {
      return NextResponse.json(
        { success: false, error: "Invalid file path" },
        { status: 400 }
      );
    }

    const storage = await getStorage();
    const key = StoragePaths.projectFile(projectId, filePath);

    // Write content to storage (full replacement)
    await storage.upload(key, content, "text/plain");
    console.log(
      `[Internal/EditFile] Written ${content.length} chars to ${projectId}/${filePath}`
    );

    // Push new content into the Yjs document so the editor picks it up
    await replaceYjsContent(projectId, filePath, content);

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
