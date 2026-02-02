"use client";

import {
  EditorView,
  Decoration,
  DecorationSet,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import { StateField, StateEffect, RangeSetBuilder, Text } from "@codemirror/state";
import * as Y from "yjs";
import { useEditStore, type PendingEdit } from "@/stores/edit-store";
import type { EditBlock, RelativePositionJSON } from "@/types/ask";

/**
 * Effect to update pending edits in the editor
 */
export const setPendingEditsEffect = StateEffect.define<PendingEdit[]>();

/**
 * Effect to set the current file path (for filtering edits)
 */
export const setCurrentFileEffect = StateEffect.define<string>();

/**
 * Effect to set Yjs references for local line number calculation
 */
export const setYjsRefsEffect = StateEffect.define<{
  ydoc: Y.Doc | null;
  ytext: Y.Text | null;
}>();

/**
 * LINE NUMBER TRACKING (Diff-Based Architecture):
 *
 * Compute line numbers locally with Yjs + RelativePosition for zero latency.
 *
 * 1. Server stores blocks; each block has startRelPos/endRelPos (CRDT ID)
 * 2. Frontend caches ydoc/ytext references
 * 3. When rendering, compute current startLine/endLine locally from RelPos
 * 4. No server request needed: zero latency
 */

/**
 * Compute current line number from RelativePosition.
 */
function getLineFromRelPos(
  ydoc: Y.Doc | null,
  ytext: Y.Text | null,
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
  } catch {
    return null;
  }
}

/**
 * Get effective line numbers for a block
 * If Yjs refs and RelPos are available, compute locally (zero latency); otherwise use stored line numbers.
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

    console.log(`[InlineDiff] getEffectiveLineNumbers: RelPos → ${startLine}-${endLine}, stored: ${block.startLine}-${block.endLine}`);

    if (startLine !== null && endLine !== null) {
      return { startLine, endLine };
    }
    console.log("[InlineDiff] RelPos calculation returned null, falling back to stored");
  } else {
    console.log(`[InlineDiff] Missing refs: ydoc=${!!ydoc}, ytext=${!!ytext}, startRelPos=${!!block.startRelPos}, endRelPos=${!!block.endRelPos}`);
  }

  // Fallback: use stored line numbers
  return { startLine: block.startLine, endLine: block.endLine };
}

/**
 * Widget to show the updated (new) content below the original
 * This shows what the content will become after Keep
 */
class UpdatedContentWidget extends WidgetType {
  constructor(
    readonly updatedText: string,
    readonly editId: string
  ) {
    super();
  }

  toDOM() {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-diff-updated-wrapper";

    // Header with actions
    const header = document.createElement("div");
    header.className = "cm-diff-updated-header";

    // Label
    const label = document.createElement("span");
    label.className = "cm-diff-label";
    label.innerHTML = "→ New:";

    // Actions container
    const actions = document.createElement("span");
    actions.className = "cm-diff-actions";

    // Undo button
    const undoBtn = document.createElement("button");
    undoBtn.className = "cm-diff-action-btn cm-diff-action-reject";
    undoBtn.innerHTML = "✕ Undo";
    undoBtn.title = "Undo this change";
    undoBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      useEditStore.getState().rejectEdit(this.editId);
    };

    // Keep button
    const keepBtn = document.createElement("button");
    keepBtn.className = "cm-diff-action-btn cm-diff-action-accept";
    keepBtn.innerHTML = "✓ Keep";
    keepBtn.title = "Keep this change";
    keepBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      useEditStore.getState().applyEdit(this.editId);
    };

    actions.appendChild(undoBtn);
    actions.appendChild(keepBtn);
    header.appendChild(label);
    header.appendChild(actions);

    // Updated content
    const contentContainer = document.createElement("div");
    contentContainer.className = "cm-diff-updated-content";

    const lines = this.updatedText.split("\n");
    lines.forEach((line) => {
      const lineDiv = document.createElement("div");
      lineDiv.className = "cm-diff-updated-line";

      const marker = document.createElement("span");
      marker.className = "cm-diff-line-marker cm-diff-add-marker";
      marker.textContent = "+";

      const content = document.createElement("span");
      content.className = "cm-diff-line-content cm-diff-add-content";
      content.textContent = line || " ";

      lineDiv.appendChild(marker);
      lineDiv.appendChild(content);
      contentContainer.appendChild(lineDiv);
    });

    wrapper.appendChild(header);
    wrapper.appendChild(contentContainer);

    return wrapper;
  }

  eq(other: UpdatedContentWidget) {
    return other.updatedText === this.updatedText && other.editId === this.editId;
  }

  ignoreEvent() {
    return false;
  }
}

/**
 * Interface for tracking decoration positions
 */
interface DiffDecoration {
  from: number;
  to: number;
  decoration: Decoration;
}

/**
 * StateField to track current file path
 */
export const currentFileField = StateField.define<string>({
  create() {
    return "";
  },
  update(filePath, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setCurrentFileEffect)) {
        return effect.value;
      }
    }
    return filePath;
  },
});

/**
 * Check if file path matches
 */
function filePathMatches(editPath: string, currentPath: string): boolean {
  if (!editPath || !currentPath) return false;

  // Exact match
  if (editPath === currentPath) return true;

  // Match by filename
  const editFileName = editPath.split("/").pop() || editPath;
  const currentFileName = currentPath.split("/").pop() || currentPath;
  if (editFileName === currentFileName) return true;

  // Match by suffix
  if (editPath.endsWith(currentFileName) || currentPath.endsWith(editFileName)) return true;

  return false;
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
 * Build decorations for pending edits (RelativePosition-aware)
 *
 * The editor shows the ORIGINAL content (from Yjs).
 * We mark the lines that will be replaced and show the new content below.
 *
 * LINE NUMBER CALCULATION (zero latency):
 * - Compute current line numbers locally with Yjs + RelativePosition
 * - No server request needed
 *
 * NOTE: Server-side is the single source of truth for pending edits.
 * All merge/dedup logic happens on the server. Frontend just renders what server provides.
 */
function buildDecorations(
  doc: Text,
  pendingEdits: PendingEdit[],
  currentFilePath: string,
  ydoc: Y.Doc | null,
  ytext: Y.Text | null
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  // Filter edits for current file (server already deduped, just filter by file)
  const editsForFile = pendingEdits.filter((e) => {
    return e.status === "pending" && filePathMatches(e.filePath, currentFilePath);
  });

  // Collect all decorations
  const decorations: DiffDecoration[] = [];

  for (const edit of editsForFile) {
    for (const block of edit.blocks) {
      // Get line numbers - compute locally using Yjs + RelPos (zero latency)
      const { startLine: effectiveStart, endLine: effectiveEnd } = getEffectiveLineNumbers(block, ydoc, ytext);

      // Validate line numbers
      if (effectiveStart < 1 || effectiveEnd < effectiveStart) {
        console.warn(`[InlineDiff] Invalid line range: ${effectiveStart}-${effectiveEnd}`);
        continue;
  }

      // Clamp to document bounds
      const startLine = Math.min(effectiveStart, doc.lines);
      const endLine = Math.min(effectiveEnd, doc.lines);

      // Mark each line with red background (using line decoration to include empty lines)
      for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
        if (lineNum >= 1 && lineNum <= doc.lines) {
          const lineStart = doc.line(lineNum).from;
    decorations.push({
            from: lineStart,
            to: lineStart,
            decoration: Decoration.line({ class: "cm-inline-diff-deleted-line" }),
    });
        }
      }

      // Add widget at the end of the marked region showing the new content
      const to = lineEndOffset(doc, endLine);
      decorations.push({
        from: to,
        to: to,
        decoration: Decoration.widget({
          widget: new UpdatedContentWidget(block.updated, edit.id),
          side: 1, // After the content
        }),
      });
    }
  }

  // Sort decorations by position and startSide (required by RangeSetBuilder)
  decorations.sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from;
    // For same 'from', compare startSide to ensure proper ordering
    // Decoration.startSide determines ordering for same-position decorations
    const aStartSide = (a.decoration as unknown as { startSide: number }).startSide ?? 0;
    const bStartSide = (b.decoration as unknown as { startSide: number }).startSide ?? 0;
    return aStartSide - bStartSide;
  });

  for (const { from, to, decoration } of decorations) {
    builder.add(from, to, decoration);
  }

  return builder.finish();
}

/**
 * StateField to track pending edits and their decorations
 *
 * Compute line numbers locally with Yjs + RelPos for zero latency.
 */
export const inlineDiffField = StateField.define<{
  edits: PendingEdit[];
  filePath: string;
  ydoc: Y.Doc | null;
  ytext: Y.Text | null;
  decorations: DecorationSet;
}>({
  create() {
    return {
      edits: [],
      filePath: "",
      ydoc: null,
      ytext: null,
      decorations: Decoration.none,
    };
  },

  update(state, tr) {
    let { edits, filePath, ydoc, ytext, decorations } = state;
    let needsRebuild = false;

    for (const effect of tr.effects) {
      if (effect.is(setPendingEditsEffect)) {
        edits = effect.value;
        needsRebuild = true;
      }
      if (effect.is(setCurrentFileEffect)) {
        filePath = effect.value;
        needsRebuild = true;
      }
      if (effect.is(setYjsRefsEffect)) {
        ydoc = effect.value.ydoc;
        ytext = effect.value.ytext;
        needsRebuild = true;
      }
    }

    // Rebuild if edits changed, Yjs refs changed, or document changed
    if (needsRebuild || tr.docChanged) {
      decorations = buildDecorations(tr.state.doc, edits, filePath, ydoc, ytext);
    }

    return { edits, filePath, ydoc, ytext, decorations };
  },

  provide: (field) => EditorView.decorations.from(field, (state) => state.decorations),
});

/**
 * Theme for inline diff decorations
 */
export const inlineDiffTheme = EditorView.theme({
  // Deleted/original content - light red background + left border
  ".cm-inline-diff-deleted-line": {
    backgroundColor: "hsl(0 60% 97%)",
    borderLeft: "3px solid hsl(0 65% 55%)",
  },

  // Legacy mark-based style (kept for compatibility)
  ".cm-inline-diff-deleted": {
    backgroundColor: "hsl(0 60% 97%)",
  },

  // Updated content wrapper
  ".cm-diff-updated-wrapper": {
    display: "block",
    marginTop: "4px",
    marginBottom: "4px",
    backgroundColor: "hsl(142 71% 45% / 0.1)",
    borderLeft: "3px solid hsl(142 71% 45%)",
    borderRadius: "0 4px 4px 0",
    overflow: "hidden",
  },

  // Header with label and actions
  ".cm-diff-updated-header": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "4px 8px",
    backgroundColor: "hsl(142 71% 45% / 0.15)",
    borderBottom: "1px solid hsl(142 71% 45% / 0.2)",
  },

  // Label
  ".cm-diff-label": {
    fontSize: "11px",
    fontWeight: "500",
    color: "hsl(142 71% 40%)",
    fontFamily: "system-ui, sans-serif",
  },

  // Action buttons container
  ".cm-diff-actions": {
    display: "flex",
    gap: "4px",
  },

  ".cm-diff-action-btn": {
    display: "inline-flex",
    alignItems: "center",
    gap: "2px",
    padding: "2px 8px",
    borderRadius: "4px",
    border: "1px solid",
    fontSize: "11px",
    fontWeight: "500",
    cursor: "pointer",
    transition: "all 0.15s ease",
    fontFamily: "system-ui, sans-serif",
  },

  ".cm-diff-action-reject": {
    backgroundColor: "hsl(0 84% 60% / 0.1)",
    borderColor: "hsl(0 84% 60% / 0.3)",
    color: "hsl(0 84% 50%)",
  },

  ".cm-diff-action-reject:hover": {
    backgroundColor: "hsl(0 84% 60% / 0.2)",
    borderColor: "hsl(0 84% 60% / 0.5)",
  },

  ".cm-diff-action-accept": {
    backgroundColor: "hsl(142 71% 45% / 0.1)",
    borderColor: "hsl(142 71% 45% / 0.3)",
    color: "hsl(142 71% 40%)",
  },

  ".cm-diff-action-accept:hover": {
    backgroundColor: "hsl(142 71% 45% / 0.2)",
    borderColor: "hsl(142 71% 45% / 0.5)",
  },

  // Updated content lines
  ".cm-diff-updated-content": {
    maxHeight: "300px",
    overflow: "auto",
  },

  ".cm-diff-updated-line": {
    display: "flex",
    alignItems: "flex-start",
    lineHeight: "1.5",
  },

  ".cm-diff-line-marker": {
    width: "20px",
    textAlign: "center",
    fontWeight: "bold",
    flexShrink: "0",
  },

  ".cm-diff-add-marker": {
    color: "hsl(142 71% 45%)",
    backgroundColor: "hsl(142 71% 45% / 0.1)",
  },

  ".cm-diff-line-content": {
    flex: "1",
    paddingLeft: "8px",
    paddingRight: "8px",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },

  ".cm-diff-add-content": {
    color: "hsl(142 71% 35%)",
  },
});

/**
 * Plugin to sync with edit store
 */
export const inlineDiffPlugin = ViewPlugin.fromClass(
  class {
    private unsubscribe: (() => void) | null = null;

    constructor(private view: EditorView) {
      // Subscribe to edit store changes
      this.unsubscribe = useEditStore.subscribe((state) => {
        this.view.dispatch({
          effects: setPendingEditsEffect.of(state.pendingEdits),
        });
      });

      // Initialize with current edits
      const initialEdits = useEditStore.getState().pendingEdits;
      if (initialEdits.length > 0) {
        this.view.dispatch({
          effects: setPendingEditsEffect.of(initialEdits),
        });
      }
    }

    destroy() {
      this.unsubscribe?.();
    }
  }
);

/**
 * Get all inline diff extensions
 */
export function getInlineDiffExtensions() {
  return [
    currentFileField,
    inlineDiffField,
    inlineDiffTheme,
    inlineDiffPlugin,
  ];
}

/**
 * Helper function to set current file in the editor
 */
export function setCurrentFile(view: EditorView, filePath: string) {
  view.dispatch({
    effects: setCurrentFileEffect.of(filePath),
  });
}

/**
 * Helper function to set Yjs refs in the editor for local line number calculation
 */
export function setYjsRefs(view: EditorView, ydoc: Y.Doc | null, ytext: Y.Text | null) {
  view.dispatch({
    effects: setYjsRefsEffect.of({ ydoc, ytext }),
  });
}
