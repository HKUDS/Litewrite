"use client";

import {
  EditorView,
  Decoration,
  DecorationSet,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import {
  StateField,
  StateEffect,
  RangeSetBuilder,
  Text,
  EditorState,
  Transaction,
} from "@codemirror/state";
import * as Y from "yjs";
import type { EditLock, PendingLockInfo, RelativePositionJSON } from "@/types/ask";

/**
 * Effect to set own edit locks (from pending edits)
 */
export const setOwnLocksEffect = StateEffect.define<EditLock[]>();

/**
 * Effect to set remote locks (from other collaborators via Yjs)
 */
export const setRemoteLocksEffect = StateEffect.define<PendingLockInfo[]>();

/**
 * Effect to set the current file path
 */
export const setLockFileEffect = StateEffect.define<string>();

/**
 * Effect to set current user ID
 */
export const setCurrentUserIdEffect = StateEffect.define<string>();

/**
 * Effect to set Yjs refs for RelativePosition calculations
 */
export const setLockYjsRefsEffect = StateEffect.define<{
  ydoc: Y.Doc | null;
  ytext: Y.Text | null;
}>();

/**
 * Calculate current line number from RelativePosition
 * This is the key function that makes position tracking robust.
 */
function getCurrentLineFromRelPos(
  ydoc: Y.Doc | null,
  ytext: Y.Text | null,
  relPosJson: RelativePositionJSON | undefined
): number | null {
  if (!ydoc || !ytext || !relPosJson) {
    return null;
  }

  try {
    const relPos = Y.createRelativePositionFromJSON(relPosJson);
    const absPos = Y.createAbsolutePositionFromRelativePosition(relPos, ydoc);

    if (!absPos) {
      return null;
    }

    const content = ytext.toString();
    const beforeOffset = content.substring(0, absPos.index);
    return beforeOffset.split('\n').length;
  } catch (err) {
    console.error("[LockExtension] Failed to get line from RelativePosition:", err);
    return null;
  }
}

/**
 * Widget to show who owns a locked region
 */
class LockOwnerWidget extends WidgetType {
  constructor(
    readonly userName: string,
    readonly userColor: string
  ) {
    super();
  }

  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-lock-owner-badge";
    wrapper.style.setProperty("--user-color", this.userColor);
    wrapper.textContent = `🔒 ${this.userName}`;
    wrapper.title = `This region is being edited by ${this.userName}`;
    return wrapper;
  }

  eq(other: LockOwnerWidget) {
    return other.userName === this.userName && other.userColor === this.userColor;
  }

  ignoreEvent() {
    return true;
  }
}

/**
 * Convert line number (1-based) to document offset
 */
function lineToOffset(doc: Text, lineNumber: number): number {
  if (lineNumber < 1) return 0;
  if (lineNumber > doc.lines) return doc.length;
  return doc.line(lineNumber).from;
}

/**
 * Get the end of a line (before newline)
 */
function lineEndOffset(doc: Text, lineNumber: number): number {
  if (lineNumber < 1) return 0;
  if (lineNumber > doc.lines) return doc.length;
  return doc.line(lineNumber).to;
}

/**
 * Check if file path matches
 */
function filePathMatches(lockPath: string, currentPath: string): boolean {
  if (!lockPath || !currentPath) return false;

  // Exact match
  if (lockPath === currentPath) return true;

  // Match by filename
  const lockFileName = lockPath.split("/").pop() || lockPath;
  const currentFileName = currentPath.split("/").pop() || currentPath;
  if (lockFileName === currentFileName) return true;

  // Match by suffix
  if (lockPath.endsWith(currentFileName) || currentPath.endsWith(lockFileName)) return true;

  return false;
}

/**
 * Lock state field - tracks all locks and their decorations
 */
interface LockState {
  ownLocks: EditLock[];
  remoteLocks: PendingLockInfo[];
  filePath: string;
  currentUserId: string;
  // Yjs refs for RelativePosition calculations
  ydoc: Y.Doc | null;
  ytext: Y.Text | null;
  decorations: DecorationSet;
  // Cached lock ranges for change filter
  lockedRanges: Array<{ from: number; to: number }>;
}

/**
 * Build lock decorations using RelativePosition for robust tracking
 * NO FALLBACK to stored line numbers - RelativePosition is the ONLY source of truth
 */
function buildLockDecorations(
  doc: Text,
  ownLocks: EditLock[],
  remoteLocks: PendingLockInfo[],
  filePath: string,
  currentUserId: string,
  ydoc: Y.Doc | null,
  ytext: Y.Text | null
): { decorations: DecorationSet; lockedRanges: Array<{ from: number; to: number }> } {
  const builder = new RangeSetBuilder<Decoration>();
  const lockedRanges: Array<{ from: number; to: number }> = [];

  interface DecorationEntry {
    from: number;
    to: number;
    decoration: Decoration;
  }

  const decorations: DecorationEntry[] = [];

  // Process own locks - these are our pending edits (show as locked but no owner badge)
  for (const lock of ownLocks) {
    // Get current line numbers from RelativePosition (NO FALLBACK!)
    let startLine = lock.startLine;
    let endLine = lock.endLine;

    if (lock.startRelPos && lock.endRelPos && ydoc && ytext) {
      const relStartLine = getCurrentLineFromRelPos(ydoc, ytext, lock.startRelPos);
      const relEndLine = getCurrentLineFromRelPos(ydoc, ytext, lock.endRelPos);

      if (relStartLine === null || relEndLine === null) {
        // Position was deleted - skip this lock
        console.warn("[LockExtension] Failed to resolve own lock RelativePosition, skipping");
        continue;
      }

      startLine = relStartLine;
      endLine = relEndLine;
    } else if (!lock.startRelPos || !lock.endRelPos) {
      // Lock missing RelativePosition - skip
      console.warn("[LockExtension] Own lock missing RelativePosition, skipping");
      continue;
    }

    if (startLine < 1 || endLine < startLine) continue;

    const clampedStartLine = Math.min(startLine, doc.lines);
    const clampedEndLine = Math.min(endLine, doc.lines);

    const from = lineToOffset(doc, clampedStartLine);
    // The lock range should include the newline: use the start of the next line as `to`.
    // This ensures even empty lines are locked correctly.
    const to = clampedEndLine < doc.lines
      ? lineToOffset(doc, clampedEndLine + 1)  // Start of next line (includes newline)
      : doc.length;  // Last line: use end of document

    // Add to locked ranges (for change filter)
    lockedRanges.push({ from, to });

    // Add decoration for own lock (using line decoration for empty lines)
    for (let lineNum = clampedStartLine; lineNum <= clampedEndLine; lineNum++) {
      const lineStart = doc.line(lineNum).from;
      decorations.push({
        from: lineStart,
        to: lineStart,
        decoration: Decoration.line({ class: "cm-own-pending-lock-line" }),
      });
    }
  }

  // Process remote locks - these are other users' pending edits
  for (const lock of remoteLocks) {
    // Skip if it's our own lock
    if (lock.userId === currentUserId) continue;

    // Skip if different file
    if (!filePathMatches(lock.fileId, filePath)) continue;

    // Get current line numbers from RelativePosition (NO FALLBACK!)
    let startLine = lock.startLine;
    let endLine = lock.endLine;

    if (lock.startRelPos && lock.endRelPos && ydoc && ytext) {
      const relStartLine = getCurrentLineFromRelPos(ydoc, ytext, lock.startRelPos);
      const relEndLine = getCurrentLineFromRelPos(ydoc, ytext, lock.endRelPos);

      if (relStartLine === null || relEndLine === null) {
        // Position was deleted - skip this lock
        console.warn("[LockExtension] Failed to resolve remote lock RelativePosition, skipping");
        continue;
      }

      startLine = relStartLine;
      endLine = relEndLine;
    } else if (!lock.startRelPos || !lock.endRelPos) {
      // Lock missing RelativePosition - skip
      console.warn("[LockExtension] Remote lock missing RelativePosition, skipping");
      continue;
    }

    if (startLine < 1 || endLine < startLine) continue;

    const clampedStartLine = Math.min(startLine, doc.lines);
    const clampedEndLine = Math.min(endLine, doc.lines);

    const from = lineToOffset(doc, clampedStartLine);
    // The lock range should include the newline: use the start of the next line as `to`.
    const to = clampedEndLine < doc.lines
      ? lineToOffset(doc, clampedEndLine + 1)
      : doc.length;

    // Add to locked ranges (for change filter)
    lockedRanges.push({ from, to });

    // Add decoration for remote lock (using line decoration for empty lines)
    for (let lineNum = clampedStartLine; lineNum <= clampedEndLine; lineNum++) {
      const lineStart = doc.line(lineNum).from;
      decorations.push({
        from: lineStart,
        to: lineStart,
        decoration: Decoration.line({
          class: "cm-remote-lock-line",
          attributes: { "data-user": lock.userName }
        }),
      });
    }

    // Add owner badge at the start
    decorations.push({
      from,
      to: from,
      decoration: Decoration.widget({
        widget: new LockOwnerWidget(lock.userName, lock.userColor),
        side: -1, // Before content
      }),
    });
  }

  // Sort decorations by position
  decorations.sort((a, b) => a.from - b.from || a.to - b.to);

  for (const { from, to, decoration } of decorations) {
    builder.add(from, to, decoration);
  }

  return { decorations: builder.finish(), lockedRanges };
}

/**
 * State field for lock management with RelativePosition support
 */
export const lockStateField = StateField.define<LockState>({
  create() {
    return {
      ownLocks: [],
      remoteLocks: [],
      filePath: "",
      currentUserId: "",
      ydoc: null,
      ytext: null,
      decorations: Decoration.none,
      lockedRanges: [],
    };
  },

  update(state, tr) {
    let { ownLocks, remoteLocks, filePath, currentUserId, ydoc, ytext, decorations, lockedRanges } = state;
    let needsRebuild = false;

    for (const effect of tr.effects) {
      if (effect.is(setOwnLocksEffect)) {
        ownLocks = effect.value;
        needsRebuild = true;
      }
      if (effect.is(setRemoteLocksEffect)) {
        remoteLocks = effect.value;
        needsRebuild = true;
      }
      if (effect.is(setLockFileEffect)) {
        filePath = effect.value;
        needsRebuild = true;
      }
      if (effect.is(setCurrentUserIdEffect)) {
        currentUserId = effect.value;
        needsRebuild = true;
      }
      if (effect.is(setLockYjsRefsEffect)) {
        ydoc = effect.value.ydoc;
        ytext = effect.value.ytext;
        needsRebuild = true;
      }
    }

    // Rebuild if document changed or state changed
    // RelativePosition automatically gives us correct current line numbers
    if (needsRebuild || tr.docChanged) {
      const result = buildLockDecorations(
        tr.state.doc, ownLocks, remoteLocks, filePath, currentUserId, ydoc, ytext
      );
      decorations = result.decorations;
      lockedRanges = result.lockedRanges;
    }

    return { ownLocks, remoteLocks, filePath, currentUserId, ydoc, ytext, decorations, lockedRanges };
  },

  provide: (field) => EditorView.decorations.from(field, (state) => state.decorations),
});

/**
 * Change filter to prevent edits in locked regions
 */
export const lockChangeFilter = EditorState.changeFilter.of((tr: Transaction) => {
  // If no changes, allow
  if (!tr.docChanged) return true;

  // Allow non-user operations (like Yjs sync) - only block user edits
  // User operations have Transaction.userEvent annotation (e.g., "input", "delete")
  // Yjs sync does NOT have userEvent, so it passes through
  if (!tr.annotation(Transaction.userEvent)) return true;

  const lockState = tr.startState.field(lockStateField);
  const lockedRanges = lockState.lockedRanges;

  // If no locked ranges, allow all
  if (lockedRanges.length === 0) return true;

  // Check each change against locked ranges
  let allowedRanges: Array<{ from: number; to: number }> = [];
  let hasBlockedChanges = false;

  tr.changes.iterChanges((fromA, toA) => {
    // Check if this change overlaps with any locked range
    let isBlocked = false;

    for (const lock of lockedRanges) {
      // Check for overlap:
      // - toA < lock.from: change ends before lock starts (allowed)
      // - fromA >= lock.to: change starts at or after lock ends (allowed)
      // Note: use < instead of <= for toA to block insertions at lock.from
      if (!(toA < lock.from || fromA >= lock.to)) {
        // Overlap detected - block this change
        isBlocked = true;
        hasBlockedChanges = true;
        break;
      }
    }

    if (!isBlocked) {
      allowedRanges.push({ from: fromA, to: toA });
    }
  });

  // If any changes were blocked, reject the entire transaction
  if (hasBlockedChanges) {
    console.log("[LockFilter] Blocked edit in locked region");
    return false;
  }

  return true;
});

/**
 * Theme for lock decorations
 */
export const lockTheme = EditorView.theme({
  // Own pending lock (line-level, includes empty lines)
  ".cm-own-pending-lock-line": {
    backgroundColor: "hsl(210 50% 50% / 0.08)",
    borderLeft: "2px solid hsl(210 50% 50% / 0.4)",
  },

  // Legacy mark-based style (kept for compatibility)
  ".cm-own-pending-lock": {
    backgroundColor: "hsl(210 50% 50% / 0.1)",
    borderRadius: "2px",
    outline: "1px dashed hsl(210 50% 50% / 0.3)",
    outlineOffset: "-1px",
  },

  // Remote lock (line-level, includes empty lines)
  ".cm-remote-lock-line": {
    backgroundColor: "hsl(0 0% 50% / 0.12)",
    borderLeft: "2px solid hsl(0 0% 50% / 0.5)",
    cursor: "not-allowed",
  },

  // Legacy mark-based style (kept for compatibility)
  ".cm-remote-lock": {
    backgroundColor: "hsl(0 0% 50% / 0.15)",
    borderRadius: "2px",
    cursor: "not-allowed",
  },

  // Lock owner badge
  ".cm-lock-owner-badge": {
    display: "inline-block",
    padding: "2px 6px",
    marginRight: "4px",
    borderRadius: "3px",
    fontSize: "10px",
    fontWeight: "500",
    fontFamily: "system-ui, sans-serif",
    backgroundColor: "var(--user-color, hsl(210 50% 50%))",
    color: "white",
    opacity: "0.9",
    verticalAlign: "middle",
  },
});

/**
 * Get all lock extensions
 */
export function getLockExtensions() {
  return [
    lockStateField,
    lockChangeFilter,
    lockTheme,
  ];
}

/**
 * Helper to update own locks in the editor
 */
export function setOwnLocks(view: EditorView, locks: EditLock[]) {
  view.dispatch({
    effects: setOwnLocksEffect.of(locks),
  });
}

/**
 * Helper to update remote locks in the editor
 */
export function setRemoteLocks(view: EditorView, locks: PendingLockInfo[]) {
  view.dispatch({
    effects: setRemoteLocksEffect.of(locks),
  });
}

/**
 * Helper to set current file path
 */
export function setLockFile(view: EditorView, filePath: string) {
  view.dispatch({
    effects: setLockFileEffect.of(filePath),
  });
}

/**
 * Helper to set current user ID
 */
export function setCurrentUserId(view: EditorView, userId: string) {
  view.dispatch({
    effects: setCurrentUserIdEffect.of(userId),
  });
}

/**
 * Helper to set Yjs refs for RelativePosition calculations
 * Call this when the editor initializes or when switching files
 */
export function setLockYjsRefs(view: EditorView, ydoc: Y.Doc | null, ytext: Y.Text | null) {
  view.dispatch({
    effects: setLockYjsRefsEffect.of({ ydoc, ytext }),
  });
}
