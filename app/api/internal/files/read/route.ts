/**
 * Internal API: Read File
 * ========================
 *
 * Internal endpoint for ai-server to read project files.
 * Returns the effective content (Yjs + pending edits).
 *
 * This is NOT exposed to the public - protected by INTERNAL_API_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { getEffectiveContent } from "@/lib/shadow-documents";
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
    const { projectId, userId, filePath, startLine, endLine } = body;

    if (!projectId || !filePath) {
      return NextResponse.json(
        { success: false, error: "projectId and filePath are required" },
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

    // Get effective content (Yjs + pending edits)
    let content = await getEffectiveContent(projectId, userId || "", filePath);

    // If no effective content, try to read from storage directly
    if (content === null) {
      try {
        const storage = await getStorage();
        const key = StoragePaths.projectFile(projectId, filePath);
        const buffer = await storage.download(key);
        content = buffer.toString("utf-8");
        console.log(`[Internal/ReadFile] Read from storage: ${filePath}`);
      } catch {
        return NextResponse.json({
          success: false,
          error: `File not found: ${filePath}`,
        });
      }
    }

    const totalLines = content.split("\n").length;
    let resultContent = content;

    // Handle line range extraction
    if (startLine || endLine) {
      const lines = content.split("\n");
      const start = Math.max(0, (startLine || 1) - 1);
      const end = Math.min(lines.length, endLine || lines.length);
      resultContent = lines.slice(start, end).join("\n");
    }

    // Get file locks from other users
    const wsServerUrl = process.env.WS_SERVER_URL || "http://localhost:1234";

    // 1. Check Vibe Lock (entire file locked by another user's AI)
    let vibeLock: { isLocked: boolean; lockedBy?: { userId: string; userName: string } } = { isLocked: false };
    try {
      const vibeLockResponse = await fetch(
        `${wsServerUrl}/vibe-lock/${projectId}/${encodeURIComponent(filePath)}`
      );
      if (vibeLockResponse.ok) {
        const vibeLockData = await vibeLockResponse.json();
        // Only consider it locked if it's locked by ANOTHER user
        if (vibeLockData.isLocked && vibeLockData.lockedBy?.userId !== userId) {
          vibeLock = {
            isLocked: true,
            lockedBy: vibeLockData.lockedBy,
          };
          console.log(`[Internal/ReadFile] File ${filePath} is vibe-locked by ${vibeLockData.lockedBy?.userName}`);
        }
      }
    } catch (err) {
      console.warn(`[Internal/ReadFile] Failed to get vibe lock for ${filePath}:`, err);
    }

    // 2. Get line-level locks (pending edits by other users)
    let lockedRanges: Array<{ startLine: number; endLine: number; userName: string }> | undefined;
    try {
      const locksResponse = await fetch(
        `${wsServerUrl}/locks/${projectId}/${encodeURIComponent(filePath)}`
      );
      if (locksResponse.ok) {
        const locksData = await locksResponse.json();
        // Filter out current user's locks - only include OTHER users' locks
        const otherUsersLocks = (locksData.locks || []).filter(
          (lock: { userId: string }) => lock.userId !== userId
        );
        if (otherUsersLocks.length > 0) {
          lockedRanges = otherUsersLocks.map((lock: { startLine: number; endLine: number; userName: string }) => ({
            startLine: lock.startLine,
            endLine: lock.endLine,
            userName: lock.userName || "another user",
          }));
          console.log(`[Internal/ReadFile] Found ${otherUsersLocks.length} line locks on ${filePath}`);
        }
      }
    } catch (err) {
      console.warn(`[Internal/ReadFile] Failed to get line locks for ${filePath}:`, err);
    }

    console.log(`[Internal/ReadFile] Read ${filePath} (${resultContent.length} chars, ${totalLines} total lines, vibeLock=${vibeLock.isLocked})`);

    return NextResponse.json({
      success: true,
      data: {
        content: resultContent,
        filePath,
        totalLines,
        lineRange: startLine || endLine ? {
          start: startLine || 1,
          end: endLine || totalLines,
        } : undefined,
        lockedRanges,  // Line-level locks for AI to avoid editing
        vibeLock,      // Entire file lock (another user's AI is processing)
      },
    });

  } catch (error) {
    console.error("[Internal/ReadFile] Error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
