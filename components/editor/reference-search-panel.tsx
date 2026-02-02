"use client";

/**
 * Advanced reference search panel.
 * Supports searching citations in project .bib files and inserting quickly.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Search, X, BookOpen, FileText, Calendar, User } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/lib/i18n";
import {
  type BibEntry,
  type BibSearchResult,
  extractBibEntries,
  searchBibEntries,
  highlightMatch,
  formatAuthors,
  getEntryTypeName,
} from "@/lib/bibtex-parser";
import type { ProjectFile } from "@/types";

interface ReferenceSearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (key: string) => void;
  files: ProjectFile[];
}

/**
 * Highlighted text component.
 */
function HighlightedText({
  text,
  query,
  className,
}: {
  text: string;
  query: string;
  className?: string;
}) {
  const segments = highlightMatch(text, query);

  return (
    <span className={className}>
      {segments.map((segment, index) =>
        segment.isHighlight ? (
          <mark
            key={index}
            className="bg-primary/30 text-foreground rounded-sm px-0.5"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        )
      )}
    </span>
  );
}

/**
 * Reference entry card.
 */
function ReferenceCard({
  entry,
  query,
  isSelected,
  onClick,
  onDoubleClick,
}: {
  entry: BibSearchResult;
  query: string;
  isSelected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}) {
  const formattedAuthors = formatAuthors(entry.authors);
  const venue = entry.journal || entry.booktitle;

  return (
    <div
      className={cn(
        "group p-3 rounded-lg border cursor-pointer transition-all overflow-hidden",
        "hover:bg-accent/50 hover:border-primary/30",
        isSelected && "bg-accent border-primary ring-1 ring-primary/50"
      )}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {/* Title and type */}
      <div className="flex items-start justify-between gap-2 mb-1.5 min-w-0">
        <HighlightedText
          text={entry.title}
          query={query}
          className="font-medium text-sm leading-tight line-clamp-2 min-w-0"
        />
        <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wider">
          {getEntryTypeName(entry.type)}
        </span>
      </div>

      {/* Authors */}
      {formattedAuthors && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1 min-w-0">
          <User className="h-3 w-3 flex-shrink-0" />
          <HighlightedText
            text={formattedAuthors}
            query={query}
            className="line-clamp-1 min-w-0"
          />
        </div>
      )}

      {/* Year and venue */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground min-w-0">
        {entry.year && (
          <span className="flex items-center gap-1 flex-shrink-0">
            <Calendar className="h-3 w-3" />
            <HighlightedText text={entry.year} query={query} />
          </span>
        )}
        {venue && (
          <span className="flex items-center gap-1 min-w-0 flex-1">
            <BookOpen className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{venue}</span>
          </span>
        )}
      </div>

      {/* Citation key */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50 min-w-0 gap-2">
        <code className="text-xs font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded truncate min-w-0">
          <HighlightedText text={entry.key} query={query} />
        </code>
        {entry.sourceFile && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground flex-shrink-0">
            <FileText className="h-3 w-3" />
            <span className="truncate max-w-[120px]">{entry.sourceFile}</span>
          </span>
        )}
      </div>
    </div>
  );
}

export function ReferenceSearchPanel({
  isOpen,
  onClose,
  onSelect,
  files,
}: ReferenceSearchPanelProps) {
  const { t } = useTranslations("editor");
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Parse all .bib files
  const allEntries = useMemo(() => {
    return extractBibEntries(files);
  }, [files]);

  // Search results
  const searchResults = useMemo(() => {
    return searchBibEntries(allEntries, query);
  }, [allEntries, query]);

  // Reset state and focus when opened
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Scroll selected item into view when selection changes
  useEffect(() => {
    if (listRef.current && selectedIndex >= 0) {
      const selectedElement = listRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [selectedIndex]);

  // Confirm selection
  const handleConfirm = useCallback(() => {
    if (searchResults.length > 0 && selectedIndex >= 0 && selectedIndex < searchResults.length) {
      onSelect(searchResults[selectedIndex].key);
      onClose();
    }
  }, [searchResults, selectedIndex, onSelect, onClose, query]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < searchResults.length - 1 ? prev + 1 : prev
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case "Enter":
          e.preventDefault();
          handleConfirm();
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [searchResults.length, handleConfirm, onClose]
  );

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-3xl p-0 gap-0 overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="text-base font-medium">
            {t("referenceSearch.title")}
          </DialogTitle>
        </DialogHeader>

        {/* Search input */}
        <div className="px-4 py-3 border-b bg-muted/30">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("referenceSearch.placeholder")}
              className="pl-9 pr-9 h-10 bg-background"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                title="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Result list */}
        <ScrollArea className="h-[400px]">
          <div ref={listRef} className="p-3 space-y-2">
            {searchResults.length > 0 ? (
              searchResults.map((entry, index) => (
                <ReferenceCard
                  key={`${entry.key}-${entry.sourceFile}`}
                  entry={entry}
                  query={query}
                  isSelected={index === selectedIndex}
                  onClick={() => setSelectedIndex(index)}
                  onDoubleClick={handleConfirm}
                />
              ))
            ) : allEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[300px] text-muted-foreground">
                <FileText className="h-12 w-12 mb-3 opacity-50" />
                <p className="text-sm">{t("referenceSearch.noBibFiles")}</p>
                <p className="text-xs mt-1">{t("referenceSearch.noBibFilesHint")}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-[300px] text-muted-foreground">
                <Search className="h-12 w-12 mb-3 opacity-50" />
                <p className="text-sm">{t("referenceSearch.noResults")}</p>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footer status bar */}
        <div className="px-4 py-2 border-t bg-muted/30 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {allEntries.length > 0
              ? t("referenceSearch.resultCount", {
                  shown: searchResults.length,
                  total: allEntries.length,
                })
              : t("referenceSearch.noEntries")}
          </span>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-muted border text-[10px]">↑↓</kbd>
              {t("referenceSearch.navigate")}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-muted border text-[10px]">Enter</kbd>
              {t("referenceSearch.select")}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-muted border text-[10px]">Esc</kbd>
              {t("referenceSearch.close")}
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
