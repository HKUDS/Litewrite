/**
 * Internal API: Write/Edit File
 * ==============================
 *
 * Internal endpoint for ai-server to edit project files.
 * Applies edits to shadow document and returns the diff.
 *
 * This is NOT exposed to the public - protected by INTERNAL_API_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getEffectiveContent,
  writeShadowDocument
} from "@/lib/shadow-documents";
import { computeDiff, type DiffBlock } from "@/lib/diff-engine";
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

// Fetch content from Yjs server
async function fetchYjsContent(projectId: string, filePath: string): Promise<string | null> {
  const wsServerUrl = process.env.WS_SERVER_URL || "http://localhost:1234";
  try {
    const response = await fetch(
      `${wsServerUrl}/doc/${projectId}/${encodeURIComponent(filePath)}`
    );
    if (response.ok) {
      const data = await response.json();
      return data.content;
    }
  } catch (err) {
    console.error("[Internal/WriteFile] Failed to fetch Yjs content:", err);
  }
  return null;
}

// Compute RelativePosition for blocks via WS server
async function computeRelPos(
  projectId: string,
  filePath: string,
  blocks: DiffBlock[]
): Promise<DiffBlock[]> {
  const wsServerUrl = process.env.WS_SERVER_URL || "http://localhost:1234";
  try {
    const response = await fetch(
      `${wsServerUrl}/relpos/${projectId}/${encodeURIComponent(filePath)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks }),
      }
    );
    if (response.ok) {
      const data = await response.json();
      return data.blocks || blocks;
    }
  } catch (err) {
    console.error("[Internal/WriteFile] Failed to compute RelPos:", err);
  }
  return blocks;
}

interface EditBlock {
  startLine: number;
  endLine: number;
  updated: string;
  description?: string;
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
    const { projectId, userId, filePath, blocks, editId } = body as {
      projectId: string;
      userId: string;
      filePath: string;
      blocks: EditBlock[];
      editId?: string;
    };

    if (!projectId || !filePath || !blocks || blocks.length === 0) {
      return NextResponse.json({
        success: false,
        error: "projectId, filePath, and blocks are required",
      });
    }

    // Step 0: Check Vibe Lock (another user's AI processing this file)
    const wsServerUrl = process.env.WS_SERVER_URL || "http://localhost:1234";
    try {
      const vibeLockResponse = await fetch(
        `${wsServerUrl}/vibe-lock/${projectId}/${encodeURIComponent(filePath)}`
      );
      if (vibeLockResponse.ok) {
        const vibeLockData = await vibeLockResponse.json();
        // Only block if locked by ANOTHER user
        if (vibeLockData.isLocked && vibeLockData.lockedBy?.userId !== userId) {
          const lockedByName = vibeLockData.lockedBy?.userName || "another user";
          console.log(`[Internal/WriteFile] File ${filePath} is vibe-locked by ${lockedByName}, rejecting edit`);
          return NextResponse.json({
            success: false,
            error: "FILE_LOCKED",
            errorCode: "FILE_LOCKED",
            message: `Cannot edit ${filePath}: file is being processed by ${lockedByName}'s AI. Please wait for them to finish.`,
            lockedBy: vibeLockData.lockedBy,
          });
        }
      }
    } catch (err) {
      console.warn(`[Internal/WriteFile] Failed to check vibe lock for ${filePath}:`, err);
      // Continue anyway - lock check is best-effort
    }

    // Step 1: Get Yjs original content
    let yjsOriginalContent = await fetchYjsContent(projectId, filePath);

    // Fallback to S3 storage if Yjs not available
    if (!yjsOriginalContent) {
      try {
        const storage = await getStorage();
        const key = StoragePaths.projectFile(projectId, filePath);
        const buffer = await storage.download(key);
        yjsOriginalContent = buffer.toString("utf-8");
        console.log(`[Internal/WriteFile] Using storage file for ${filePath}`);
      } catch {
        return NextResponse.json({
          success: false,
          error: `File not found: ${filePath}`,
        });
      }
    }

    // Step 2: Get existing Shadow Doc (or start from Yjs content)
    const shadowContentBefore = await getEffectiveContent(projectId, userId, filePath) || yjsOriginalContent;
    let shadowContent = shadowContentBefore;
    console.log(`[Internal/WriteFile] Starting from shadow doc, length: ${shadowContent.length}`);

    // Step 3: Build session blocks with original content from shadow doc
    const shadowLines = shadowContentBefore.split('\n');
    const sessionBlocks: DiffBlock[] = blocks.map(block => {
      const originalLines = shadowLines.slice(block.startLine - 1, block.endLine);
      return {
        startLine: block.startLine,
        endLine: block.endLine,
        original: originalLines.join('\n'),
        updated: block.updated,
      };
    });

    // Step 4: Apply edits to shadow content (bottom to top to preserve line numbers)
    const sortedBlocks = [...blocks].sort((a, b) => b.startLine - a.startLine);
    for (const block of sortedBlocks) {
      const lines = shadowContent.split('\n');
      const updatedLines = block.updated.split('\n');
      lines.splice(block.startLine - 1, block.endLine - block.startLine + 1, ...updatedLines);
      shadowContent = lines.join('\n');
    }

    // Step 5: Compute full diff between original and new shadow
    const diffResult = computeDiff(yjsOriginalContent, shadowContent);
    console.log(`[Internal/WriteFile] Computed ${diffResult.blocks.length} diff blocks`);

    // Step 6: Compute RelativePosition for all blocks
    const allBlocksWithRelPos = await computeRelPos(projectId, filePath, diffResult.blocks);
    const sessionBlocksWithRelPos = await computeRelPos(projectId, filePath, sessionBlocks);

    // Step 7: Save Shadow Doc
    await writeShadowDocument(projectId, userId, filePath, shadowContent);
    console.log(`[Internal/WriteFile] Saved shadow doc for ${filePath}`);

    return NextResponse.json({
      success: true,
      data: {
        editId,
        filePath,
        blocks: sessionBlocksWithRelPos,      // This edit's blocks (for UI display)
        allBlocks: allBlocksWithRelPos,       // All diff blocks (for pending edits)
        shadowContent,                         // New shadow content
        originalContent: yjsOriginalContent,  // Original Yjs content
      },
    });

  } catch (error) {
    console.error("[Internal/WriteFile] Error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
