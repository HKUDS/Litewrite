/**
 * Custom search extension configuration.
 * Disables CodeMirror's default search panel and uses a custom React search panel.
 */

import {
  searchKeymap,
  highlightSelectionMatches,
  SearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  getSearchQuery,
  search,
} from "@codemirror/search";
import { keymap, EditorView } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";

// ============ Search panel state management ============

// Search panel toggle effect
export const toggleSearchPanelEffect = StateEffect.define<{
  open: boolean;
  showReplace?: boolean;
}>();

// Search panel state field
export interface SearchPanelState {
  isOpen: boolean;
  showReplace: boolean;
}

export const searchPanelState = StateField.define<SearchPanelState>({
  create() {
    return { isOpen: false, showReplace: false };
  },
  update(state, tr) {
    for (const effect of tr.effects) {
      if (effect.is(toggleSearchPanelEffect)) {
        return {
          isOpen: effect.value.open,
          showReplace: effect.value.showReplace ?? state.showReplace,
        };
      }
    }
    return state;
  },
});

// ============ Custom commands ============

// Open search panel
export const openSearchPanel = (view: EditorView): boolean => {
  view.dispatch({
    effects: toggleSearchPanelEffect.of({ open: true, showReplace: false }),
  });
  return true;
};

// Open search+replace panel
export const openSearchReplacePanel = (view: EditorView): boolean => {
  view.dispatch({
    effects: toggleSearchPanelEffect.of({ open: true, showReplace: true }),
  });
  return true;
};

// Close search panel
export const closeSearchPanel = (view: EditorView): boolean => {
  const state = view.state.field(searchPanelState, false);
  if (state?.isOpen) {
    view.dispatch({
      effects: toggleSearchPanelEffect.of({ open: false }),
    });
    view.focus();
    return true;
  }
  return false;
};

// ============ Custom keybindings ============

// Filter out keybindings related to the default search panel
const filteredSearchKeymap = searchKeymap.filter((binding) => {
  // Keep findNext/findPrevious etc., but remove open-panel keybindings
  return (
    binding.key !== "Mod-f" &&
    binding.key !== "Mod-h" &&
    binding.key !== "F3" &&
    binding.key !== "Shift-F3" &&
    binding.key !== "Mod-g" &&
    binding.key !== "Shift-Mod-g" &&
    binding.key !== "Escape"
  );
});

// Custom search keybindings
export const customSearchKeymap = keymap.of([
  // Ctrl+F / Cmd+F: open find panel
  { key: "Mod-f", run: openSearchPanel, scope: "editor" },
  // Ctrl+H / Cmd+H: open find+replace panel
  { key: "Mod-h", run: openSearchReplacePanel, scope: "editor" },
  // F3: find next
  { key: "F3", run: findNext, scope: "editor" },
  // Shift+F3: find previous
  { key: "Shift-F3", run: findPrevious, scope: "editor" },
  // Escape: close search panel
  { key: "Escape", run: closeSearchPanel },
  // Keep other search keybindings
  ...filteredSearchKeymap,
]);

// ============ Search helpers ============

/**
 * Run search and return match info.
 */
export interface SearchMatch {
  from: number;
  to: number;
}

export interface SearchResult {
  matches: SearchMatch[];
  currentIndex: number;
  total: number;
}

/**
 * Get all matches.
 * @param selectionRange Optional; restrict search range (Find in Selection)
 */
export function getAllMatches(
  view: EditorView,
  query: SearchQuery,
  selectionRange?: { from: number; to: number }
): SearchMatch[] {
  if (!query.valid) return [];

  const matches: SearchMatch[] = [];
  const doc = view.state.doc;

  // If a selection range is specified, search only within that range
  const from = selectionRange?.from ?? 0;
  const to = selectionRange?.to ?? doc.length;

  const cursor = query.getCursor(doc, from, to);

  let result = cursor.next();
  while (!result.done) {
    matches.push({ from: result.value.from, to: result.value.to });
    result = cursor.next();
  }

  return matches;
}

/**
 * Get the current match index.
 */
export function getCurrentMatchIndex(
  matches: SearchMatch[],
  selection: { from: number; to: number }
): number {
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    if (match.from === selection.from && match.to === selection.to) {
      return i;
    }
  }
  // Find the nearest match
  for (let i = 0; i < matches.length; i++) {
    if (matches[i].from >= selection.from) {
      return i;
    }
  }
  return matches.length > 0 ? 0 : -1;
}

/**
 * Create a search query.
 */
export function createSearchQuery(options: {
  search: string;
  replace?: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regexp?: boolean;
}): SearchQuery {
  return new SearchQuery({
    search: options.search,
    replace: options.replace || "",
    caseSensitive: options.caseSensitive || false,
    wholeWord: options.wholeWord || false,
    regexp: options.regexp || false,
  });
}

/**
 * Set the search query and highlight.
 */
export function performSearch(view: EditorView, query: SearchQuery): void {
  view.dispatch({
    effects: setSearchQuery.of(query),
  });
}

/**
 * Jump to the next match.
 */
export function goToNextMatch(view: EditorView): boolean {
  return findNext(view);
}

/**
 * Jump to the previous match.
 */
export function goToPrevMatch(view: EditorView): boolean {
  return findPrevious(view);
}

/**
 * Replace the current match.
 */
export function replaceCurrentMatch(view: EditorView): boolean {
  return replaceNext(view);
}

/**
 * Replace all matches.
 */
export function replaceAllMatches(view: EditorView): boolean {
  return replaceAll(view);
}

/**
 * Preserve-case replacement.
 * Adjust the replacement text based on the original's casing pattern.
 */
export function preserveCaseReplace(original: string, replacement: string): string {
  if (!original || !replacement) return replacement;

  // ALL CAPS
  if (original === original.toUpperCase() && original !== original.toLowerCase()) {
    return replacement.toUpperCase();
  }

  // all lowercase
  if (original === original.toLowerCase()) {
    return replacement.toLowerCase();
  }

  // Title Case (first letter uppercase)
  if (
    original[0] === original[0].toUpperCase() &&
    original.slice(1) === original.slice(1).toLowerCase()
  ) {
    return replacement[0].toUpperCase() + replacement.slice(1).toLowerCase();
  }

  // Otherwise keep as-is
  return replacement;
}

/**
 * Get the current search query.
 */
export function getCurrentQuery(view: EditorView): SearchQuery {
  return getSearchQuery(view.state);
}

// ============ Create search extensions ============

/**
 * Create custom search extensions (without the default panel).
 */
export function createCustomSearchExtensions() {
  return [
    // Core search functionality
    search({
      // Disable default panel
      top: false,
    }),
    // Highlight all matches of the selected text
    highlightSelectionMatches(),
    // Search panel state
    searchPanelState,
    // Custom keybindings
    customSearchKeymap,
  ];
}

// Export core functions for external use
export { setSearchQuery, getSearchQuery };
