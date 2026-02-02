/**
 * Citation autocomplete.
 * Provides citation-key autocomplete inside commands like \cite{}, \citep{}, \citet{}, \ref{}, \label{}, etc.
 *
 * Features:
 * - Automatically shows a default citation list inside empty \cite{} braces
 * - Supports multiple citations (\cite{key1, key2}) and triggers a new completion after commas
 * - Intelligently filters already-used citations
 */

import type { CompletionContext, Completion, CompletionResult } from "@codemirror/autocomplete";
import type { BibEntry } from "@/lib/bibtex-parser";
import { formatAuthors } from "@/lib/bibtex-parser";

/**
 * Check whether the cursor is inside \cite{} braces.
 */
function isInsideCiteBraces(textBefore: string): {
  isInside: boolean;
  citedKeys: string;
  citeCommand: string;
} {
  // Match citation commands such as \cite{, \citep{, \citet{, \citeauthor{ ...
  const citePattern = /\\(cite[a-z]*|citep|citet)\{([^}]*)$/;
  const match = textBefore.match(citePattern);

  if (match) {
    return {
      isInside: true,
      citedKeys: match[2],
      citeCommand: match[1]
    };
  }

  return { isInside: false, citedKeys: "", citeCommand: "" };
}

/**
 * Create a citation autocomplete function.
 * @param getEntries Function that returns citation entries
 * @param onOpenAdvancedSearch Callback to open advanced search
 */
export function createCitationAutocomplete(
  getEntries: () => BibEntry[],
  onOpenAdvancedSearch?: () => void
) {
  return function citationAutocomplete(context: CompletionContext): CompletionResult | null {
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);

    const { isInside, citedKeys } = isInsideCiteBraces(textBefore);
    if (!isInside) return null;

    // Parse the already-typed segment (may contain multiple citation keys separated by commas)
    const parts = citedKeys.split(",");
    const rawCurrentPart = parts[parts.length - 1];
    const currentPart = rawCurrentPart.trim();

    // Detect whether the user just typed comma + space (entering a new-citation mode)
    const justEnteredNewRef = rawCurrentPart === "" || rawCurrentPart === " ";

    // Compute completion start position.
    // If just after comma-space, `from` should be the position after the space.
    const from = context.pos - rawCurrentPart.length;

    const entries = getEntries();

    // Filter citation keys that are already used
    const usedKeys = new Set(
      parts.slice(0, -1).map(p => p.trim()).filter(Boolean)
    );

    // If current part has content, also consider filtering (to avoid duplicates)
    if (currentPart) {
      // Do not filter the key currently being typed
    }

    // Filter matching entries
    const query = currentPart.toLowerCase();
    const matchingEntries = entries
      .filter(entry => !usedKeys.has(entry.key))
      .filter(entry => {
        // For empty queries, show all (with a limit)
        if (!query) return true;
        // Match by key, title, author, or year
        return (
          entry.key.toLowerCase().includes(query) ||
          entry.title.toLowerCase().includes(query) ||
          entry.author.toLowerCase().includes(query) ||
          entry.year.includes(query)
        );
      })
      .slice(0, 50); // Limit to 50 items

    // Convert to completion options
    const options: Completion[] = matchingEntries.map(entry => {
      const authors = formatAuthors(entry.authors, 2);
      const year = entry.year || "";
      const venue = entry.journal || entry.booktitle || "";

      // Build detail
      let detail = "";
      if (authors) detail += authors;
      if (year) detail += detail ? ` (${year})` : year;

      // Build extended info
      let info = entry.title;
      if (venue) info += `\n${venue}`;

      // Boost sorting in certain cases
      let boost = 0;
      if (query && entry.key.toLowerCase().startsWith(query)) {
        boost = 10;
      } else if (justEnteredNewRef) {
        // After a comma, sort by year desc (newest first)
        boost = parseInt(entry.year) || 0;
      }

      return {
        label: entry.key,
        type: "reference",
        detail: detail,
        info: info,
        boost,
      };
    });

    // For empty \cite{} (or just after a comma), return results even if there are no matches,
    // so the list can still be shown. Only return null when there is input but no matches.
    if (options.length === 0 && query) return null;

    // If there are no entries at all (empty .bib), return null
    if (options.length === 0 && entries.length === 0) return null;

    return {
      from,
      options,
      // Allow triggering completion even with empty input
      validFor: /^[\s]*[a-zA-Z0-9_:-]*$/,
    };
  };
}

/**
 * Configure activation conditions for citation completion.
 * Used to override CodeMirror's default activateOnTyping behavior.
 */
export function shouldActivateCitationCompletion(context: CompletionContext): boolean {
  const line = context.state.doc.lineAt(context.pos);
  const textBefore = line.text.slice(0, context.pos - line.from);

  const { isInside, citedKeys } = isInsideCiteBraces(textBefore);

  if (!isInside) return false;

  // Completion should activate in these cases:
  // 1) Empty braces inside \cite{}
  // 2) Just after a comma: \cite{key1, }
  // 3) During normal typing
  const parts = citedKeys.split(",");
  const currentPart = parts[parts.length - 1];

  // Activate for empty input or whitespace-only input
  if (currentPart.trim() === "") return true;

  // Activate during normal typing
  return true;
}

/**
 * Create autocomplete for \ref{} and \label{}.
 * Extracts existing labels from the document.
 */
export function createLabelAutocomplete() {
  return function labelAutocomplete(context: CompletionContext): CompletionResult | null {
    // Match \ref{, \eqref{, \pageref{, \autoref{, etc.
    const refPattern = /\\(ref|eqref|pageref|autoref|cref|Cref)\{([^}]*)$/;

    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);

    const match = textBefore.match(refPattern);
    if (!match) return null;

    const currentInput = match[2];
    const from = context.pos - currentInput.length;

    // Extract all \label{...} from the entire document
    const doc = context.state.doc.toString();
    const labelPattern = /\\label\{([^}]+)\}/g;
    const labels = new Set<string>();

    let labelMatch;
    while ((labelMatch = labelPattern.exec(doc)) !== null) {
      labels.add(labelMatch[1]);
    }

    // Filter matching labels
    const query = currentInput.toLowerCase();
    const options: Completion[] = Array.from(labels)
      .filter(label => !query || label.toLowerCase().includes(query))
      .map(label => ({
        label,
        type: "reference",
        detail: "label",
      }));

    if (options.length === 0) return null;

    return {
      from,
      options,
      validFor: /^[a-zA-Z0-9_:-]*$/,
    };
  };
}
