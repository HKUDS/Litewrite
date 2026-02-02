/**
 * Shadow Documents Manager (Diff-Based Architecture)
 * ===================================================
 *
 * Three-layer architecture of Shadow Doc:
 * - Layer 1: editor-visible content (Yjs realtime sync)
 * - Layer 2: Shadow Doc (private to user; context for LLM)
 * - Layer 3: original document (Yjs; shared by all users)
 *
 * Shadow Doc = original document + all pending edits applied
 *
 * diff(original doc, Shadow Doc) produces blocks,
 * and each block carries RelativePosition for tracking
 *
 * Storage layout (S3/Local Storage):
 *   litewrite/{projectId}/shadow/{userId}/{filePath}
 */

import { getStorage, StoragePaths } from "@/lib/storage";
import {
  computeDiff,
  addRelativePositions,
  applyShadowEdits,
  updateBlockLineNumbers,
  type DiffBlock
} from "./diff-engine";
import {
  getPendingEdits,
  replaceFileBlocks,
  type PendingEdit,
  type EditBlock
} from "./pending-edits";
import * as Y from "yjs";

// ============================================================================
// Storage Paths
// ============================================================================

/**
 * Get the S3 key for a shadow document
 */
function getShadowKey(projectId: string, userId: string, filePath: string): string {
  return `litewrite/${projectId}/shadow/${userId}/${filePath}`;
}

/**
 * Get the S3 key prefix for listing user shadow documents
 */
function getUserShadowPrefix(projectId: string, userId: string): string {
  return `litewrite/${projectId}/shadow/${userId}/`;
}

// ============================================================================
// Shadow Document Basic Operations
// ============================================================================

/**
 * Read a shadow document
 */
export async function readShadowDocument(
  projectId: string,
  userId: string,
  filePath: string
): Promise<string | null> {
  try {
    const storage = await getStorage();
    const key = getShadowKey(projectId, userId, filePath);
    const buffer = await storage.download(key);
    return buffer.toString("utf-8");
  } catch {
    return null;
  }
}

/**
 * Write a shadow document
 */
export async function writeShadowDocument(
  projectId: string,
  userId: string,
  filePath: string,
  content: string
): Promise<void> {
  const storage = await getStorage();
  const key = getShadowKey(projectId, userId, filePath);
  await storage.upload(key, content, "text/plain");
}

/**
 * Delete a shadow document
 */
export async function deleteShadowDocument(
  projectId: string,
  userId: string,
  filePath: string
): Promise<boolean> {
  try {
    const storage = await getStorage();
    const key = getShadowKey(projectId, userId, filePath);
    await storage.delete(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete all shadow documents for a user
 */
export async function clearUserShadowDocuments(
  projectId: string,
  userId: string
): Promise<void> {
  try {
    const storage = await getStorage();
    const prefix = getUserShadowPrefix(projectId, userId);
    await storage.deletePrefix(prefix);
  } catch {
    // Prefix doesn't exist or storage error
  }
}

/**
 * List all shadow documents for a user
 */
export async function listUserShadowDocuments(
  projectId: string,
  userId: string
): Promise<string[]> {
  try {
    const storage = await getStorage();
    const prefix = getUserShadowPrefix(projectId, userId);
    const files = await storage.list(prefix);

    // Extract relative paths from full keys
    return files.map(file => file.key.replace(prefix, ""));
  } catch {
    // Prefix doesn't exist or storage error
    return [];
  }
}

// ============================================================================
// Diff-Based Shadow Document Operations
// ============================================================================

/**
 * Compute diff blocks between Shadow Doc and original document.
 * Core function: generates blocks with RelativePosition.
 *
 * @param projectId - Project ID
 * @param userId - User ID
 * @param filePath - File path
 * @param ytext - Yjs Text (for computing RelativePosition)
 * @returns DiffBlock array with RelativePosition
 */
export async function computeShadowDiff(
  projectId: string,
  userId: string,
  filePath: string,
  ytext: Y.Text
): Promise<DiffBlock[]> {
  // Read original document
  let originalContent: string;
  try {
    const storage = await getStorage();
    const key = StoragePaths.projectFile(projectId, filePath);
    const buffer = await storage.download(key);
    originalContent = buffer.toString("utf-8");
  } catch {
    console.warn(`[Shadow] Original file not found: ${filePath}`);
    return [];
  }

  // Read Shadow Doc
  const shadowContent = await readShadowDocument(projectId, userId, filePath);
  if (!shadowContent) {
    // No Shadow Doc means there are no pending edits
    return [];
  }

  // Compute diff
  const diffResult = computeDiff(originalContent, shadowContent);
  if (!diffResult.hasDiff) {
    return [];
  }

  // Add RelativePosition for each block
  const blocksWithRelPos = addRelativePositions(diffResult.blocks, null, ytext);

  console.log(`[Shadow] Computed ${blocksWithRelPos.length} diff blocks for ${filePath}`);

  return blocksWithRelPos;
}

/**
 * Update Shadow Doc and recompute diff blocks.
 * Called when AI produces new edits.
 *
 * @param projectId - Project ID
 * @param userId - User ID
 * @param filePath - File path
 * @param newContent - New Shadow Doc content
 * @param ytext - Yjs Text
 * @returns Updated blocks
 */
export async function updateShadowAndComputeDiff(
  projectId: string,
  userId: string,
  filePath: string,
  newContent: string,
  ytext: Y.Text
): Promise<DiffBlock[]> {
  // Write new Shadow Doc
  await writeShadowDocument(projectId, userId, filePath, newContent);

  // Compute diff and return
  return computeShadowDiff(projectId, userId, filePath, ytext);
}

/**
 * Sync Shadow Doc when the Yjs document changes.
 * Only updates regions outside the blocks.
 *
 * @param projectId - Project ID
 * @param userId - User ID
 * @param filePath - File path
 * @param blocks - Current blocks (with RelativePosition)
 * @param ydoc - Yjs document
 * @param ytext - Yjs Text
 */
export async function syncShadowWithYjs(
  projectId: string,
  userId: string,
  filePath: string,
  blocks: EditBlock[],
  ydoc: Y.Doc,
  ytext: Y.Text
): Promise<EditBlock[]> {
  // Read latest Yjs content
  const originalContent = ytext.toString();

  // Update block line numbers (using RelativePosition)
  const updatedBlocks = updateBlockLineNumbers(
    blocks as DiffBlock[],
    ydoc,
    ytext
  );

  // Regenerate Shadow Doc
  const shadowContent = applyShadowEdits(originalContent, updatedBlocks);
  await writeShadowDocument(projectId, userId, filePath, shadowContent);

  // Update line numbers in pending edits
  await replaceFileBlocks(
    projectId,
    userId,
    filePath,
    updatedBlocks as EditBlock[]
  );

  return updatedBlocks as EditBlock[];
}

/**
 * Regenerate Shadow Doc from original document and blocks.
 * Used before keep operations or after Yjs sync.
 */
export async function regenerateShadowDocument(
  projectId: string,
  userId: string,
  filePath: string
): Promise<string | null> {
  // Get pending edits
  const pendingEditsData = await getPendingEdits(projectId, userId);
  if (!pendingEditsData) {
    await deleteShadowDocument(projectId, userId, filePath);
    return null;
  }

  // Find all pending edits for this file (each block may be a separate PendingEdit)
  const fileEdits = pendingEditsData.pendingEdits.filter(
    (edit) =>
      edit.status === "pending" &&
      (edit.filePath === filePath ||
        edit.filePath.endsWith(filePath) ||
        filePath.endsWith(edit.filePath))
  );

  // Collect all blocks
  const allBlocks: EditBlock[] = [];
  for (const edit of fileEdits) {
    allBlocks.push(...edit.blocks);
  }

  if (allBlocks.length === 0) {
    await deleteShadowDocument(projectId, userId, filePath);
    return null;
  }

  // Read original document
  let originalContent: string;
  try {
    const storage = await getStorage();
    const key = StoragePaths.projectFile(projectId, filePath);
    const buffer = await storage.download(key);
    originalContent = buffer.toString("utf-8");
  } catch {
    return null;
  }

  // Apply all blocks to generate Shadow Doc
  const shadowContent = applyShadowEdits(originalContent, allBlocks as DiffBlock[]);
  await writeShadowDocument(projectId, userId, filePath, shadowContent);

  return shadowContent;
}

/**
 * Regenerate all Shadow Docs for a user.
 */
export async function regenerateAllShadowDocuments(
  projectId: string,
  userId: string
): Promise<void> {
  const pendingEditsData = await getPendingEdits(projectId, userId);

  if (!pendingEditsData || pendingEditsData.pendingEdits.length === 0) {
    await clearUserShadowDocuments(projectId, userId);
    return;
  }

  // Collect all files that need a shadow doc
  const filePaths = new Set<string>();
  for (const edit of pendingEditsData.pendingEdits) {
    if (edit.status === "pending") {
      filePaths.add(edit.filePath);
    }
  }

  // Regenerate shadow doc for each file
  for (const filePath of filePaths) {
    await regenerateShadowDocument(projectId, userId, filePath);
  }

  // Cleanup shadows that are no longer needed
  const existingShadows = await listUserShadowDocuments(projectId, userId);
  for (const shadowPath of existingShadows) {
    if (!filePaths.has(shadowPath)) {
      await deleteShadowDocument(projectId, userId, shadowPath);
    }
  }
}

/**
 * Fetch the latest Yjs document content from the WebSocket server.
 */
async function fetchYjsContent(
  projectId: string,
  filePath: string
): Promise<string | null> {
  const wsServerUrl = process.env.WS_SERVER_URL || "http://localhost:1234";
  try {
    const response = await fetch(
      `${wsServerUrl}/doc/${projectId}/${encodeURIComponent(filePath)}`
    );
    if (response.ok) {
      const data = await response.json();
      console.log(`[Shadow] Fetched Yjs content for ${filePath}, length: ${data.content?.length}`);
      return data.content;
    }
    console.log(`[Shadow] Yjs doc not found: ${response.status}`);
    return null;
  } catch (err) {
    console.error(`[Shadow] Failed to fetch Yjs content:`, err);
    return null;
  }
}

/**
 * Get effective content: compute the latest Shadow Doc on demand.
 *
 * Flow:
 * 1. Fetch latest Yjs content (if Yjs server is available)
 * 2. Load pending edits and recompute line numbers via RelPos
 * 3. Apply pending edits to Yjs content
 * 4. Persist to Shadow Doc
 * 5. Return
 *
 * If there are no pending edits, return Yjs content or original file content directly.
 */
export async function getEffectiveContent(
  projectId: string,
  userId: string,
  filePath: string
): Promise<string | null> {
  // Step 1: try fetching latest content from Yjs server
  let baseContent = await fetchYjsContent(projectId, filePath);

  // If Yjs server is unavailable, fall back to storage
  if (baseContent === null) {
    try {
      const storage = await getStorage();
      const key = StoragePaths.projectFile(projectId, filePath);
      const buffer = await storage.download(key);
      baseContent = buffer.toString("utf-8");
      console.log(`[Shadow] Using storage file for ${filePath}`);
    } catch {
      console.log(`[Shadow] File not found: ${filePath}`);
      return null;
    }
  }

  // Step 2: load pending edits
  const pendingEditsData = await getPendingEdits(projectId, userId);
  if (!pendingEditsData) {
    // No pending edits: return base content
    return baseContent;
  }

  // Find all pending edits for this file (each block may be a separate PendingEdit)
  const fileEdits = pendingEditsData.pendingEdits.filter(
    (edit) =>
      edit.status === "pending" &&
      (edit.filePath === filePath ||
        edit.filePath.endsWith(filePath) ||
        filePath.endsWith(edit.filePath))
  );

  if (fileEdits.length === 0) {
    // No pending edits for this file: return base content
    return baseContent;
  }

  // Collect blocks from all pending edits
  // NOTE: addPendingEdit creates a separate PendingEdit for each block
  let blocksToApply: EditBlock[] = [];
  for (const edit of fileEdits) {
    blocksToApply.push(...edit.blocks);
  }
  console.log(`[Shadow] Found ${fileEdits.length} pending edits with ${blocksToApply.length} blocks for ${filePath}`);

  if (blocksToApply.length === 0) {
    return baseContent;
  }

  // Step 3: if blocks have RelPos, recompute line numbers using Yjs.
  // This requires a Y.Doc to resolve RelPos; we ask the WS server to compute it.

  // Check whether there are RelPos values to resolve
  const hasRelPos = blocksToApply.some(b => b.startRelPos && b.endRelPos);
  if (hasRelPos) {
    // Ask WS server to update line numbers
    const wsServerUrl = process.env.WS_SERVER_URL || "http://localhost:1234";
    try {
      const response = await fetch(
        `${wsServerUrl}/update-line-numbers/${projectId}/${encodeURIComponent(filePath)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blocks: blocksToApply }),
        }
      );
      if (response.ok) {
        const data = await response.json();
        if (data.blocks && Array.isArray(data.blocks)) {
          blocksToApply = data.blocks;
          console.log(`[Shadow] Updated line numbers via RelPos for ${filePath}`);
        } else {
          console.warn(`[Shadow] Invalid response from update-line-numbers:`, data);
        }
      }
    } catch (err) {
      console.error(`[Shadow] Failed to update line numbers:`, err);
      // Keep using existing line numbers
    }
  }

  // Step 4: apply blocks to baseContent to produce Shadow Doc
  // Ensure blocksToApply is an array
  if (!blocksToApply || !Array.isArray(blocksToApply)) {
    console.warn(`[Shadow] blocksToApply is invalid, using empty array`);
    blocksToApply = [];
  }

  const shadowContent = applyShadowEdits(baseContent, blocksToApply as DiffBlock[]);

  // Step 5: persist the new Shadow Doc
  await writeShadowDocument(projectId, userId, filePath, shadowContent);
  console.log(`[Shadow] Updated shadow doc for ${filePath}, length: ${shadowContent.length}`);

  return shadowContent;
}

/**
 * Get effective contents for multiple files
 */
export async function getEffectiveContents(
  projectId: string,
  userId: string,
  filePaths: string[]
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  for (const filePath of filePaths) {
    const content = await getEffectiveContent(projectId, userId, filePath);
    if (content !== null) {
      results.set(filePath, content);
    }
  }

  return results;
}

// ============================================================================
// Exports
// ============================================================================

const shadowDocuments = {
  readShadowDocument,
  writeShadowDocument,
  deleteShadowDocument,
  clearUserShadowDocuments,
  listUserShadowDocuments,
  computeShadowDiff,
  updateShadowAndComputeDiff,
  syncShadowWithYjs,
  regenerateShadowDocument,
  regenerateAllShadowDocuments,
  getEffectiveContent,
  getEffectiveContents,
};

export default shadowDocuments;
