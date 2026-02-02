"use client";

/**
 * VSCode-style search panel component.
 * Provides find, replace, regex, and related functionality.
 */

import React, { useEffect, useState, useCallback, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { SearchQuery } from "@codemirror/search";
import {
  X,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CaseSensitive,
  WholeWord,
  Regex,
  Replace,
  ReplaceAll,
  TextSelect,
  ALargeSmall,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/lib/i18n";
import {
  createSearchQuery,
  performSearch,
  goToNextMatch,
  goToPrevMatch,
  replaceCurrentMatch,
  replaceAllMatches,
  getAllMatches,
  getCurrentMatchIndex,
  preserveCaseReplace,
  toggleSearchPanelEffect,
  type SearchMatch,
} from "./search-extensions";

interface SearchPanelProps {
  editorView: EditorView | null;
  isOpen: boolean;
  showReplace: boolean;
  onClose: () => void;
  onToggleReplace: () => void;
}

export function SearchPanel({
  editorView,
  isOpen,
  showReplace,
  onClose,
  onToggleReplace,
}: SearchPanelProps) {
  const { t } = useTranslations("search");
  // Search state
  const [searchText, setSearchText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [findInSelection, setFindInSelection] = useState(false);
  const [preserveCase, setPreserveCase] = useState(false);

  // Selection range (for "Find in Selection")
  const [selectionRange, setSelectionRange] = useState<{ from: number; to: number } | null>(null);

  // Match results
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);

  // Regex error
  const [regexError, setRegexError] = useState<string | null>(null);

  // Input refs
  const searchInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  // On open, focus the search box and prefill with selected text
  useEffect(() => {
    if (isOpen && editorView && searchInputRef.current) {
      // Delay focus to ensure the panel has rendered
      setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 50);

      // Populate search box with selected text
      const selection = editorView.state.selection.main;
      if (!selection.empty) {
        const selectedText = editorView.state.sliceDoc(selection.from, selection.to);
        // Only prefill single-line text
        if (!selectedText.includes("\n") && selectedText.length < 200) {
          setSearchText(selectedText);
        }
        // Save selection range (for "Find in Selection")
        setSelectionRange({ from: selection.from, to: selection.to });
      } else {
        setSelectionRange(null);
      }
    }
  }, [isOpen, editorView]);

  // When toggling "Find in Selection", capture the current selection
  useEffect(() => {
    if (findInSelection && editorView) {
      const selection = editorView.state.selection.main;
      if (!selection.empty) {
        setSelectionRange({ from: selection.from, to: selection.to });
      }
    } else if (!findInSelection) {
      setSelectionRange(null);
    }
  }, [findInSelection, editorView]);

  // Perform search
  const doSearch = useCallback(() => {
    if (!editorView || !searchText) {
      setMatches([]);
      setCurrentIndex(-1);
      setRegexError(null);
      return;
    }

    try {
      const query = createSearchQuery({
        search: searchText,
        replace: replaceText,
        caseSensitive,
        wholeWord,
        regexp: useRegex,
      });

      // Validate regex
      if (!query.valid) {
        setRegexError(t("invalidRegex"));
        setMatches([]);
        setCurrentIndex(-1);
        return;
      }

      setRegexError(null);

      // Run search
      performSearch(editorView, query);

      // Get all matches (if "Find in Selection" is enabled, restrict the range)
      const searchRange = findInSelection && selectionRange ? selectionRange : undefined;
      const allMatches = getAllMatches(editorView, query, searchRange);
      setMatches(allMatches);

      // Compute current index
      const selection = editorView.state.selection.main;
      const index = getCurrentMatchIndex(allMatches, {
        from: selection.from,
        to: selection.to,
      });
      setCurrentIndex(index);
    } catch (error) {
      setRegexError(t("regexError"));
      setMatches([]);
      setCurrentIndex(-1);
    }
  }, [editorView, searchText, replaceText, caseSensitive, wholeWord, useRegex, findInSelection, selectionRange]);

  // Re-run search when search params change
  useEffect(() => {
    doSearch();
  }, [doSearch]);

  // Track editor selection changes to update the current index
  useEffect(() => {
    if (!editorView || !isOpen) return;

    const updateIndex = () => {
      if (matches.length > 0) {
        const selection = editorView.state.selection.main;
        const index = getCurrentMatchIndex(matches, {
          from: selection.from,
          to: selection.to,
        });
        setCurrentIndex(index);
      }
    };

    // Using EditorView's updateListener can cause a loop here, so we poll with a timer instead.
    const interval = setInterval(updateIndex, 100);
    return () => clearInterval(interval);
  }, [editorView, isOpen, matches]);

  // Jump to a specific match (used in "Find in Selection" mode)
  const goToMatch = useCallback((match: SearchMatch) => {
    if (!editorView) return;
    editorView.dispatch({
      selection: { anchor: match.from, head: match.to },
      scrollIntoView: true,
    });
  }, [editorView]);

  // Next match
  const handleNext = useCallback(() => {
    if (!editorView || matches.length === 0) return;

    // When "Find in Selection" is enabled, navigate using the filtered matches array
    // instead of CodeMirror's findNext (which searches the whole document).
    if (findInSelection && selectionRange) {
      // If currentIndex is -1 (initial), start from the first match
      const effectiveIndex = currentIndex < 0 ? -1 : currentIndex;
      const nextIndex = (effectiveIndex + 1) % matches.length;
      goToMatch(matches[nextIndex]);
      setCurrentIndex(nextIndex);
    } else {
      goToNextMatch(editorView);
      // Update index
      setTimeout(() => {
        const selection = editorView.state.selection.main;
        const index = getCurrentMatchIndex(matches, {
          from: selection.from,
          to: selection.to,
        });
        setCurrentIndex(index);
      }, 10);
    }
  }, [editorView, matches, findInSelection, selectionRange, currentIndex, goToMatch]);

  // Previous match
  const handlePrev = useCallback(() => {
    if (!editorView || matches.length === 0) return;

    // When "Find in Selection" is enabled, navigate using the filtered matches array
    // instead of CodeMirror's findPrevious (which searches the whole document).
    if (findInSelection && selectionRange) {
      // If currentIndex is -1 (initial), start from the last match
      const effectiveIndex = currentIndex < 0 ? 0 : currentIndex;
      const prevIndex = (effectiveIndex - 1 + matches.length) % matches.length;
      goToMatch(matches[prevIndex]);
      setCurrentIndex(prevIndex);
    } else {
      goToPrevMatch(editorView);
      // Update index
      setTimeout(() => {
        const selection = editorView.state.selection.main;
        const index = getCurrentMatchIndex(matches, {
          from: selection.from,
          to: selection.to,
        });
        setCurrentIndex(index);
      }, 10);
    }
  }, [editorView, matches, findInSelection, selectionRange, currentIndex, goToMatch]);

  // Replace current
  const handleReplace = useCallback(() => {
    if (!editorView) return;

    // Track the replacement for selection range adjustment
    let matchFrom = -1;
    let matchTo = -1;
    let replacementLength = 0;

    // When "Find in Selection" is enabled, use the filtered matches array
    // instead of CodeMirror's replaceNext (which searches the whole document).
    if (findInSelection && selectionRange && matches.length > 0) {
      // Find the current match or the next one
      let matchIndex = currentIndex >= 0 && currentIndex < matches.length ? currentIndex : 0;
      const match = matches[matchIndex];

      // Check whether the current selection is on a match
      const selection = editorView.state.selection.main;
      const isOnMatch = selection.from === match.from && selection.to === match.to;

      if (!isOnMatch) {
        // If we're not on the match yet, navigate to it first
        goToMatch(match);
        setCurrentIndex(matchIndex);
        return; // The next click will perform the actual replacement
      }

      // Perform replacement
      matchFrom = match.from;
      matchTo = match.to;
      const originalText = editorView.state.sliceDoc(match.from, match.to);
      const replacement = preserveCase
        ? preserveCaseReplace(originalText, replaceText)
        : replaceText;
      replacementLength = replacement.length;

      editorView.dispatch({
        changes: { from: match.from, to: match.to, insert: replacement },
      });

      // Update selection range
      const delta = replacementLength - (matchTo - matchFrom);
      const newTo = selectionRange.to + delta;
      setSelectionRange({ from: selectionRange.from, to: newTo });

      // Re-run search and navigate to the next match
      setTimeout(() => {
        doSearch();
        // Navigate to the next match (if any).
        // Note: matches state may not have updated yet, so we delay execution.
        setTimeout(() => {
          if (matches.length > 1) {
            // Match count may shrink after replacement; index may need adjustment
            const newIndex = matchIndex < matches.length - 1 ? matchIndex : 0;
            // But doSearch updates matches; we rely on its effect to update currentIndex.
          }
        }, 10);
      }, 10);
      return;
    }

    if (preserveCase) {
      // Preserve-case replacement
      let selection = editorView.state.selection.main;

      // If no text is selected, navigate to next match first (consistent with replaceNext behavior)
      if (selection.empty) {
        goToNextMatch(editorView);
        selection = editorView.state.selection.main;
      }

      if (!selection.empty) {
        matchFrom = selection.from;
        matchTo = selection.to;
        const originalText = editorView.state.sliceDoc(selection.from, selection.to);
        const preservedReplacement = preserveCaseReplace(originalText, replaceText);
        replacementLength = preservedReplacement.length;
        editorView.dispatch({
          changes: { from: selection.from, to: selection.to, insert: preservedReplacement },
        });
        // Find next
        goToNextMatch(editorView);
      }
    } else {
      // Track the match before replacing
      const selection = editorView.state.selection.main;
      if (!selection.empty) {
        matchFrom = selection.from;
        matchTo = selection.to;
        replacementLength = replaceText.length;
      }
      replaceCurrentMatch(editorView);
    }

    // Update selection range if findInSelection is enabled to prevent stale positions
    if (findInSelection && selectionRange && matchFrom >= 0 && matchTo >= 0) {
      const delta = replacementLength - (matchTo - matchFrom);

      let newFrom = selectionRange.from;
      let newTo = selectionRange.to;

      // If the match is entirely before the selection range start, shift both bounds
      if (matchTo <= selectionRange.from) {
        newFrom += delta;
        newTo += delta;
      }
      // If the match is within or overlaps with the selection range, adjust the end
      else if (matchFrom < selectionRange.to) {
        newTo += delta;
      }

      setSelectionRange({ from: newFrom, to: newTo });
    }

    // Re-run search to refresh matches
    setTimeout(doSearch, 10);
  }, [editorView, doSearch, preserveCase, replaceText, findInSelection, selectionRange, matches, currentIndex, goToMatch]);

  // Replace all
  const handleReplaceAll = useCallback(() => {
    if (!editorView || matches.length === 0) return;

    // When findInSelection is enabled or preserveCase is used, we need to manually
    // replace using the filtered matches array to respect the selection range.
    // replaceAllMatches() ignores selection and replaces the entire document.
    if (findInSelection || preserveCase) {
      // Calculate total delta for selection range adjustment
      let totalDelta = 0;

      // Replace from end to start to avoid position shift issues
      const changes = matches
        .slice()
        .reverse()
        .map((match) => {
          const originalText = editorView.state.sliceDoc(match.from, match.to);
          const replacement = preserveCase
            ? preserveCaseReplace(originalText, replaceText)
            : replaceText;
          totalDelta += replacement.length - (match.to - match.from);
          return { from: match.from, to: match.to, insert: replacement };
        });
      editorView.dispatch({ changes });

      // Update selection range if findInSelection is enabled to prevent stale positions
      if (findInSelection && selectionRange) {
        setSelectionRange({ from: selectionRange.from, to: selectionRange.to + totalDelta });
      }
    } else {
      replaceAllMatches(editorView);
    }
    // Re-run search to refresh matches
    setTimeout(doSearch, 10);
  }, [editorView, doSearch, findInSelection, preserveCase, replaceText, matches, selectionRange]);

  // Close panel
  const handleClose = useCallback(() => {
    if (editorView) {
      // Clear search highlighting
      const query = createSearchQuery({ search: "" });
      performSearch(editorView, query);
      // Sync CodeMirror's searchPanelState so Escape isn't incorrectly captured
      editorView.dispatch({
        effects: toggleSearchPanelEffect.of({ open: false }),
      });
    }
    onClose();
  }, [editorView, onClose]);

  // Keyboard handlers
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          handlePrev();
        } else {
          handleNext();
        }
      } else if (e.key === "F3") {
        e.preventDefault();
        if (e.shiftKey) {
          handlePrev();
        } else {
          handleNext();
        }
      }
    },
    [handleClose, handleNext, handlePrev]
  );

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "absolute top-2 right-4 z-50",
        "bg-popover border border-border rounded-md shadow-lg",
        "flex flex-col gap-1.5 p-2",
        "min-w-[380px] max-w-[520px]"
      )}
      onKeyDown={handleKeyDown}
    >
      {/* Find row */}
      <div className="flex items-center gap-1.5">
        {/* Expand/collapse replace */}
        <button
          type="button"
          onClick={onToggleReplace}
          className={cn(
            "p-1 rounded hover:bg-accent text-muted-foreground",
            "transition-colors flex-shrink-0 w-6 flex justify-center"
          )}
          title={showReplace ? t("hideReplace") : t("showReplace")}
        >
          {showReplace ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>

        {/* Search input */}
        <div className="relative flex-1 min-w-[140px]">
          <input
            ref={searchInputRef}
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder={t("find")}
            className={cn(
              "w-full h-7 px-2 text-sm",
              "bg-background border rounded",
              "focus:outline-none focus:ring-1 focus:ring-primary",
              regexError && "border-destructive focus:ring-destructive"
            )}
          />
        </div>

        {/* Search option buttons */}
        <div className="flex items-center">
          <OptionButton
            active={caseSensitive}
            onClick={() => setCaseSensitive(!caseSensitive)}
            title={t("caseSensitive")}
          >
            <span className="text-xs font-medium">Aa</span>
          </OptionButton>
          <OptionButton
            active={wholeWord}
            onClick={() => setWholeWord(!wholeWord)}
            title={t("wholeWord")}
          >
            <span className="text-xs font-medium" style={{ textDecoration: 'underline', textUnderlineOffset: '2px' }}>ab</span>
          </OptionButton>
          <OptionButton
            active={useRegex}
            onClick={() => setUseRegex(!useRegex)}
            title={t("useRegex")}
          >
            <span className="text-xs font-medium">.*</span>
          </OptionButton>
        </div>

        {/* Match count */}
        <div className="text-xs text-muted-foreground min-w-[56px] text-center whitespace-nowrap">
          {searchText ? (
            regexError ? (
              <span className="text-destructive">{t("error")}</span>
            ) : matches.length > 0 ? (
              `${currentIndex + 1} / ${matches.length}`
            ) : (
              t("noResults")
            )
          ) : null}
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center">
          <NavButton onClick={handlePrev} disabled={matches.length === 0} title={t("prevMatch")}>
            <ChevronUp className="h-4 w-4" />
          </NavButton>
          <NavButton onClick={handleNext} disabled={matches.length === 0} title={t("nextMatch")}>
            <ChevronDown className="h-4 w-4" />
          </NavButton>
        </div>

        {/* Find in selection */}
        <OptionButton
          active={findInSelection}
          onClick={() => setFindInSelection(!findInSelection)}
          title={t("findInSelection")}
        >
          <TextSelect className="h-4 w-4" />
        </OptionButton>

        {/* Close button */}
        <button
          type="button"
          onClick={handleClose}
          className={cn(
            "p-1 rounded hover:bg-accent text-muted-foreground",
            "transition-colors flex-shrink-0"
          )}
          title={t("close")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Replace row */}
      {showReplace && (
        <div className="flex items-center gap-1.5">
          {/* Placeholder aligned with the expand button */}
          <div className="w-6 flex-shrink-0" />

          {/* Replace input */}
          <div className="relative flex-1 min-w-[140px]">
            <input
              ref={replaceInputRef}
              type="text"
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              placeholder={t("replace")}
              className={cn(
                "w-full h-7 px-2 text-sm",
                "bg-background border rounded",
                "focus:outline-none focus:ring-1 focus:ring-primary"
              )}
            />
          </div>

          {/* Preserve-case button */}
          <OptionButton
            active={preserveCase}
            onClick={() => setPreserveCase(!preserveCase)}
            title={t("preserveCase")}
          >
            <span className="text-xs font-medium">AB</span>
          </OptionButton>

          {/* Replace buttons */}
          <div className="flex items-center">
            <NavButton
              onClick={handleReplace}
              disabled={matches.length === 0}
              title={t("replaceOne")}
            >
              <Replace className="h-4 w-4" />
            </NavButton>
            <NavButton
              onClick={handleReplaceAll}
              disabled={matches.length === 0}
              title={t("replaceAll")}
            >
              <ReplaceAll className="h-4 w-4" />
            </NavButton>
          </div>
        </div>
      )}

      {/* Regex error message */}
      {regexError && (
        <div className="text-xs text-destructive px-6">
          {regexError}
        </div>
      )}
    </div>
  );
}

// Search option button component
function OptionButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "p-1 rounded transition-colors",
        active
          ? "bg-primary/20 text-primary"
          : "text-muted-foreground hover:bg-accent"
      )}
      title={title}
    >
      {children}
    </button>
  );
}

// Navigation button component
function NavButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "p-1 rounded transition-colors",
        disabled
          ? "text-muted-foreground/50 cursor-not-allowed"
          : "text-muted-foreground hover:bg-accent"
      )}
      title={title}
    >
      {children}
    </button>
  );
}
