"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Search, Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/lib/i18n";
import {
  symbolCategories,
  searchSymbols,
  type LatexSymbol,
  type SymbolCategory,
} from "@/lib/latex-symbols";

interface SymbolPickerProps {
  onSelect: (latex: string) => void;
  disabled?: boolean;
}

// LocalStorage key for recent symbols
const RECENT_SYMBOLS_KEY = "litewrite-recent-symbols";
const MAX_RECENT_SYMBOLS = 16;

// Get recent symbols from localStorage
function getRecentSymbols(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(RECENT_SYMBOLS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

// Save recent symbol to localStorage
function saveRecentSymbol(latex: string): void {
  if (typeof window === "undefined") return;
  try {
    const recent = getRecentSymbols();
    const updated = [latex, ...recent.filter((s) => s !== latex)].slice(
      0,
      MAX_RECENT_SYMBOLS
    );
    localStorage.setItem(RECENT_SYMBOLS_KEY, JSON.stringify(updated));
  } catch {
    // Ignore localStorage errors
  }
}

// Symbol button component
interface SymbolButtonProps {
  symbol: LatexSymbol;
  isSelected: boolean;
  onClick: () => void;
  onHover: () => void;
}

function SymbolButton({
  symbol,
  isSelected,
  onClick,
  onHover,
}: SymbolButtonProps) {
  return (
    <button
      className={cn(
        "w-9 h-9 flex items-center justify-center rounded text-sm transition-colors",
        "hover:bg-accent hover:text-accent-foreground",
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
        isSelected && "bg-accent text-accent-foreground ring-2 ring-primary"
      )}
      onClick={onClick}
      onMouseEnter={onHover}
      tabIndex={-1}
    >
      {symbol.symbol}
    </button>
  );
}

// Symbol grid component
interface SymbolGridProps {
  symbols: LatexSymbol[];
  selectedIndex: number;
  onSelect: (symbol: LatexSymbol) => void;
  onHover: (symbol: LatexSymbol, index: number) => void;
  gridRef: React.RefObject<HTMLDivElement>;
}

function SymbolGrid({
  symbols,
  selectedIndex,
  onSelect,
  onHover,
  gridRef,
}: SymbolGridProps) {
  return (
    <div ref={gridRef} className="grid grid-cols-8 gap-1 p-2">
      {symbols.map((symbol, index) => (
        <SymbolButton
          key={`${symbol.latex}-${index}`}
          symbol={symbol}
          isSelected={index === selectedIndex}
          onClick={() => onSelect(symbol)}
          onHover={() => onHover(symbol, index)}
        />
      ))}
    </div>
  );
}

// Preview component
interface PreviewProps {
  symbol: LatexSymbol | null;
}

function Preview({ symbol }: PreviewProps) {
  const { t } = useTranslations("editor");

  if (!symbol) {
    return (
      <div className="h-12 px-3 py-2 border-t bg-muted/30 text-muted-foreground text-sm flex items-center">
        {t("toolbar.symbolPicker.hoverToPreview")}
      </div>
    );
  }

  return (
    <div className="h-12 px-3 py-2 border-t bg-muted/30 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <span className="text-2xl">{symbol.symbol}</span>
        <span className="font-mono text-sm text-primary">{symbol.latex}</span>
      </div>
      <div className="text-xs text-muted-foreground truncate">
        {symbol.name}
      </div>
    </div>
  );
}

export function SymbolPicker({ onSelect, disabled }: SymbolPickerProps) {
  const { t } = useTranslations("editor");
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("recent");
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [hoveredSymbol, setHoveredSymbol] = useState<LatexSymbol | null>(null);
  const [recentSymbols, setRecentSymbols] = useState<LatexSymbol[]>([]);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Load recent symbols on mount
  useEffect(() => {
    const recentLatex = getRecentSymbols();
    const allSymbols = symbolCategories.flatMap((cat) => cat.symbols);
    const recent = recentLatex
      .map((latex) => allSymbols.find((s) => s.latex === latex))
      .filter((s): s is LatexSymbol => s !== undefined);
    setRecentSymbols(recent);

    // If no recent symbols, default to greek tab
    if (recent.length === 0) {
      setActiveTab("greek");
    }
  }, [open]);

  // Get current symbols based on search or active tab
  const currentSymbols = useMemo(() => {
    if (searchQuery) {
      return searchSymbols(searchQuery);
    }
    if (activeTab === "recent") {
      return recentSymbols;
    }
    const category = symbolCategories.find((cat) => cat.key === activeTab);
    return category?.symbols || [];
  }, [searchQuery, activeTab, recentSymbols]);

  // Handle symbol selection
  const handleSelect = useCallback(
    (symbol: LatexSymbol) => {
      onSelect(symbol.latex);
      saveRecentSymbol(symbol.latex);
      setOpen(false);
      setSearchQuery("");
      setSelectedIndex(-1);
    },
    [onSelect]
  );

  // Handle hover
  const handleHover = useCallback(
    (symbol: LatexSymbol, index: number) => {
      setHoveredSymbol(symbol);
      setSelectedIndex(index);
    },
    []
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const symbols = currentSymbols;
      const cols = 8;

      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < symbols.length - 1 ? prev + 1 : prev
          );
          break;
        case "ArrowLeft":
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev + cols < symbols.length ? prev + cols : prev
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev - cols >= 0 ? prev - cols : prev));
          break;
        case "Enter":
          e.preventDefault();
          if (selectedIndex >= 0 && selectedIndex < symbols.length) {
            handleSelect(symbols[selectedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          setOpen(false);
          break;
      }
    },
    [currentSymbols, selectedIndex, handleSelect]
  );

  // Update hovered symbol when selection changes via keyboard
  useEffect(() => {
    if (selectedIndex >= 0 && selectedIndex < currentSymbols.length) {
      setHoveredSymbol(currentSymbols[selectedIndex]);
    }
  }, [selectedIndex, currentSymbols]);

  // Focus search input when popover opens
  useEffect(() => {
    if (open) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [open]);

  // Reset state when tab changes
  useEffect(() => {
    setSelectedIndex(-1);
    setHoveredSymbol(null);
  }, [activeTab, searchQuery]);

  // Tab list for rendering - use translation keys
  const tabList = useMemo(() => {
    return [
      { key: "recent", icon: Clock },
      ...symbolCategories.map((cat) => ({ key: cat.key })),
    ];
  }, []);

  // Get translated tab name
  const getTabName = (key: string): string => {
    return t(`toolbar.symbolPicker.categories.${key}`) || key;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 font-serif text-base"
              disabled={disabled}
            >
              Ω
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("toolbar.mathSymbols")}</TooltipContent>
      </Tooltip>

      <PopoverContent
        className="w-[420px] p-0"
        align="start"
        onKeyDown={handleKeyDown}
      >
        {/* Search Input */}
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder={t("toolbar.symbolPicker.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                aria-label={t("toolbar.symbolPicker.clearSearch")}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Tabs or Search Results */}
        {searchQuery ? (
          // Search Results
          <div className="flex flex-col">
            <div className="px-3 py-2 text-xs text-muted-foreground border-b">
              {t("toolbar.symbolPicker.searchResults", {
                count: currentSymbols.length,
              })}
            </div>
            <ScrollArea className="h-[240px]">
              {currentSymbols.length > 0 ? (
                <SymbolGrid
                  symbols={currentSymbols}
                  selectedIndex={selectedIndex}
                  onSelect={handleSelect}
                  onHover={handleHover}
                  gridRef={gridRef}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  {t("toolbar.symbolPicker.noResults")}
                </div>
              )}
            </ScrollArea>
          </div>
        ) : (
          // Tabs
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <div className="border-b overflow-hidden">
              <ScrollArea orientation="horizontal" className="w-full">
                <TabsList className="inline-flex h-auto p-1 bg-transparent gap-0.5 w-max">
                  {tabList.map((tab) => (
                    <TabsTrigger
                      key={tab.key}
                      value={tab.key}
                      className="text-xs px-2 py-1 h-7 data-[state=active]:bg-muted whitespace-nowrap"
                    >
                      {"icon" in tab && tab.icon ? (
                        <tab.icon className="h-3 w-3 mr-1" />
                      ) : null}
                      {getTabName(tab.key)}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </ScrollArea>
            </div>

            <ScrollArea className="h-[240px]">
              {/* Recent Tab */}
              <TabsContent value="recent" className="m-0">
                {recentSymbols.length > 0 ? (
                  <SymbolGrid
                    symbols={recentSymbols}
                    selectedIndex={selectedIndex}
                    onSelect={handleSelect}
                    onHover={handleHover}
                    gridRef={gridRef}
                  />
                ) : (
                  <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
                    {t("toolbar.symbolPicker.noRecent")}
                  </div>
                )}
              </TabsContent>

              {/* Category Tabs */}
              {symbolCategories.map((category) => (
                <TabsContent key={category.key} value={category.key} className="m-0">
                  <SymbolGrid
                    symbols={category.symbols}
                    selectedIndex={selectedIndex}
                    onSelect={handleSelect}
                    onHover={handleHover}
                    gridRef={gridRef}
                  />
                </TabsContent>
              ))}
            </ScrollArea>
          </Tabs>
        )}

        {/* Preview */}
        <Preview symbol={hoveredSymbol} />
      </PopoverContent>
    </Popover>
  );
}
