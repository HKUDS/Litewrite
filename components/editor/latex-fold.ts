/**
 * LaTeX smart code folding.
 *
 * Supports folding:
 * - Any LaTeX environment: \begin{env}...\end{env}
 * - Preamble region: \documentclass to \begin{document}
 * - Multi-line comment blocks
 *
 * Fold range: from end of the \begin{env} line to start of the matching \end{env} line.
 */

import { foldService, foldGutter as cmFoldGutter } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

// ============== Constants ==============

// List of foldable LaTeX environments (in practice, any \begin{...} can be folded)
const FOLDABLE_ENVS = [
  // Document structure
  "document",
  "abstract",
  "titlepage",
  // Math environments
  "equation", "equation*",
  "align", "align*",
  "gather", "gather*",
  "multline", "multline*",
  "eqnarray", "eqnarray*",
  "displaymath",
  "math",
  // List environments
  "itemize",
  "enumerate",
  "description",
  // Floats
  "figure", "figure*",
  "table", "table*",
  "tabular", "tabular*",
  // Code and quotes
  "verbatim",
  "lstlisting",
  "quote",
  "quotation",
  "verse",
  // Layout
  "center",
  "flushleft",
  "flushright",
  "minipage",
  "frame",
  // Theorem-like environments
  "theorem",
  "lemma",
  "corollary",
  "proposition",
  "definition",
  "proof",
  "example",
  "remark",
];

// ============== Helpers ==============

/**
 * Escape special characters for RegExp.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find the matching \end{env} in the document.
 * Handles nested environments.
 */
function findMatchingEnd(
  state: EditorState,
  envName: string,
  startLine: number
): { line: number; pos: number } | null {
  const doc = state.doc;
  const escapedEnv = escapeRegex(envName);
  const beginPattern = new RegExp(`\\\\begin\\{${escapedEnv}\\}`);
  const endPattern = new RegExp(`\\\\end\\{${escapedEnv}\\}`);

  let depth = 1;

  for (let lineNum = startLine + 1; lineNum <= doc.lines; lineNum++) {
    const line = doc.line(lineNum);
    const text = line.text;

    // Check whether this line contains \begin{env} or \end{env}
    // (there may be multiple matches on the same line).
    let pos = 0;
    while (pos < text.length) {
      const remaining = text.slice(pos);

      const beginMatch = remaining.match(beginPattern);
      const endMatch = remaining.match(endPattern);

      // Pick the earliest match
      let beginIndex = beginMatch ? beginMatch.index! + pos : Infinity;
      let endIndex = endMatch ? endMatch.index! + pos : Infinity;

      if (beginIndex === Infinity && endIndex === Infinity) {
        break;
      }

      if (beginIndex < endIndex) {
        depth++;
        pos = beginIndex + 1;
      } else {
        depth--;
        if (depth === 0) {
          // Found the matching \end
          return {
            line: lineNum,
            pos: line.from + endIndex,
          };
        }
        pos = endIndex + 1;
      }
    }
  }

  return null;
}

/**
 * Find the end of the preamble (\begin{document}).
 */
function findDocumentBegin(state: EditorState): number | null {
  const doc = state.doc;
  const pattern = /\\begin\{document\}/;

  for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
    const line = doc.line(lineNum);
    if (pattern.test(line.text)) {
      return line.from;
    }
  }

  return null;
}

// ============== Fold Service ==============

/**
 * LaTeX fold service.
 * Detects \begin{env}...\end{env} blocks and provides fold ranges.
 */
export const latexFoldService = foldService.of((state, lineStart, lineEnd) => {
  const line = state.doc.lineAt(lineStart);
  const text = line.text;

  // 1) Check whether this is a \begin{...} line
  const beginMatch = text.match(/\\begin\{([a-zA-Z*]+)\}/);
  if (beginMatch) {
    const envName = beginMatch[1];
    const match = findMatchingEnd(state, envName, line.number);

    if (match) {
      // Fold range: from end of \begin{env} line to start of \end{env} line
      const endLine = state.doc.line(match.line);
      return {
        from: line.to,
        to: endLine.from - 1, // Exclude the \end line
      };
    }
  }

  // 2) Check whether this is a \documentclass line (start of preamble)
  if (text.match(/\\documentclass(\[[^\]]*\])?\{/)) {
    const docBegin = findDocumentBegin(state);
    if (docBegin !== null) {
      const docBeginLine = state.doc.lineAt(docBegin);
      // Only fold when the preamble spans more than 3 lines
      if (docBeginLine.number - line.number > 3) {
        return {
          from: line.to,
          to: docBeginLine.from - 1,
        };
      }
    }
  }

  // 3) Check whether this is the start of a consecutive comment block
  if (text.trimStart().startsWith('%')) {
    // Find the end of the consecutive comment block
    let endLineNum = line.number;
    for (let i = line.number + 1; i <= state.doc.lines; i++) {
      const nextLine = state.doc.line(i);
      if (!nextLine.text.trimStart().startsWith('%')) {
        break;
      }
      endLineNum = i;
    }

    // Only fold comment blocks longer than 3 lines
    if (endLineNum - line.number >= 3) {
      const endLine = state.doc.line(endLineNum);
      return {
        from: line.to,
        to: endLine.to,
      };
    }
  }

  return null;
});

// ============== Custom fold icons ==============

/**
 * Create a LaTeX fold gutter with custom icons.
 */
export function createLatexFoldGutter() {
  return cmFoldGutter({
    openText: "▼",
    closedText: "▶",
    markerDOM: (open: boolean) => {
      const marker = document.createElement("span");
      marker.className = open ? "cm-fold-marker-open" : "cm-fold-marker-closed";
      marker.textContent = open ? "▼" : "▶";
      marker.style.cursor = "pointer";
      marker.style.fontSize = "10px";
      marker.style.lineHeight = "1.5";
      marker.style.userSelect = "none";
      marker.style.transition = "color 0.15s ease";
      return marker;
    },
  });
}

// ============== Exports ==============

/**
 * Get LaTeX folding extensions (includes foldService and foldGutter).
 */
export function getLatexFoldExtensions() {
  return [
    latexFoldService,
    createLatexFoldGutter(),
  ];
}
