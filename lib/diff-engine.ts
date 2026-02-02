/**
 * Diff Engine using Google's diff-match-patch
 * ============================================
 *
 * Implements line-level diffs using Google's diff-match-patch.
 * It's smarter than many npm diff packages, producing more reasonable boundaries.
 *
 * Benefits:
 * - Uses diff_linesToChars_ for true line-level comparison
 * - diff_cleanupSemantic can make boundaries more reasonable and avoid the "blank line swaps text" issue
 */

import DiffMatchPatch from "diff-match-patch";

// ============================================================================
// Types
// ============================================================================

export type RelativePositionJSON = object;

/**
 * A diff block computed from the comparison.
 */
export interface DiffBlock {
  /** Start line in the original document (1-based) */
  startLine: number;
  /** End line in the original document (1-based, inclusive) */
  endLine: number;
  /** Original content (the content being replaced) */
  original: string;
  /** New content (replacement content) */
  updated: string;
  /** RelativePosition at the start */
  startRelPos?: RelativePositionJSON;
  /** RelativePosition at the end */
  endRelPos?: RelativePositionJSON;
}

/**
 * Diff result.
 */
export interface DiffResult {
  /** Whether any differences exist */
  hasDiff: boolean;
  /** All diff blocks */
  blocks: DiffBlock[];
}

// ============================================================================
// Core Diff Functions (using Google's diff-match-patch)
// ============================================================================

const dmp = new DiffMatchPatch();

/**
 * Compare the original document and the Shadow Doc, returning line-level diff blocks.
 * Uses diff-match-patch's diff_linesToChars for a smarter line-level diff.
 *
 * @param originalContent - Original document content (Yjs-synced content)
 * @param shadowContent - Shadow Doc content (after applying edits)
 * @returns DiffResult containing all diff blocks
 */
export function computeDiff(
  originalContent: string,
  shadowContent: string
): DiffResult {
  // Ensure a trailing newline so line-level diffs are more accurate
  const normalizedOriginal = originalContent.endsWith('\n')
    ? originalContent
    : originalContent + '\n';
  const normalizedShadow = shadowContent.endsWith('\n')
    ? shadowContent
    : shadowContent + '\n';

  // Line-level comparison via diff-match-patch:
  // diff_linesToChars maps each line to a character so a char-level diff becomes a line-level diff.
  const lineInfo = dmp.diff_linesToChars_(normalizedOriginal, normalizedShadow);
  const chars1 = lineInfo.chars1;
  const chars2 = lineInfo.chars2;
  const lineArray = lineInfo.lineArray;

  // Run diff
  const diffs = dmp.diff_main(chars1, chars2, false);

  // Map characters back to lines
  dmp.diff_charsToLines_(diffs, lineArray);

  // NOTE: We intentionally do not call diff_cleanupSemantic because it can over-merge diffs
  // and produce inaccurate boundaries.

  // Convert to DiffBlock format
  const blocks: DiffBlock[] = [];
  let originalLine = 1;  // Current line number in the original document

  let i = 0;
  while (i < diffs.length) {
    const [op, text] = diffs[i];

    // DIFF_EQUAL (0) - unchanged content
    if (op === DiffMatchPatch.DIFF_EQUAL) {
      // Count how many lines are in this unchanged segment
      const lines = text.split('\n');
      // If the text ends with a newline, the last item is an empty string, so count is length - 1.
      // Otherwise, the line count is length.
      const lineCount = text.endsWith('\n') ? lines.length - 1 : lines.length;
      originalLine += lineCount;
      i++;
      continue;
    }

    // Find a change region (delete + insert = replace)
    let removedText = "";
    let addedText = "";
    let removedLineCount = 0;

    // DIFF_DELETE (-1) - removed content
    if (op === DiffMatchPatch.DIFF_DELETE) {
      removedText = text;
      const lines = text.split('\n');
      removedLineCount = text.endsWith('\n') ? lines.length - 1 : lines.length;
      i++;

      // Check a following insert (together forming a replacement)
      if (i < diffs.length && diffs[i][0] === DiffMatchPatch.DIFF_INSERT) {
        addedText = diffs[i][1];
        i++;
      }
    } else if (op === DiffMatchPatch.DIFF_INSERT) {
      // DIFF_INSERT (1) - pure insertion
      addedText = text;
      i++;
    }

    // Remove trailing newline for consistency
    const original = removedText.replace(/\n$/, "");
    const updated = addedText.replace(/\n$/, "");

    // Compute line range
    const startLine = originalLine;
    // If it's a deletion, endLine = startLine + removedLineCount - 1
    // If it's a pure insertion, endLine = startLine (insertion point)
    const endLine = removedLineCount > 0
      ? originalLine + removedLineCount - 1
      : startLine;

    // Only add a block when there is an actual change
    if (original !== updated) {
      blocks.push({
        startLine,
        endLine: Math.max(startLine, endLine),
        original,
        updated,
      });
    }

    // Advance original document line number
    originalLine += removedLineCount;
  }

  return {
    hasDiff: blocks.length > 0,
    blocks,
  };
}

// ============================================================================
// Apply Edits to Generate Shadow Doc
// ============================================================================

/**
 * Apply edit blocks to the original content to generate the Shadow Doc.
 *
 * @param originalContent - Original document content
 * @param blocks - Edit blocks to apply (must be sorted by startLine desc, or this function will sort them)
 * @returns Shadow Doc content after applying edits
 */
export function applyShadowEdits(
  originalContent: string,
  blocks: DiffBlock[]
): string {
  if (!blocks || blocks.length === 0) {
    return originalContent;
  }

  // Sort by startLine desc and apply from back to front to avoid line-number shifting
  const sortedBlocks = [...blocks].sort((a, b) => b.startLine - a.startLine);

  let result = originalContent;

  for (const block of sortedBlocks) {
    const lines = result.split('\n');
    const startIdx = Math.max(0, block.startLine - 1);  // 0-based index
    const endIdx = Math.min(lines.length, block.endLine);  // 1-based inclusive -> exclusive

    // Replace lines from startLine to endLine with updated content
    const updatedLines = block.updated.split('\n');
    lines.splice(startIdx, endIdx - startIdx, ...updatedLines);

    result = lines.join('\n');
  }

  return result;
}

// ============================================================================
// RelativePosition Helpers (requires Yjs)
// ============================================================================

/**
 * Add RelativePosition info to blocks.
 * Note: this function requires Yjs context; if missing, it returns the original blocks.
 *
 * @param blocks - Diff blocks
 * @param ydoc - Y.Doc instance
 * @param ytext - Y.Text instance
 * @returns Blocks with RelativePosition info
 */
export function addRelativePositions(
  blocks: DiffBlock[],
  ydoc: unknown | null,
  ytext: unknown | null
): DiffBlock[] {
  // If Yjs context is missing, return the original blocks
  if (!ydoc || !ytext) {
    return blocks;
  }

  // Yjs-related operations should be done server-side via the /relpos API.
  // This is only a placeholder implementation.
  console.warn("[DiffEngine] addRelativePositions should be done server-side via /relpos API");
  return blocks;
}

/**
 * Update block line numbers using RelativePosition.
 * Note: this function requires Yjs context; if missing, it returns the original blocks.
 *
 * @param blocks - Blocks with RelativePosition info
 * @param ydoc - Y.Doc instance
 * @param ytext - Y.Text instance
 * @returns Blocks with updated line numbers
 */
export function updateBlockLineNumbers(
  blocks: DiffBlock[],
  ydoc: unknown | null,
  ytext: unknown | null
): DiffBlock[] {
  // If Yjs context is missing, return the original blocks
  if (!ydoc || !ytext) {
    return blocks;
  }

  // Yjs-related operations should be done server-side via the /update-line-numbers API.
  // This is only a placeholder implementation.
  console.warn("[DiffEngine] updateBlockLineNumbers should be done server-side via /update-line-numbers API");
  return blocks;
}

// ============================================================================
// Exports
// ============================================================================

const diffEngine = {
  computeDiff,
  applyShadowEdits,
  addRelativePositions,
  updateBlockLineNumbers,
};

export default diffEngine;
