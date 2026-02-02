/**
 * Edit Position Tracker
 *
 * Track pending edit positions using Yjs RelativePosition.
 *
 * Core idea:
 * - RelativePosition (CRDT ID) is stable and always points to the position where it was created
 * - No matter how other users edit, the CRDT ID can resolve to the correct current position
 * - startLine/endLine store only the initial values for chat UI display (labeled as "original line numbers")
 * - The editor inline diff uses RelativePosition to compute accurate positions in real time
 *
 * Storage layout (S3/local storage):
 *   litewrite/{projectId}/edits/{userId}.json
 */

import * as Y from "yjs";
import { getStorage } from "@/lib/storage";

// ============================================================================
// Storage Paths
// ============================================================================

/**
 * Get the storage prefix for edit data.
 */
function getEditsPrefix(projectId: string): string {
  return `litewrite/${projectId}/edits/`;
}

// ============================================================================
// Types
// ============================================================================

export type RelativePositionJSON = object;

export interface EditBlock {
  startLine: number;
  endLine: number;
  updated: string;
  original?: string;
  startRelPos?: RelativePositionJSON;
  endRelPos?: RelativePositionJSON;
}

export interface PendingEdit {
  id: string;
  filePath: string;
  projectId: string;
  blocks: EditBlock[];
  description?: string;
  status: "pending" | "applying" | "applied" | "rejected";
  createdAt: number;
}

export interface PendingEditsData {
  userId: string;
  projectId: string;
  pendingEdits: PendingEdit[];
  currentEditIndex: number;
  updatedAt: number;
}

// ============================================================================
// RelativePosition Helpers
// ============================================================================

/**
 * Create a RelativePosition from a Yjs document.
 *
 * @param ytext - Yjs Text instance
 * @param lineNumber - 1-based line number
 * @returns JSON representation of RelativePosition
 */
export function createRelPosFromLine(
  ytext: Y.Text,
  lineNumber: number
): RelativePositionJSON | null {
  try {
    const content = ytext.toString();
    const lines = content.split('\n');

    // Compute character offset
    let charOffset = 0;
    for (let i = 0; i < lineNumber - 1 && i < lines.length; i++) {
      charOffset += lines[i].length + 1; // +1 for \n
    }

    // Ensure it doesn't exceed bounds
    charOffset = Math.min(charOffset, content.length);

    // Create RelativePosition
    const relPos = Y.createRelativePositionFromTypeIndex(ytext, charOffset);
    return Y.relativePositionToJSON(relPos);
  } catch (err) {
    console.error("[RelPos] Failed to create RelativePosition:", err);
    return null;
  }
}

/**
 * Compute the current line number from a RelativePosition.
 *
 * @param ydoc - Yjs document
 * @param ytext - Yjs Text instance
 * @param relPosJSON - JSON representation of RelativePosition
 * @returns Current 1-based line number, or null if it can't be computed
 */
export function getLineFromRelPos(
  ydoc: Y.Doc,
  ytext: Y.Text,
  relPosJSON: RelativePositionJSON | undefined
): number | null {
  if (!relPosJSON) {
    return null;
  }

  try {
    const relPos = Y.createRelativePositionFromJSON(relPosJSON);
    const absPos = Y.createAbsolutePositionFromRelativePosition(relPos, ydoc);

    if (!absPos) {
      return null;
    }

    // Compute line number
    const content = ytext.toString();
    const textBeforePos = content.slice(0, absPos.index);
    const lineNumber = textBeforePos.split('\n').length;

    return lineNumber;
  } catch (err) {
    console.error("[RelPos] Failed to get line from RelativePosition:", err);
    return null;
  }
}

/**
 * Create initial RelativePositions for an edit.
 * Called when the edit is created.
 */
export function createRelPosForEdit(
  ytext: Y.Text,
  startLine: number,
  endLine: number
): { startRelPos: RelativePositionJSON | null; endRelPos: RelativePositionJSON | null } {
  const content = ytext.toString();
  const lines = content.split('\n');

  try {
    // Compute char offset for startLine (line start)
    let startOffset = 0;
    for (let i = 0; i < startLine - 1 && i < lines.length; i++) {
      startOffset += lines[i].length + 1;
    }

    // Compute char offset for endLine (line end)
    let endOffset = startOffset;
    for (let i = startLine - 1; i < endLine && i < lines.length; i++) {
      endOffset += lines[i].length + 1;
    }
    endOffset = Math.max(startOffset, endOffset - 1); // Point to the last character, not the next line start

    // Ensure it doesn't exceed bounds
    startOffset = Math.min(startOffset, content.length);
    endOffset = Math.min(endOffset, content.length);

    // Create RelativePositions
    const startRelPos = Y.createRelativePositionFromTypeIndex(ytext, startOffset);
    const endRelPos = Y.createRelativePositionFromTypeIndex(ytext, endOffset);

    console.log(`[RelPos] Created for lines ${startLine}-${endLine}: startOffset=${startOffset}, endOffset=${endOffset}`);

    return {
      startRelPos: Y.relativePositionToJSON(startRelPos),
      endRelPos: Y.relativePositionToJSON(endRelPos),
    };
  } catch (err) {
    console.error("[RelPos] Failed to create RelativePositions:", err);
    return { startRelPos: null, endRelPos: null };
  }
}

// ============================================================================
// Edit File Operations
// ============================================================================

/**
 * Get keys for all pending-edits files in a project.
 */
async function getAllEditsKeys(projectId: string): Promise<string[]> {
  try {
    const storage = await getStorage();
    const prefix = getEditsPrefix(projectId);
    const files = await storage.list(prefix);
    return files
      .filter(f => f.key.endsWith('.json'))
      .map(f => f.key);
  } catch {
    return [];
  }
}

/**
 * Read a pending-edits file.
 */
async function readEditsFile(key: string): Promise<PendingEditsData | null> {
  try {
    const storage = await getStorage();
    const buffer = await storage.download(key);
    const content = buffer.toString('utf-8');
    return JSON.parse(content) as PendingEditsData;
  } catch {
    return null;
  }
}

/**
 * Save a pending-edits file.
 */
async function saveEditsFile(key: string, data: PendingEditsData): Promise<void> {
  const storage = await getStorage();
  await storage.upload(key, JSON.stringify(data, null, 2), 'application/json');
}

// ============================================================================
// RelativePosition Utility Functions
// ============================================================================

// NOTE: We no longer auto-update startLine/endLine in storage.
// - startLine/endLine store only the initial values for chat UI display ("original line numbers")
// - The editor inline diff uses RelativePosition to compute accurate positions in real time
// - This avoids frequent storage writes

/**
 * Add RelativePosition to a newly created edit.
 *
 * @param edit - Newly created edit (no RelPos yet)
 * @param ydoc - Yjs document
 * @param ytext - Yjs Text instance
 * @returns Edit with RelPos
 */
export function addRelPosToEdit(
  edit: PendingEdit,
  ydoc: Y.Doc,
  ytext: Y.Text
): PendingEdit {
  const updatedBlocks = edit.blocks.map(block => {
    const { startRelPos, endRelPos } = createRelPosForEdit(ytext, block.startLine, block.endLine);

    return {
      ...block,
      startRelPos: startRelPos || undefined,
      endRelPos: endRelPos || undefined,
    };
  });

  return {
    ...edit,
    blocks: updatedBlocks,
  };
}
