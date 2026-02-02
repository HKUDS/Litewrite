/**
 * Pending Edits Manager (Diff-Based Architecture)
 * ================================================
 *
 * New architecture:
 * - Use the diff engine to compare the Shadow Doc and the original document
 * - No longer needs complex merge logic
 * - RelativePosition ensures accurate position tracking
 *
 * Storage layout (S3/Local Storage):
 *   litewrite/{projectId}/edits/{userId}.json
 */

import { getStorage } from "@/lib/storage";

// ============================================================================
// Storage Paths
// ============================================================================

/**
 * Get storage key for a user's edit data.
 */
function getEditsKey(projectId: string, userId: string): string {
  return `litewrite/${projectId}/edits/${userId}.json`;
}

// ============================================================================
// Types
// ============================================================================

export type RelativePositionJSON = object;

/**
 * Edit Block - represents a modified region in the original document.
 */
export interface EditBlock {
  /** Start line number in the original document (1-based) */
  startLine: number;
  /** End line number in the original document (1-based, inclusive) */
  endLine: number;
  /** Original content (the replaced content) */
  original?: string;
  /** Updated content (replacement) */
  updated: string;
  /** RelativePosition at the start (CRDT ID; never changes) */
  startRelPos?: RelativePositionJSON;
  /** RelativePosition at the end (CRDT ID; never changes) */
  endRelPos?: RelativePositionJSON;
}

/**
 * Pending Edit - a single AI editing operation.
 */
export interface PendingEdit {
  id: string;
  filePath: string;
  projectId: string;
  blocks: EditBlock[];
  description?: string;
  status: "pending" | "applying" | "applied" | "rejected";
  createdAt: number;
}

/**
 * Pending Edits Data - all pending edits for a user.
 */
export interface PendingEditsData {
  userId: string;
  projectId: string;
  pendingEdits: PendingEdit[];
  currentEditIndex: number;
  updatedAt: number;
}


// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Get pending edits for a user
 */
export async function getPendingEdits(
  projectId: string,
  userId: string
): Promise<PendingEditsData | null> {
  try {
    const storage = await getStorage();
    const key = getEditsKey(projectId, userId);
    const buffer = await storage.download(key);
    const content = buffer.toString("utf-8");
    const data = JSON.parse(content) as PendingEditsData;

    if (data.userId !== userId || data.projectId !== projectId) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * Save pending edits
 */
export async function savePendingEdits(
  projectId: string,
  userId: string,
  pendingEdits: PendingEdit[],
  currentEditIndex: number = 0
): Promise<PendingEditsData> {
  const storage = await getStorage();

  const data: PendingEditsData = {
    userId,
    projectId,
    pendingEdits,
    currentEditIndex,
    updatedAt: Date.now(),
  };

  const key = getEditsKey(projectId, userId);
  await storage.upload(key, JSON.stringify(data, null, 2), "application/json");

  return data;
}

/**
 * Add pending edits - one PendingEdit per block
 *
 * New architecture: one PendingEdit per block
 * so the user can independently keep/reject each change.
 *
 * Strategy:
 * 1) Clear all pending edits for this file (diff has recomputed all differences)
 * 2) Create a separate PendingEdit for each block
 */
export async function addPendingEdit(
  projectId: string,
  userId: string,
  edit: Omit<PendingEdit, "id" | "status" | "createdAt">
): Promise<PendingEdit> {
  const existing = await getPendingEdits(projectId, userId);
  const pendingEdits = existing?.pendingEdits || [];

  // 1) Keep other files' pending edits; clear this file's
  const otherFileEdits = pendingEdits.filter(
    e => e.filePath !== edit.filePath || e.status !== "pending"
  );

  // 2) Create a separate PendingEdit for each block
  const newEdits: PendingEdit[] = [];
  const timestamp = Date.now();

  for (let i = 0; i < edit.blocks.length; i++) {
    const block = edit.blocks[i];
    const newEdit: PendingEdit = {
      projectId: edit.projectId,
      filePath: edit.filePath,
      blocks: [block],  // Each PendingEdit contains exactly one block
      description: edit.description,
      id: `edit_${timestamp}_${i}_${Math.random().toString(36).slice(2, 8)}`,
      status: "pending",
      createdAt: timestamp + i,  // Ensure ordering
    };
    newEdits.push(newEdit);
  }

  // 3) Merge: other files' edits + this file's new edits
  const allEdits = [...otherFileEdits, ...newEdits];

  await savePendingEdits(projectId, userId, allEdits, existing?.currentEditIndex || 0);

  // Return the first newly created edit (to keep API compatibility)
  return newEdits[0] || {
    ...edit,
    id: `edit_${timestamp}_${Math.random().toString(36).slice(2, 8)}`,
    status: "pending",
    createdAt: timestamp,
  };
}

/**
 * Replace all blocks for a file
 * Replace old blocks with new ones after diff recomputation.
 */
export async function replaceFileBlocks(
  projectId: string,
  userId: string,
  filePath: string,
  blocks: EditBlock[],
  description?: string
): Promise<PendingEdit | null> {
  const existing = await getPendingEdits(projectId, userId);
  const pendingEdits = existing?.pendingEdits || [];

  // Find this file's pending edit
  const editIndex = pendingEdits.findIndex(
    e => e.filePath === filePath && e.status === "pending"
  );

  if (editIndex === -1) {
    // Not found; create a new one
    if (blocks.length === 0) return null;

    return addPendingEdit(projectId, userId, {
      projectId,
      filePath,
      blocks,
      description,
    });
  }

  if (blocks.length === 0) {
    // No blocks left; delete this edit
    pendingEdits.splice(editIndex, 1);
    await savePendingEdits(projectId, userId, pendingEdits, existing?.currentEditIndex || 0);
    return null;
  }

  // Update blocks
  pendingEdits[editIndex] = {
    ...pendingEdits[editIndex],
    blocks,
    description: description || pendingEdits[editIndex].description,
  };

  await savePendingEdits(projectId, userId, pendingEdits, existing?.currentEditIndex || 0);

  return pendingEdits[editIndex];
}

/**
 * Update block line numbers (called when Yjs document changes)
 * Recompute line numbers using RelativePosition.
 */
export async function updateBlockLineNumbers(
  projectId: string,
  userId: string,
  filePath: string,
  updatedBlocks: EditBlock[]
): Promise<void> {
  const existing = await getPendingEdits(projectId, userId);
  if (!existing) return;

  const pendingEdits = existing.pendingEdits.map(edit => {
    if (edit.filePath !== filePath || edit.status !== "pending") {
      return edit;
    }

    // Replace with updated blocks
    // updatedBlocks should keep the same RelPos but have new startLine/endLine values
    return {
      ...edit,
      blocks: updatedBlocks,
    };
  });

  await savePendingEdits(projectId, userId, pendingEdits, existing.currentEditIndex);
}

// ============================================================================
// Update & Delete Operations
// ============================================================================

/**
 * Update an existing edit
 */
export async function updatePendingEdit(
  projectId: string,
  userId: string,
  editId: string,
  updates: Partial<Pick<PendingEdit, "status" | "blocks" | "description">>
): Promise<PendingEdit | null> {
  const existing = await getPendingEdits(projectId, userId);
  if (!existing) return null;

  const editIndex = existing.pendingEdits.findIndex((e) => e.id === editId);
  if (editIndex === -1) return null;

  const updatedEdit = {
    ...existing.pendingEdits[editIndex],
    ...updates,
  };

  existing.pendingEdits[editIndex] = updatedEdit;

  await savePendingEdits(
    projectId,
    userId,
    existing.pendingEdits,
    existing.currentEditIndex
  );

  return updatedEdit;
}

/**
 * Remove a pending edit
 */
export async function removePendingEdit(
  projectId: string,
  userId: string,
  editId: string
): Promise<boolean> {
  const existing = await getPendingEdits(projectId, userId);
  if (!existing) return false;

  const newEdits = existing.pendingEdits.filter((e) => e.id !== editId);

  if (newEdits.length === existing.pendingEdits.length) {
    return false;
  }

  let newIndex = existing.currentEditIndex;
  if (newIndex >= newEdits.length) {
    newIndex = Math.max(0, newEdits.length - 1);
  }

  await savePendingEdits(projectId, userId, newEdits, newIndex);

  return true;
}

/**
 * Clear all pending edits for a user
 */
export async function clearPendingEdits(
  projectId: string,
  userId: string
): Promise<void> {
  await savePendingEdits(projectId, userId, [], 0);
}

/**
 * Update current edit index
 */
export async function updateCurrentEditIndex(
  projectId: string,
  userId: string,
  index: number
): Promise<void> {
  const existing = await getPendingEdits(projectId, userId);
  if (!existing) return;

  await savePendingEdits(projectId, userId, existing.pendingEdits, index);
}

/**
 * Delete the pending edits file entirely
 */
export async function deletePendingEditsFile(
  projectId: string,
  userId: string
): Promise<boolean> {
  try {
    const storage = await getStorage();
    const key = getEditsKey(projectId, userId);
    await storage.delete(key);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Batch Operations
// ============================================================================

/**
 * Apply multiple edits (remove from list)
 */
export async function applyPendingEdits(
  projectId: string,
  userId: string,
  editIds: string[]
): Promise<number> {
  const existing = await getPendingEdits(projectId, userId);
  if (!existing) return 0;

  let appliedCount = 0;
  const newEdits = existing.pendingEdits.filter((e) => {
    if (editIds.includes(e.id)) {
      appliedCount++;
      return false;
    }
    return true;
  });

  let newIndex = existing.currentEditIndex;
  if (newIndex >= newEdits.length) {
    newIndex = Math.max(0, newEdits.length - 1);
  }

  await savePendingEdits(projectId, userId, newEdits, newIndex);

  return appliedCount;
}

/**
 * Reject multiple edits (remove from list)
 */
export async function rejectPendingEdits(
  projectId: string,
  userId: string,
  editIds: string[]
): Promise<number> {
  return applyPendingEdits(projectId, userId, editIds);
}

// ============================================================================
// DEPRECATED - Kept for backward compatibility
// ============================================================================

/**
 * @deprecated No longer needed with diff-based architecture
 */
export async function adjustLineNumbers(
  _projectId: string,
  _userId: string,
  _filePath: string,
  _afterLine: number,
  _offset: number
): Promise<void> {
  // No-op: RelativePosition handles this automatically
}

// ============================================================================
// Exports
// ============================================================================

const pendingEditsManager = {
  getPendingEdits,
  savePendingEdits,
  addPendingEdit,
  replaceFileBlocks,
  updateBlockLineNumbers,
  updatePendingEdit,
  removePendingEdit,
  clearPendingEdits,
  updateCurrentEditIndex,
  deletePendingEditsFile,
  applyPendingEdits,
  rejectPendingEdits,
  adjustLineNumbers,
};

export default pendingEditsManager;
