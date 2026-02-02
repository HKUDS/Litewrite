"use client";

import { create } from "zustand";
import * as Y from "yjs";
import type { EditBlock, PendingLockInfo, EditLock, RelativePositionJSON } from "@/types/ask";

/**
 * LINE NUMBER TRACKING (Diff-Based Architecture):
 *
 * New architecture: compute line numbers locally with Yjs + RelativePosition.
 *
 * 1. Server stores blocks; each block has startRelPos/endRelPos (CRDT ID)
 * 2. Frontend caches ydoc/ytext references
 * 3. When Yjs changes, frontend computes new startLine/endLine from RelPos locally
 * 4. Zero latency: no server request needed
 *
 * RelPos is a CRDT-unique ID; no matter how the document changes, it can still find the right position.
 */

/**
 * Compute current line number from RelativePosition.
 */
function getLineFromRelPos(
  ydoc: Y.Doc,
  ytext: Y.Text,
  relPosJSON: RelativePositionJSON | undefined
): number | null {
  if (!relPosJSON || !ydoc || !ytext) return null;

  try {
    const relPos = Y.createRelativePositionFromJSON(relPosJSON);
    const absPos = Y.createAbsolutePositionFromRelativePosition(relPos, ydoc);

    if (!absPos) return null;

    // Compute line number
    const content = ytext.toString();
    const textBeforePos = content.slice(0, absPos.index);
    const lineNumber = textBeforePos.split("\n").length;

    return lineNumber;
  } catch (err) {
    console.error("[EditStore] Failed to get line from RelPos:", err);
    return null;
  }
}

/**
 * Get effective line numbers for a block
 * If Yjs refs and RelPos are available, compute locally; otherwise fall back to stored line numbers.
 */
function getEffectiveLineNumbers(
  block: EditBlock,
  ydoc?: Y.Doc | null,
  ytext?: Y.Text | null
): { startLine: number; endLine: number } {
  // If Yjs refs and RelPos are available, compute locally
  if (ydoc && ytext && block.startRelPos && block.endRelPos) {
    const startLine = getLineFromRelPos(ydoc, ytext, block.startRelPos);
    const endLine = getLineFromRelPos(ydoc, ytext, block.endRelPos);

    if (startLine !== null && endLine !== null) {
      return { startLine, endLine };
    }
  }

  // Fallback: use stored line numbers
  return { startLine: block.startLine, endLine: block.endLine };
}

/**
 * A pending file edit - stored globally on server, not per-session
 * Layer 2: User's private draft state
 *
 * Uses LINE-BASED positioning for robust edit handling
 */
export interface PendingEdit {
  id: string;
  filePath: string;
  projectId: string;
  blocks: EditBlock[];  // Line-based: {startLine, endLine, updated}
  description?: string;
  status: "pending" | "applying" | "applied" | "rejected";
  createdAt: number;
}

/**
 * Callback type for applying edits to the editor
 */
export type ApplyEditCallback = (
  filePath: string,
  blocks: EditBlock[]
) => boolean;

/**
 * Callback type for navigating to a specific file and optionally to a line
 */
export type NavigateToFileCallback = (filePath: string, line?: number) => void;

/**
 * Callback for getting file content from Yjs
 */
export type GetFileContentCallback = (filePath: string) => string | null;

/**
 * Callback for setting editor display content
 */
export type SetDisplayContentCallback = (filePath: string, content: string) => void;

/**
 * Callback for syncing locks to Yjs
 */
export type SyncLocksCallback = (locks: PendingLockInfo[]) => void;

/**
 * Global edit state for Cursor-style command bar
 *
 * THREE-LAYER ARCHITECTURE:
 * - Layer 1: Frontend Display (CodeMirror shows synthesized content)
 * - Layer 2: User Private State (this store, persisted to server)
 * - Layer 3: Shared Persistent State (Yjs + File System, only after Keep)
 */
interface EditStore {
  // All pending edits (synced with server)
  pendingEdits: PendingEdit[];

  // Current edit index (for navigation)
  currentEditIndex: number;

  // Is command bar visible
  isCommandBarVisible: boolean;

  // Current project ID (for server sync)
  currentProjectId: string | null;

  // Is loading from server
  isLoading: boolean;

  // Is syncing to server
  isSyncing: boolean;

  // Has been initialized for current project
  isInitialized: boolean;

  // Callback for applying edits to editor (set by editor component)
  applyCallback: ApplyEditCallback | null;

  // Callback for navigating to a file (set by parent component)
  navigateToFileCallback: NavigateToFileCallback | null;

  // Callback for getting base content from Yjs
  getBaseContentCallback: GetFileContentCallback | null;

  // Callback for syncing locks to Yjs (so other collaborators see locked regions)
  syncLocksCallback: SyncLocksCallback | null;

  // Current user info for lock generation
  currentUserId: string | null;
  currentUserName: string | null;
  currentUserColor: string | null;

  // Yjs references for local line number calculation
  currentYDoc: Y.Doc | null;
  currentYText: Y.Text | null;
  currentFileId: string | null;

  // Initialize store with data from server
  initializeFromServer: (projectId: string) => Promise<void>;

  // Force refresh from server (for real-time updates)
  refreshFromServer: (projectId: string) => Promise<void>;

  // Sync current state to server (debounced internally)
  syncToServer: () => Promise<void>;

  // Set Yjs references (called by collaborative-editor)
  setYjsRefs: (ydoc: Y.Doc, ytext: Y.Text, fileId: string) => void;

  // Clear Yjs references (called on unmount)
  clearYjsRefs: () => void;

  // Update line numbers locally using RelPos (called when Yjs changes)
  updateLineNumbersFromRelPos: () => void;

  // Actions
  addEdit: (edit: Omit<PendingEdit, "id" | "status" | "createdAt">) => Promise<void>;
  removeEdit: (editId: string) => void;

  // DEPRECATED: Adjust line numbers when document changes
  // With RelativePosition, this is no longer needed
  adjustLineNumbers: (filePath: string, afterLine: number, offset: number) => void;

  // Set the apply callback (called by editor component)
  setApplyCallback: (callback: ApplyEditCallback | null) => void;

  // Set the navigate callback (called by parent component)
  setNavigateToFileCallback: (callback: NavigateToFileCallback | null) => void;

  // Set the base content callback (called by editor component)
  setGetBaseContentCallback: (callback: GetFileContentCallback | null) => void;

  // Set the sync locks callback (called by collaborative-editor to sync to Yjs)
  setSyncLocksCallback: (callback: SyncLocksCallback | null) => void;

  // Set current user info (for generating lock info)
  setCurrentUserInfo: (userId: string, userName: string, userColor: string) => void;

  // Get current locks for syncing (line-based)
  getPendingLocks: () => PendingLockInfo[];

  // Get edit locks for CodeMirror extension
  getEditLocks: (filePath: string, ownUserId?: string) => EditLock[];

  // Set pending edits directly (for syncing from use-ask.ts)
  setEditsFromLocal: (edits: PendingEdit[]) => void;

  // Navigate to the file of current edit
  navigateToCurrentEdit: () => void;

  // Navigation
  setCurrentEditIndex: (index: number) => void;
  nextEdit: () => void;
  prevEdit: () => void;
  nextFile: () => void;
  prevFile: () => void;

  // Batch operations
  applyEdit: (editId: string) => Promise<void>;
  rejectEdit: (editId: string) => void;
  applyAll: () => Promise<void>;
  rejectAll: () => void;

  // Visibility
  showCommandBar: () => void;
  hideCommandBar: () => void;

  // Clear all
  clearAll: () => void;

  // Computed helpers
  getCurrentEdit: () => PendingEdit | null;
  getPendingCount: () => number;
  getUniqueFiles: () => string[];
  getCurrentFileIndex: () => number;

  // Content synthesis for display (line-based)
  synthesizeContent: (filePath: string, baseContent: string) => string;

  // Get pending edits for a specific file
  getEditsForFile: (filePath: string) => PendingEdit[];

  // Check if there are pending edits for a file
  hasEditsForFile: (filePath: string) => boolean;
}

/**
 * Apply edit blocks to content (LINE-BASED)
 * Returns the new content with edits applied
 */
function applyEditBlocksToContent(content: string, blocks: EditBlock[]): string {
  const lines = content.split('\n');

  // Sort blocks by startLine descending to apply from bottom to top
  // This prevents line number shifts from affecting subsequent edits
  const sortedBlocks = [...blocks].sort((a, b) => b.startLine - a.startLine);

  for (const block of sortedBlocks) {
    // Convert to 0-based index
    const startIdx = block.startLine - 1;
    const endIdx = block.endLine - 1;

    // Validate indices
    if (startIdx < 0 || endIdx >= lines.length || startIdx > endIdx) {
      console.warn(`[EditStore] Invalid line range: ${block.startLine}-${block.endLine} (total lines: ${lines.length})`);
      continue;
  }

    // Split updated content into lines
    const updatedLines = block.updated.split('\n');

    // Replace the specified line range with updated content
    lines.splice(startIdx, endIdx - startIdx + 1, ...updatedLines);
  }

  return lines.join('\n');
}

// Debounce helper
let syncTimeout: NodeJS.Timeout | null = null;
const SYNC_DEBOUNCE_MS = 500;

export const useEditStore = create<EditStore>()((set, get) => ({
  pendingEdits: [],
  currentEditIndex: 0,
  isCommandBarVisible: false,
  currentProjectId: null,
  isLoading: false,
  isSyncing: false,
  isInitialized: false,
  applyCallback: null,
  navigateToFileCallback: null,
  getBaseContentCallback: null,
  syncLocksCallback: null,
  currentUserId: null,
  currentUserName: null,
  currentUserColor: null,

  // Yjs references for local line number calculation
  currentYDoc: null,
  currentYText: null,
  currentFileId: null,

  initializeFromServer: async (projectId: string) => {
    const { currentProjectId, isLoading, isInitialized } = get();

    // Skip if already initialized for this project
    if (isInitialized && currentProjectId === projectId) {
      return;
    }

    // Skip if already loading
    if (isLoading) {
      return;
    }

    set({ isLoading: true, currentProjectId: projectId });

    try {
      const response = await fetch(`/api/pending-edits?projectId=${projectId}`);

      if (response.ok) {
        const result = await response.json();
        const data = result.data;

        set({
          pendingEdits: data.pendingEdits || [],
          currentEditIndex: data.currentEditIndex || 0,
          isCommandBarVisible: (data.pendingEdits || []).some(
            (e: PendingEdit) => e.status === "pending"
          ),
          isLoading: false,
          isInitialized: true,
        });

        console.log(
          "[EditStore] Initialized from server:",
          data.pendingEdits?.length || 0,
          "edits"
        );
      } else {
        console.error("[EditStore] Failed to load from server:", response.statusText);
        set({ isLoading: false, isInitialized: true });
      }
    } catch (err) {
      console.error("[EditStore] Error loading from server:", err);
      set({ isLoading: false, isInitialized: true });
    }
  },

  refreshFromServer: async (projectId: string) => {
    const { isLoading } = get();
    if (isLoading) return;

    set({ isLoading: true });

    try {
      const response = await fetch(`/api/pending-edits?projectId=${projectId}`);
      if (response.ok) {
        const result = await response.json();
        const data = result.data;

        set({
          pendingEdits: data.pendingEdits || [],
          currentEditIndex: data.currentEditIndex || 0,
          isCommandBarVisible: (data.pendingEdits || []).some(
            (e: PendingEdit) => e.status === "pending"
          ),
          isLoading: false,
        });
      } else {
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },

  setYjsRefs: (ydoc: Y.Doc, ytext: Y.Text, fileId: string) => {
    set({ currentYDoc: ydoc, currentYText: ytext, currentFileId: fileId });
  },

  clearYjsRefs: () => {
    set({ currentYDoc: null, currentYText: null, currentFileId: null });
  },

  updateLineNumbersFromRelPos: () => {
    const { pendingEdits, currentYDoc, currentYText, currentFileId } = get();

    if (!currentYDoc || !currentYText || !currentFileId) {
      console.log("[EditStore] updateLineNumbersFromRelPos: missing Yjs refs");
      return;
    }

    // Update line numbers for pending edits of the current file
    let hasChanges = false;
    const updatedEdits = pendingEdits.map(edit => {
      // Only update the pending edit for the current file
      if (edit.status !== "pending") return edit;

      // Check whether file paths match
      const fileMatch =
        edit.filePath === currentFileId ||
        edit.filePath.endsWith(currentFileId) ||
        currentFileId.endsWith(edit.filePath);

      if (!fileMatch) return edit;

      // Update line numbers for each block using RelPos
      const updatedBlocks = edit.blocks.map(block => {
        if (!block.startRelPos || !block.endRelPos) {
          console.log("[EditStore] Block missing RelPos");
          return block;
        }

        const { startLine, endLine } = getEffectiveLineNumbers(
          block,
          currentYDoc,
          currentYText
        );

        console.log(`[EditStore] RelPos calculated: ${startLine}-${endLine}, stored: ${block.startLine}-${block.endLine}`);

        if (startLine !== block.startLine || endLine !== block.endLine) {
          hasChanges = true;
          return { ...block, startLine, endLine };
        }

        return block;
      });

      return { ...edit, blocks: updatedBlocks };
    });

    if (hasChanges) {
      console.log("[EditStore] Line numbers changed, updating state");
      set({ pendingEdits: updatedEdits });
    }
  },

  syncToServer: async () => {
    const { currentProjectId, pendingEdits, currentEditIndex, isSyncing } = get();

    if (!currentProjectId) {
      console.warn("[EditStore] No projectId, skipping sync");
      return;
    }

    // Debounce sync calls
    if (syncTimeout) {
      clearTimeout(syncTimeout);
    }

    syncTimeout = setTimeout(async () => {
      if (isSyncing) {
        return;
      }

      set({ isSyncing: true });

      try {
        const response = await fetch("/api/pending-edits", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: currentProjectId,
            action: "save",
            pendingEdits,
            currentEditIndex,
          }),
        });

        if (!response.ok) {
          console.error("[EditStore] Failed to sync to server:", response.statusText);
        }
      } catch (err) {
        console.error("[EditStore] Error syncing to server:", err);
      } finally {
        set({ isSyncing: false });
      }
    }, SYNC_DEBOUNCE_MS);
  },

  addEdit: async (edit) => {
    // CRITICAL: Always use the projectId from the edit itself!
    // Do NOT use currentProjectId - it may have changed if user switched projects
    // while an AI request was in progress.
    const projectId = edit.projectId;
    const { currentProjectId } = get();

    if (!projectId) {
      console.error("[EditStore] Cannot add edit: no project ID in edit");
      return;
    }

    // Warn if edit is for a different project than current
    if (projectId !== currentProjectId) {
      console.warn(`[EditStore] Edit projectId (${projectId}) differs from currentProjectId (${currentProjectId}). User may have switched projects.`);
      // Still process the edit - it should go to the correct project on server
    }

    // Let server handle smart merge - server always has the latest data
    try {
      const response = await fetch("/api/pending-edits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: projectId,  // Use edit's projectId, NOT currentProjectId
          filePath: edit.filePath,
          blocks: edit.blocks,
          description: edit.description,
        }),
      });

      if (response.ok) {
        const result = await response.json();

        // Server returns the FULL pendingEdits array after merge
        // Only update local state if the edit was for the CURRENT project
        // (user may have switched projects since the request was made)
        if (projectId === get().currentProjectId) {
          const serverPendingEdits = result.pendingEdits || [];
          const serverEditIndex = result.currentEditIndex || 0;

          console.log('[EditStore] Synced with server, total edits:', serverPendingEdits.length);

          set({
            pendingEdits: serverPendingEdits,
            currentEditIndex: serverEditIndex,
            isCommandBarVisible: serverPendingEdits.some((e: PendingEdit) => e.status === "pending"),
        });

          // Sync locks to Yjs after update
        const { syncLocksCallback, getPendingLocks } = get();
        if (syncLocksCallback) {
          syncLocksCallback(getPendingLocks());
          }
        } else {
          console.log(`[EditStore] Edit saved to project ${projectId}, but user is now in project ${get().currentProjectId}. Skipping local state update.`);
        }
      } else {
        console.error("[EditStore] Failed to add edit:", response.statusText);
      }
    } catch (err) {
      console.error("[EditStore] Error adding edit:", err);
    }
  },

  removeEdit: (editId) => {
    // Find the edit to get its projectId BEFORE removing
    const editToRemove = get().pendingEdits.find((e) => e.id === editId);
    const projectId = editToRemove?.projectId || get().currentProjectId;

    set((state) => {
      const newEdits = state.pendingEdits.filter((e) => e.id !== editId);
      return {
        pendingEdits: newEdits,
        currentEditIndex: Math.min(state.currentEditIndex, Math.max(0, newEdits.length - 1)),
        isCommandBarVisible: newEdits.some((e) => e.status === "pending"),
      };
    });

    // Sync to server using edit's projectId
    if (projectId) {
      fetch("/api/pending-edits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: projectId,
          action: "remove",
          editId,
        }),
      }).catch(console.error);
    }

    // Sync locks to Yjs after removing
    const { syncLocksCallback, getPendingLocks } = get();
    if (syncLocksCallback) {
      syncLocksCallback(getPendingLocks());
    }
  },

  // DEPRECATED: With RelativePosition, line number adjustment is automatic
  adjustLineNumbers: (_filePath: string, _afterLine: number, _offset: number) => {
    // No-op: RelativePosition handles position tracking automatically
    // The actual line numbers are calculated from RelativePosition at render time
    console.log("[EditStore] adjustLineNumbers is deprecated - using RelativePosition now");

    // Sync to server after adjustment
    get().syncToServer();
  },

  setApplyCallback: (callback) => {
    set({ applyCallback: callback });
  },

  setNavigateToFileCallback: (callback) => {
    set({ navigateToFileCallback: callback });
  },

  setGetBaseContentCallback: (callback) => {
    set({ getBaseContentCallback: callback });
  },

  setSyncLocksCallback: (callback) => {
    set({ syncLocksCallback: callback });
  },

  setCurrentUserInfo: (userId, userName, userColor) => {
    set({ currentUserId: userId, currentUserName: userName, currentUserColor: userColor });
  },

  // Note: setYjsRefs and clearYjsRefs have been removed
  // Server now handles position tracking via RelativePosition

  getPendingLocks: () => {
    const { pendingEdits, currentUserId, currentUserName, currentUserColor } = get();

    if (!currentUserId || !currentUserName || !currentUserColor) {
      return [];
    }

    const locks: PendingLockInfo[] = [];

    for (const edit of pendingEdits) {
      if (edit.status !== "pending") continue;

      for (const block of edit.blocks) {
        // Get line numbers - server keeps them up-to-date
        const { startLine, endLine } = getEffectiveLineNumbers(block);

        locks.push({
          id: `${edit.id}_${locks.length}`,
          userId: currentUserId,
          userName: currentUserName,
          userColor: currentUserColor,
          fileId: edit.filePath,
          startLine,
          endLine,
          startRelPos: block.startRelPos,
          endRelPos: block.endRelPos,
          createdAt: edit.createdAt,
        });
      }
    }

    return locks;
  },

  getEditLocks: (filePath: string, ownUserId?: string) => {
    const { pendingEdits, currentUserId } = get();
    const userId = ownUserId || currentUserId;

    const locks: EditLock[] = [];

    for (const edit of pendingEdits) {
      if (edit.filePath !== filePath || edit.status !== "pending") continue;

      for (const block of edit.blocks) {
        // Get line numbers - server keeps them up-to-date
        const { startLine, endLine } = getEffectiveLineNumbers(block);

        locks.push({
          editId: edit.id,
          startLine,
          endLine,
          startRelPos: block.startRelPos,
          endRelPos: block.endRelPos,
          isOwn: true,  // All our pending edits are "own"
          userName: undefined,
          userColor: undefined,
        });
      }
    }

    return locks;
  },

  setEditsFromLocal: (edits: PendingEdit[]) => {
    // Convert to ensure all required fields are present
    const convertedEdits: PendingEdit[] = edits.map((edit) => ({
      id: edit.id || `edit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      filePath: edit.filePath,
      projectId: get().currentProjectId || "",
      blocks: edit.blocks,
      description: edit.description,
      status: edit.status,
      createdAt: edit.createdAt || Date.now(),
    }));

    set({
      pendingEdits: convertedEdits,
      isCommandBarVisible: convertedEdits.some((e) => e.status === "pending"),
    });

    // Sync locks to Yjs
    const { syncLocksCallback, getPendingLocks } = get();
    if (syncLocksCallback) {
      syncLocksCallback(getPendingLocks());
    }
  },

  navigateToCurrentEdit: () => {
    const { pendingEdits, currentEditIndex, navigateToFileCallback } = get();
    const currentEdit = pendingEdits[currentEditIndex];
    if (currentEdit && navigateToFileCallback) {
      // Use the endLine of the last block so jumping here shows the full updated content (new part)
      const blocks = currentEdit.blocks;
      const lastBlock = blocks?.[blocks.length - 1];
      const targetLine = lastBlock?.endLine;
      navigateToFileCallback(currentEdit.filePath, targetLine);
    }
  },

  setCurrentEditIndex: (index) => {
    const { pendingEdits } = get();
    if (index >= 0 && index < pendingEdits.length) {
      set({ currentEditIndex: index });
      get().syncToServer();
    }
  },

  nextEdit: () => {
    const { pendingEdits, currentEditIndex } = get();
    const pendingOnly = pendingEdits.filter((e) => e.status === "pending");
    if (pendingOnly.length === 0) return;

    for (let i = currentEditIndex + 1; i < pendingEdits.length; i++) {
      if (pendingEdits[i].status === "pending") {
        set({ currentEditIndex: i });
        get().syncToServer();
        return;
      }
    }
    for (let i = 0; i < currentEditIndex; i++) {
      if (pendingEdits[i].status === "pending") {
        set({ currentEditIndex: i });
        get().syncToServer();
        return;
      }
    }
  },

  prevEdit: () => {
    const { pendingEdits, currentEditIndex } = get();
    const pendingOnly = pendingEdits.filter((e) => e.status === "pending");
    if (pendingOnly.length === 0) return;

    for (let i = currentEditIndex - 1; i >= 0; i--) {
      if (pendingEdits[i].status === "pending") {
        set({ currentEditIndex: i });
        get().syncToServer();
        return;
      }
    }
    for (let i = pendingEdits.length - 1; i > currentEditIndex; i--) {
      if (pendingEdits[i].status === "pending") {
        set({ currentEditIndex: i });
        get().syncToServer();
        return;
      }
    }
  },

  nextFile: () => {
    const { pendingEdits, currentEditIndex } = get();
    const currentFile = pendingEdits[currentEditIndex]?.filePath;
    if (!currentFile) return;

    for (let i = currentEditIndex + 1; i < pendingEdits.length; i++) {
      if (pendingEdits[i].filePath !== currentFile && pendingEdits[i].status === "pending") {
        set({ currentEditIndex: i });
        get().syncToServer();
        return;
      }
    }
    for (let i = 0; i < currentEditIndex; i++) {
      if (pendingEdits[i].filePath !== currentFile && pendingEdits[i].status === "pending") {
        set({ currentEditIndex: i });
        get().syncToServer();
        return;
      }
    }
  },

  prevFile: () => {
    const { pendingEdits, currentEditIndex } = get();
    const currentFile = pendingEdits[currentEditIndex]?.filePath;
    if (!currentFile) return;

    for (let i = currentEditIndex - 1; i >= 0; i--) {
      if (pendingEdits[i].filePath !== currentFile && pendingEdits[i].status === "pending") {
        set({ currentEditIndex: i });
        get().syncToServer();
        return;
      }
    }
    for (let i = pendingEdits.length - 1; i > currentEditIndex; i--) {
      if (pendingEdits[i].filePath !== currentFile && pendingEdits[i].status === "pending") {
        set({ currentEditIndex: i });
        get().syncToServer();
        return;
      }
    }
  },

  applyEdit: async (editId) => {
    const { pendingEdits, currentYDoc, currentYText, currentFileId } = get();
    const edit = pendingEdits.find((e) => e.id === editId);
    if (!edit || edit.status !== "pending") return;

    // Set status to applying
    set((state) => ({
      pendingEdits: state.pendingEdits.map((e) =>
        e.id === editId ? { ...e, status: "applying" as const } : e
      ),
    }));

    try {
      // 🔑 KEY FIX: Update block line numbers using RelativePosition before sending
      // This ensures we apply edits at the CURRENT position, not the stale stored position
      let blocksToSend = edit.blocks;

      // Check if this edit is for the current file and we have Yjs refs
      const isCurrentFile = currentFileId && (
        edit.filePath === currentFileId ||
        edit.filePath.endsWith(currentFileId) ||
        currentFileId.endsWith(edit.filePath)
      );

      if (isCurrentFile && currentYDoc && currentYText) {
        blocksToSend = edit.blocks.map(block => {
          const { startLine, endLine } = getEffectiveLineNumbers(block, currentYDoc, currentYText);
          console.log(`[EditStore] applyEdit: RelPos → line ${startLine}-${endLine} (stored: ${block.startLine}-${block.endLine})`);
          return {
            ...block,
            startLine,
            endLine,
          };
        });
      } else {
        console.warn(`[EditStore] applyEdit: No Yjs refs for file ${edit.filePath}, using stored line numbers`);
      }

      // Write to Layer 3: file system + Yjs via API
      // The Yjs server update will automatically sync to CodeMirror via WebSocket
      const response = await fetch("/api/chat", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: edit.projectId,
          filePath: edit.filePath,
          blocks: blocksToSend,
          action: "apply",
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error("Failed to apply edit via API:", error);
        set((state) => ({
          pendingEdits: state.pendingEdits.map((e) =>
            e.id === editId ? { ...e, status: "pending" as const } : e
          ),
        }));
        return;
      }

      // Mark as applied and remove from pending
      set((state) => ({
        pendingEdits: state.pendingEdits.filter((e) => e.id !== editId),
      }));

      get().nextEdit();

      // Sync to server and locks
      get().syncToServer();

      const { syncLocksCallback, getPendingLocks } = get();
      if (syncLocksCallback) {
        syncLocksCallback(getPendingLocks());
      }
    } catch (err) {
      console.error("Failed to apply edit:", err);
      set((state) => ({
        pendingEdits: state.pendingEdits.map((e) =>
          e.id === editId ? { ...e, status: "pending" as const } : e
        ),
      }));
    }

    const { pendingEdits: currentEdits } = get();
    if (!currentEdits.some((e) => e.status === "pending")) {
      set({ isCommandBarVisible: false });
    }
  },

  rejectEdit: (editId) => {
    // Find the edit to get its projectId BEFORE removing
    const editToReject = get().pendingEdits.find((e) => e.id === editId);

    // Early return if edit doesn't exist (matches applyEdit behavior)
    if (!editToReject) return;

    const projectId = editToReject.projectId;

    // Reject = Undo = remove from pending edits
    // The display will automatically revert since we synthesize from base + pending
    set((state) => ({
      pendingEdits: state.pendingEdits.filter((e) => e.id !== editId),
    }));

    get().nextEdit();

    // Sync to server using edit's projectId
    if (projectId) {
      fetch("/api/pending-edits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: projectId,
          action: "remove",
          editId,
        }),
      }).catch(console.error);
    }

    const { pendingEdits, syncLocksCallback, getPendingLocks } = get();
    if (!pendingEdits.some((e) => e.status === "pending")) {
      set({ isCommandBarVisible: false });
    }

    // Sync locks to Yjs after rejecting
    if (syncLocksCallback) {
      syncLocksCallback(getPendingLocks());
    }
  },

  applyAll: async () => {
    const { pendingEdits } = get();
    const pendingOnly = pendingEdits.filter((e) => e.status === "pending");

    for (const edit of pendingOnly) {
      await get().applyEdit(edit.id);
    }
  },

  rejectAll: () => {
    const { currentProjectId, pendingEdits } = get();

    // Reject all = Undo all = clear all pending edits
    set({
      pendingEdits: [],
      currentEditIndex: 0,
      isCommandBarVisible: false,
    });

    // Clear on server
    if (currentProjectId) {
      fetch("/api/pending-edits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: currentProjectId,
          action: "clear",
        }),
      }).catch(console.error);
    }

    // Sync locks to Yjs after rejecting all
    const { syncLocksCallback } = get();
    if (syncLocksCallback) {
      syncLocksCallback([]);
    }
  },

  showCommandBar: () => set({ isCommandBarVisible: true }),
  hideCommandBar: () => set({ isCommandBarVisible: false }),

  clearAll: () => {
    const { currentProjectId } = get();

    set({
      pendingEdits: [],
      currentEditIndex: 0,
      isCommandBarVisible: false,
    });

    // Clear on server
    if (currentProjectId) {
      fetch("/api/pending-edits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: currentProjectId,
          action: "clear",
        }),
      }).catch(console.error);
    }
  },

  getCurrentEdit: () => {
    const { pendingEdits, currentEditIndex } = get();
    return pendingEdits[currentEditIndex] || null;
  },

  getPendingCount: () => {
    return get().pendingEdits.filter((e) => e.status === "pending").length;
  },

  getUniqueFiles: () => {
    const { pendingEdits } = get();
    const pending = pendingEdits.filter((e) => e.status === "pending");
    return Array.from(new Set(pending.map((e) => e.filePath)));
  },

  getCurrentFileIndex: () => {
    const { pendingEdits, currentEditIndex } = get();
    const currentFile = pendingEdits[currentEditIndex]?.filePath;
    if (!currentFile) return 0;

    const uniqueFiles = get().getUniqueFiles();
    return uniqueFiles.indexOf(currentFile);
  },

  // Content synthesis: apply all pending edits to base content (LINE-BASED)
  synthesizeContent: (filePath: string, baseContent: string): string => {
    const { pendingEdits } = get();
    const editsForFile = pendingEdits.filter(
      (e) => e.filePath === filePath && e.status === "pending"
    );

    if (editsForFile.length === 0) {
      return baseContent;
    }

    let result = baseContent;
    for (const edit of editsForFile) {
      result = applyEditBlocksToContent(result, edit.blocks);
    }

    return result;
  },

  getEditsForFile: (filePath: string): PendingEdit[] => {
    const { pendingEdits } = get();
    return pendingEdits.filter(
      (e) => e.filePath === filePath && e.status === "pending"
    );
  },

  hasEditsForFile: (filePath: string): boolean => {
    const { pendingEdits } = get();
    return pendingEdits.some(
      (e) => e.filePath === filePath && e.status === "pending"
    );
  },
}));

// Re-export EditBlock type for convenience
export type { EditBlock };

export default useEditStore;
