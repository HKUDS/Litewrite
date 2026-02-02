/**
 * TAP completion - CodeMirror extension
 *
 * Implements a Cursor-like ghost text effect:
 * - Show completion hint in gray italic text
 * - Accept with Tab
 * - Dismiss with Escape
 * - Shrink progressively when user input matches
 * - Auto-dismiss when user input diverges
 */
import {
  EditorView,
  Decoration,
  DecorationSet,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  keymap,
} from "@codemirror/view";
import {
  StateField,
  StateEffect,
  Transaction,
  Annotation,
  Prec,
} from "@codemirror/state";

// ==================== Types ====================

export interface DiffSegment {
  op: "equal" | "replace" | "insert" | "delete";
  text?: string;
  original?: string;
  revised?: string;
}

export interface TapCompletion {
  /** Cursor position */
  cursorPos: number;
  /** Inserted text (Cursor-style gray ghost text) */
  insertedText: string;
  /** Prefix diff */
  prefixDiff?: DiffSegment[];
  /** Suffix diff */
  suffixDiff?: DiffSegment[];
  /** Document length at request time (for validation) */
  originalDocLength: number;
  /** Original prefix start (used to compute diff positions) */
  prefixStart?: number;
  /** Hidden flag (hide when cursor moves forward, but keep cached) */
  hidden?: boolean;
  /** Show timestamp (used to compute displayDuration) */
  showTimestamp?: number;
  /** Project ID (analytics; removed in OSS build) */
  projectId?: string;
  /** File ID (analytics; removed in OSS build) */
  fileId?: string;
}

// ==================== Annotations ====================

/** Marks a remote update (from Yjs collaboration). */
export const remoteUpdateAnnotation = Annotation.define<boolean>();

// ==================== State Effects ====================

/** Set completion content. */
export const setTapCompletion = StateEffect.define<TapCompletion | null>();

/** Accept completion. */
export const acceptTapCompletion = StateEffect.define<void>();

/** Dismiss completion. */
export const dismissTapCompletion = StateEffect.define<void>();

// ==================== Ghost Text Widget ====================

class GhostTextWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-ghost-text";
    span.textContent = this.text;
    return span;
  }

  eq(other: GhostTextWidget) {
    return this.text === other.text;
  }

  ignoreEvent() {
    return true;
  }
}

// ==================== Diff Widget (show replacement text) ====================

class DiffReplacementWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-tap-replacement";
    span.textContent = this.text;
    return span;
  }

  eq(other: DiffReplacementWidget) {
    return this.text === other.text;
  }

  ignoreEvent() {
    return true;
  }
}

// ==================== Remote update handling ====================

/**
 * Check whether remote changes affect the active completion region.
 */
function shouldDismissOnRemoteChange(
  completion: TapCompletion,
  changes: { from: number; to: number; insertedLength: number }[]
): boolean {
  const { cursorPos } = completion;

  for (const change of changes) {
    // Case 1: change is within the effective prefix range (last 500 chars)
    const prefixStart = Math.max(0, cursorPos - 500);
    if (change.to <= cursorPos && change.from >= prefixStart) {
      // Context changed; dismiss completion
      return true;
    }

    // Case 2: change overlaps cursor position (someone edited the same position)
    if (change.from <= cursorPos && change.to >= cursorPos) {
      return true;
    }

    // Case 3: change happens after the cursor (suffix area) — usually safe to keep
  }

  return false;
}

/**
 * Adjust completion cursor position based on remote changes.
 */
function adjustCompletionPosition(
  completion: TapCompletion,
  changes: { from: number; to: number; insertedLength: number }[]
): TapCompletion {
  let newCursorPos = completion.cursorPos;

  for (const change of changes) {
    // Only changes before the cursor affect cursor position
    if (change.to <= completion.cursorPos) {
      const delta = change.insertedLength - (change.to - change.from);
      newCursorPos += delta;
    }
  }

  return {
    ...completion,
    cursorPos: newCursorPos,
  };
}

/**
 * Handle local document changes (user input).
 */
function handleLocalDocChange(
  tr: Transaction,
  completion: TapCompletion
): TapCompletion | null {
  const { cursorPos, insertedText } = completion;

  // Current cursor position
  const newCursorPos = tr.state.selection.main.head;

  // If user moved cursor left (before completion cursor), dismiss
  if (newCursorPos < cursorPos) {
    return null;
  }

  // If cursor stayed or moved right, check user input
  if (newCursorPos > cursorPos) {
    // Get newly typed content
    const docText = tr.state.doc.toString();
    const userInput = docText.slice(cursorPos, newCursorPos);

    // Check whether user input matches the completion prefix
    if (insertedText.startsWith(userInput)) {
      // Matches: shrink completion
      const remainingText = insertedText.slice(userInput.length);

      if (remainingText.length === 0) {
        // User typed the entire completion; dismiss
        return null;
      }

      return {
        ...completion,
        cursorPos: newCursorPos,
        insertedText: remainingText,
      };
    }

    // Diverged: dismiss
    return null;
  }

  return completion;
}

// ==================== State Field ====================

export const tapCompletionState = StateField.define<TapCompletion | null>({
  create: () => null,

  update(value, tr) {
    // Handle explicit effects
    for (const effect of tr.effects) {
      if (effect.is(setTapCompletion)) {
        return effect.value;
      }
      if (effect.is(acceptTapCompletion) || effect.is(dismissTapCompletion)) {
        return null;
      }
    }

    if (!value) return null;

    // Document changed
    if (tr.docChanged) {
      // Check if this is a remote update (Yjs collaboration)
      const isRemoteUpdate = tr.annotation(remoteUpdateAnnotation);

      // Collect all changes
      const changes: { from: number; to: number; insertedLength: number }[] = [];
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        changes.push({
          from: fromA,
          to: toA,
          insertedLength: inserted.length,
        });
      });

      if (isRemoteUpdate) {
        // Remote update: check whether it affects completion region
        if (shouldDismissOnRemoteChange(value, changes)) {
          return null;
        }
        // Otherwise, only adjust position
        return adjustCompletionPosition(value, changes);
      } else {
        // Local update: use incremental matching logic
        return handleLocalDocChange(tr, value);
      }
    }

    // Cursor moved (without doc changes)
    if (tr.selection) {
      const newCursorPos = tr.state.selection.main.head;

      // Cursor moved backward (left) → clear completion
      if (newCursorPos < value.cursorPos) {
        return null;
      }

      // Cursor moved forward (right) → hide but keep cached
      if (newCursorPos > value.cursorPos) {
        // If moved too far, clear completion
        if (newCursorPos - value.cursorPos > 50) {
          return null;
        }
        // Otherwise, hide
        if (!value.hidden) {
          return { ...value, hidden: true };
        }
      }

      // Cursor back to original position → show completion
      if (newCursorPos === value.cursorPos && value.hidden) {
        return { ...value, hidden: false };
      }
    }

    return value;
  },
});

// NOTE: Analytics tracking for TAP completion was removed in the OSS version.

// ==================== Decoration Plugin ====================

const tapDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.transactions.some((tr) =>
          tr.effects.some(
            (e) =>
              e.is(setTapCompletion) ||
              e.is(acceptTapCompletion) ||
              e.is(dismissTapCompletion)
          )
        )
      ) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    buildDecorations(view: EditorView): DecorationSet {
      const completion = view.state.field(tapCompletionState);
      if (!completion) {
        return Decoration.none;
      }

      // If completion is hidden, show no decorations
      if (completion.hidden) {
        return Decoration.none;
      }

      // Ensure cursor position is within document bounds
      if (completion.cursorPos > view.state.doc.length) {
        return Decoration.none;
      }

      const decorations: { from: number; to: number; value: Decoration }[] = [];

      // 1) prefixDiff (changes before cursor)
      if (completion.prefixDiff && completion.prefixStart !== undefined) {
        let pos = completion.prefixStart;

        for (const segment of completion.prefixDiff) {
          if (segment.op === "equal" && segment.text) {
            pos += segment.text.length;
          } else if (segment.op === "replace" && segment.original && segment.revised) {
            // Highlight original text to be deleted
            const from = pos;
            const to = pos + segment.original.length;
            if (from < view.state.doc.length && to <= view.state.doc.length) {
              decorations.push({
                from,
                to,
                value: Decoration.mark({ class: "cm-tap-delete" }),
              });
              // Show replacement text after deleted range
              decorations.push({
                from: to,
                to: to,
                value: Decoration.widget({
                  widget: new DiffReplacementWidget(segment.revised),
                  side: 1,
                }),
              });
            }
            pos += segment.original.length;
          } else if (segment.op === "delete" && segment.original) {
            // Highlight original text to be deleted
            const from = pos;
            const to = pos + segment.original.length;
            if (from < view.state.doc.length && to <= view.state.doc.length) {
              decorations.push({
                from,
                to,
                value: Decoration.mark({ class: "cm-tap-delete" }),
              });
            }
            pos += segment.original.length;
          } else if (segment.op === "insert" && segment.revised) {
            // Show inserted text
            decorations.push({
              from: pos,
              to: pos,
              value: Decoration.widget({
                widget: new DiffReplacementWidget(segment.revised),
                side: 1,
              }),
            });
          }
        }
      }

      // 2) insertedText (insertion at cursor)
      if (completion.insertedText) {
        decorations.push({
          from: completion.cursorPos,
          to: completion.cursorPos,
          value: Decoration.widget({
            widget: new GhostTextWidget(completion.insertedText),
            side: 1,
          }),
        });
      }

      // 3) suffixDiff (changes after cursor)
      if (completion.suffixDiff) {
        let pos = completion.cursorPos; // Suffix starts at cursor position

        for (const segment of completion.suffixDiff) {
          if (segment.op === "equal" && segment.text) {
            pos += segment.text.length;
          } else if (segment.op === "replace" && segment.original && segment.revised) {
            // Highlight original text to be deleted
            const from = pos;
            const to = pos + segment.original.length;
            if (from < view.state.doc.length && to <= view.state.doc.length) {
              decorations.push({
                from,
                to,
                value: Decoration.mark({ class: "cm-tap-delete" }),
              });
              // Show replacement text after deleted range
              decorations.push({
                from: to,
                to: to,
                value: Decoration.widget({
                  widget: new DiffReplacementWidget(segment.revised),
                  side: 1,
                }),
              });
            }
            pos += segment.original.length;
          } else if (segment.op === "delete" && segment.original) {
            // Highlight original text to be deleted
            const from = pos;
            const to = pos + segment.original.length;
            if (from < view.state.doc.length && to <= view.state.doc.length) {
              decorations.push({
                from,
                to,
                value: Decoration.mark({ class: "cm-tap-delete" }),
              });
            }
            pos += segment.original.length;
          } else if (segment.op === "insert" && segment.revised) {
            // Show inserted text
            decorations.push({
              from: pos,
              to: pos,
              value: Decoration.widget({
                widget: new DiffReplacementWidget(segment.revised),
                side: 1,
              }),
            });
          }
        }
      }

      // Sort by position
      decorations.sort((a, b) => a.from - b.from || a.to - b.to);

      return Decoration.set(decorations.map(d => d.value.range(d.from, d.to)));
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

// ==================== TAP Keymap ====================

/**
 * Build a list of changes from diff segments.
 */
function buildChangesFromDiff(
  prefixStart: number,
  prefixDiff: DiffSegment[] | undefined,
  cursorPos: number,
  insertedText: string,
  suffixDiff?: DiffSegment[]
): { from: number; to: number; insert: string }[] {
  const changes: { from: number; to: number; insert: string }[] = [];

  // 1) prefixDiff
  if (prefixDiff && prefixStart !== undefined) {
    let pos = prefixStart;

    for (const segment of prefixDiff) {
      if (segment.op === "equal" && segment.text) {
        pos += segment.text.length;
      } else if (segment.op === "replace" && segment.original && segment.revised) {
        changes.push({
          from: pos,
          to: pos + segment.original.length,
          insert: segment.revised,
        });
        pos += segment.original.length;
      } else if (segment.op === "delete" && segment.original) {
        changes.push({
          from: pos,
          to: pos + segment.original.length,
          insert: "",
        });
        pos += segment.original.length;
      } else if (segment.op === "insert" && segment.revised) {
        changes.push({
          from: pos,
          to: pos,
          insert: segment.revised,
        });
      }
    }
  }

  // 2) insertedText
  if (insertedText) {
    changes.push({
      from: cursorPos,
      to: cursorPos,
      insert: insertedText,
    });
  }

  // 3) suffixDiff
  if (suffixDiff) {
    let pos = cursorPos; // Suffix starts at cursor position

    for (const segment of suffixDiff) {
      if (segment.op === "equal" && segment.text) {
        pos += segment.text.length;
      } else if (segment.op === "replace" && segment.original && segment.revised) {
        changes.push({
          from: pos,
          to: pos + segment.original.length,
          insert: segment.revised,
        });
        pos += segment.original.length;
      } else if (segment.op === "delete" && segment.original) {
        changes.push({
          from: pos,
          to: pos + segment.original.length,
          insert: "",
        });
        pos += segment.original.length;
      } else if (segment.op === "insert" && segment.revised) {
        changes.push({
          from: pos,
          to: pos,
          insert: segment.revised,
        });
      }
    }
  }

  return changes;
}

// Use Prec.highest so TAP's Tab key wins over default indentation.
export const tapKeymap = Prec.highest(
  keymap.of([
    {
      key: "Tab",
      run: (view: EditorView): boolean => {
        const completion = view.state.field(tapCompletionState);
        if (!completion || completion.hidden) {
          return false; // No completion (or hidden): let default Tab handler run
        }

        // Check whether there are any edits to apply (insertedText or diff)
        const hasPrefixDiff = completion.prefixDiff?.some(s => s.op !== "equal");
        const hasSuffixDiff = completion.suffixDiff?.some(s => s.op !== "equal");
        if (!completion.insertedText && !hasPrefixDiff && !hasSuffixDiff) {
          return false; // Nothing to apply: let default Tab handler run
        }

        // Build all changes
        const changes = buildChangesFromDiff(
          completion.prefixStart ?? completion.cursorPos,
          completion.prefixDiff,
          completion.cursorPos,
          completion.insertedText,
          completion.suffixDiff
        );

        if (changes.length === 0) {
          return false;
        }

        // Compute final cursor position
        let finalPos = completion.cursorPos + completion.insertedText.length;

        // Account for prefixDiff deltas (changes before cursor affect final position)
        for (const change of changes) {
          if (change.from < completion.cursorPos) {
            const delta = change.insert.length - (change.to - change.from);
            finalPos += delta;
          }
        }

        // Apply changes
        view.dispatch({
          changes,
          selection: { anchor: finalPos },
          effects: acceptTapCompletion.of(),
        });

        return true;
      },
    },
    {
      key: "Escape",
      run: (view: EditorView): boolean => {
        const completion = view.state.field(tapCompletionState);
        if (!completion) {
          return false;
        }

        view.dispatch({
          effects: dismissTapCompletion.of(),
        });

        return true;
      },
    },
  ])
);

// ==================== Theme styles ====================

export const tapCompletionTheme = EditorView.theme({
  // Ghost text (inserted new text) - gray italic
  ".cm-ghost-text": {
    color: "#9ca3af",
    opacity: "0.6",
    fontStyle: "italic",
    pointerEvents: "none",
    userSelect: "none",
  },
  ".dark .cm-ghost-text": {
    color: "#6b7280",
  },
  // Text to delete - strikethrough
  ".cm-tap-delete": {
    textDecoration: "line-through",
    opacity: "0.5",
  },
  // Replacement text - also gray italic
  ".cm-tap-replacement": {
    color: "#9ca3af",
    opacity: "0.6",
    fontStyle: "italic",
    pointerEvents: "none",
    userSelect: "none",
  },
  ".dark .cm-tap-replacement": {
    color: "#6b7280",
  },
});

// ==================== Export extension ====================

/**
 * Create the TAP completion extension.
 *
 * Usage:
 * ```typescript
 * const extensions = [
 *   // ... other extensions
 *   ...createTapCompletionExtensions(),
 * ];
 * ```
 */
export function createTapCompletionExtensions() {
  return [
    tapCompletionState,
    tapDecorationPlugin,
    tapKeymap,
    tapCompletionTheme,
  ];
}

// ==================== Helpers ====================

/**
 * Check whether there is an active completion.
 */
export function hasActiveCompletion(view: EditorView): boolean {
  const completion = view.state.field(tapCompletionState);
  return completion !== null && completion.insertedText.length > 0;
}

/**
 * Get current completion content.
 */
export function getActiveCompletion(view: EditorView): TapCompletion | null {
  return view.state.field(tapCompletionState);
}
