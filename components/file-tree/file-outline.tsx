"use client";

import { useMemo, useState, useEffect } from "react";
import { ChevronDown, ChevronRight, ChevronUp, List, FileText, Hash } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/lib/i18n";

interface OutlineItem {
  id: string;
  title: string;
  level: number;
  line: number;
  children: OutlineItem[];
}

interface FileOutlineProps {
  content: string;
  mode: "latex" | "markdown";
  onNavigate?: (line: number) => void;
  className?: string;
  defaultCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  currentLine?: number; // Current cursor line in editor for bi-directional sync
}

// LaTeX heading command patterns (match command prefix only, then use brace matching)
const LATEX_COMMAND_PATTERNS: { regex: RegExp; level: number; name: string }[] = [
  { regex: /\\part\*?\{/, level: 0, name: "part" },
  { regex: /\\chapter\*?\{/, level: 1, name: "chapter" },
  { regex: /\\section\*?\{/, level: 2, name: "section" },
  { regex: /\\subsection\*?\{/, level: 3, name: "subsection" },
  { regex: /\\subsubsection\*?\{/, level: 4, name: "subsubsection" },
  { regex: /\\paragraph\*?\{/, level: 5, name: "paragraph" },
];

// Count consecutive backslashes immediately before a given position
// Returns the number of backslashes before str[index]
function countPrecedingBackslashes(str: string, index: number): number {
  let count = 0;
  let pos = index - 1;
  while (pos >= 0 && str[pos] === '\\') {
    count++;
    pos--;
  }
  return count;
}

// Check if a character at the given position is escaped
// A character is escaped only if preceded by an odd number of backslashes
// e.g., \{ is escaped, \\{ is not (the backslash itself is escaped), \\\{ is escaped
function isEscaped(str: string, index: number): boolean {
  return countPrecedingBackslashes(str, index) % 2 === 1;
}

// Extract content with balanced braces starting from a given position
// Returns the content inside braces and the end index, or null if unbalanced
function extractBalancedBraces(str: string, startIndex: number): { content: string; endIndex: number } | null {
  if (str[startIndex] !== '{') return null;

  let depth = 0;
  const contentStart = startIndex + 1;

  for (let i = startIndex; i < str.length; i++) {
    const char = str[i];
    // Skip escaped braces - only truly escaped if preceded by odd number of backslashes
    // e.g., \{ is escaped, \\{ is not (backslash is escaped), \\\{ is escaped
    if (isEscaped(str, i)) continue;

    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return {
          content: str.substring(contentStart, i),
          endIndex: i
        };
      }
    }
  }

  return null; // Unbalanced braces
}

// Remove \command{content} patterns with balanced braces, keeping only the content
function stripLatexCommands(str: string): string {
  let result = str;
  let changed = true;

  // Repeatedly process \command{...} patterns until no more are found
  while (changed) {
    changed = false;
    const cmdMatch = /\\[a-zA-Z]+\{/.exec(result);
    if (cmdMatch) {
      const braceStart = cmdMatch.index + cmdMatch[0].length - 1;
      const extracted = extractBalancedBraces(result, braceStart);
      if (extracted) {
        result = result.substring(0, cmdMatch.index) + extracted.content + result.substring(extracted.endIndex + 1);
        changed = true;
      }
    }
  }

  return result;
}

// Clean up LaTeX title - handle commands and special characters
function cleanLatexTitle(rawTitle: string): string {
  // First strip \command{content} patterns with balanced braces
  let result = stripLatexCommands(rawTitle);

  return result
    // \command -> command name (e.g., \model -> model, \alpha -> α)
    .replace(/\\([a-zA-Z]+)/g, (_, cmd) => {
      // Common Greek letters and symbols
      const symbols: Record<string, string> = {
        alpha: "α", beta: "β", gamma: "γ", delta: "δ",
        epsilon: "ε", lambda: "λ", mu: "μ", pi: "π",
        sigma: "σ", theta: "θ", omega: "ω",
        // Keep custom commands as readable text
      };
      return symbols[cmd] || cmd;
    })
    // Remove backslashes before special chars (e.g., \_ -> _, \& -> &)
    .replace(/\\([_&%$#])/g, "$1")
    // Remove remaining backslashes
    .replace(/\\/g, "")
    // Normalize whitespace
    .replace(/\s+/g, " ")
    .trim();
}

// Parse LaTeX content for outline
function parseLatexOutline(content: string): OutlineItem[] {
  const lines = content.split("\n");
  const items: { title: string; level: number; line: number }[] = [];

  lines.forEach((line, index) => {
    // Skip commented lines (lines starting with %)
    const trimmedLine = line.trimStart();
    if (trimmedLine.startsWith("%")) {
      return;
    }

    for (const pattern of LATEX_COMMAND_PATTERNS) {
      // Reset regex lastIndex for each line
      const regex = new RegExp(pattern.regex.source, "g");
      const match = regex.exec(line);
      if (match) {
        // Check if the match is after an inline comment (% not escaped as \%)
        const matchIndex = match.index;
        const beforeMatch = line.substring(0, matchIndex);
        // Remove escaped \% and check if there's still a % (which would be a comment)
        if (beforeMatch.replace(/\\%/g, "").includes("%")) {
          continue; // Skip this match as it's in a comment
        }

        // Extract content with balanced braces
        const braceStart = matchIndex + match[0].length - 1;
        const extracted = extractBalancedBraces(line, braceStart);

        if (extracted) {
          // Clean up the title
          const title = cleanLatexTitle(extracted.content);

          if (title) {
            items.push({
              title,
              level: pattern.level,
              line: index + 1, // 1-based line number
            });
          }
        }
        break; // Only match one pattern per line
      }
    }
  });

  return buildTree(items);
}

// Parse Markdown content for outline
function parseMarkdownOutline(content: string): OutlineItem[] {
  const lines = content.split("\n");
  const items: { title: string; level: number; line: number }[] = [];
  const headingRegex = /^(#{1,6})\s+(.+)$/;

  lines.forEach((line, index) => {
    const match = headingRegex.exec(line);
    if (match) {
      const level = match[1].length - 1; // # = level 0, ## = level 1, etc.
      const title = match[2].trim();
      if (title) {
        items.push({
          title,
          level,
          line: index + 1, // 1-based line number
        });
      }
    }
  });

  return buildTree(items);
}

// Build a tree structure from flat items
function buildTree(items: { title: string; level: number; line: number }[]): OutlineItem[] {
  if (items.length === 0) return [];

  const root: OutlineItem[] = [];
  const stack: { item: OutlineItem; level: number }[] = [];

  // Find the minimum level to normalize
  const minLevel = Math.min(...items.map((item) => item.level));

  items.forEach((item, index) => {
    const normalizedLevel = item.level - minLevel;
    const outlineItem: OutlineItem = {
      id: `outline-${index}`,
      title: item.title,
      level: normalizedLevel,
      line: item.line,
      children: [],
    };

    // Find the parent for this item
    while (stack.length > 0 && stack[stack.length - 1].level >= normalizedLevel) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(outlineItem);
    } else {
      stack[stack.length - 1].item.children.push(outlineItem);
    }

    stack.push({ item: outlineItem, level: normalizedLevel });
  });

  return root;
}

// Get all outline items as flat list with their line numbers
function flattenOutline(items: OutlineItem[]): { line: number; item: OutlineItem }[] {
  const result: { line: number; item: OutlineItem }[] = [];

  function traverse(itemList: OutlineItem[]) {
    for (const item of itemList) {
      result.push({ line: item.line, item });
      if (item.children.length > 0) {
        traverse(item.children);
      }
    }
  }

  traverse(items);
  // Sort by line number
  return result.sort((a, b) => a.line - b.line);
}

// Find which outline item contains the current line
function findCurrentSection(flatItems: { line: number; item: OutlineItem }[], currentLine: number): number | undefined {
  if (flatItems.length === 0) return undefined;

  // Find the last item whose line is <= currentLine
  let result: number | undefined;
  for (const { line } of flatItems) {
    if (line <= currentLine) {
      result = line;
    } else {
      break;
    }
  }
  return result;
}

// Font weight and size based on depth (like markdown heading sizes)
function getItemStyle(depth: number): { weight: string; size: string } {
  switch (depth) {
    case 0: return { weight: "font-semibold", size: "text-sm" };
    case 1: return { weight: "font-medium", size: "text-[13px]" };
    default: return { weight: "font-normal", size: "text-xs" };
  }
}

// Get accent color based on depth
function getAccentColor(depth: number): string {
  switch (depth) {
    case 0: return "text-primary";
    case 1: return "text-foreground/90";
    default: return "text-muted-foreground";
  }
}

// Recursive component to render outline items with refined styling
function OutlineItemComponent({
  item,
  onNavigate,
  defaultExpanded = true,
  depth = 0,
  activeLine,
}: {
  item: OutlineItem;
  onNavigate?: (line: number) => void;
  defaultExpanded?: boolean;
  depth?: number;
  activeLine?: number;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasChildren = item.children.length > 0;
  const isActive = activeLine === item.line;
  const itemStyle = getItemStyle(depth);

  return (
    <div className="relative">
      {/* Vertical guide line - refined with gradient */}
      {depth > 0 && (
        <div
          className="absolute w-px bg-gradient-to-b from-border/60 via-border/40 to-transparent"
          style={{
            left: `${(depth - 1) * 14 + 10}px`,
            top: 0,
            bottom: 0
          }}
        />
      )}

      {/* Current item */}
      <div
        className={cn(
          "group relative flex cursor-pointer items-center gap-1.5 py-1.5 pr-3 rounded-md mx-1 my-0.5 transition-all duration-200",
          itemStyle.weight,
          itemStyle.size,
          isActive
            ? "bg-primary/15 text-primary shadow-sm ring-1 ring-primary/20"
            : "hover:bg-accent/50 text-foreground/80 hover:text-foreground",
        )}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => onNavigate?.(item.line)}
      >
        {/* Expand/collapse button or dot indicator */}
        {hasChildren ? (
          <button
            className={cn(
              "flex h-4 w-4 items-center justify-center rounded-sm transition-colors",
              isActive ? "text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        ) : (
          <span className="flex h-4 w-4 items-center justify-center">
            <span className={cn(
              "h-1 w-1 rounded-full",
              isActive ? "bg-primary" : "bg-muted-foreground/50"
            )} />
          </span>
        )}

        {/* Title with line number on hover */}
        <span className="flex-1 truncate leading-tight">
          {item.title}
        </span>

        {/* Line number indicator - visible on hover */}
        <span className={cn(
          "text-[10px] tabular-nums transition-opacity",
          isActive ? "opacity-60" : "opacity-0 group-hover:opacity-40"
        )}>
          L{item.line}
        </span>
      </div>

      {/* Children with smooth animation */}
      {hasChildren && expanded && (
        <div className="relative animate-in fade-in-0 slide-in-from-top-1 duration-150">
          {item.children.map((child) => (
            <OutlineItemComponent
              key={child.id}
              item={child}
              onNavigate={onNavigate}
              defaultExpanded={defaultExpanded}
              depth={depth + 1}
              activeLine={activeLine}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileOutline({
  content,
  mode,
  onNavigate,
  className,
  defaultCollapsed = false,
  onCollapsedChange,
  currentLine,
}: FileOutlineProps) {
  const { t } = useTranslations("outline");
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  const outlineItems = useMemo(() => {
    if (!content) return [];
    return mode === "latex"
      ? parseLatexOutline(content)
      : parseMarkdownOutline(content);
  }, [content, mode]);

  // Flatten outline for finding current section
  const flatItems = useMemo(() => flattenOutline(outlineItems), [outlineItems]);

  // Find active line based on current cursor position (bi-directional sync)
  const activeLine = useMemo(() => {
    if (currentLine === undefined) return undefined;
    return findCurrentSection(flatItems, currentLine);
  }, [flatItems, currentLine]);

  // Count total outline items
  const countItems = (items: OutlineItem[]): number => {
    return items.reduce((sum, item) => sum + 1 + countItems(item.children), 0);
  };
  const totalItems = countItems(outlineItems);

  const isEmpty = outlineItems.length === 0;

  const handleToggleCollapse = () => {
    const newCollapsed = !isCollapsed;
    setIsCollapsed(newCollapsed);
    onCollapsedChange?.(newCollapsed);
  };

  const handleNavigate = (line: number) => {
    onNavigate?.(line);
  };

  // Collapsed view - minimal header with count badge
  if (isCollapsed) {
    return (
      <div
        className={cn(
          "flex cursor-pointer items-center gap-2 bg-gradient-to-r from-muted/60 to-muted/40 border-t border-border/80 px-3 py-2.5 hover:from-muted/80 hover:to-muted/60 transition-all duration-200",
          className
        )}
        onClick={handleToggleCollapse}
      >
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-transform" />
        <Hash className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium tracking-wide text-muted-foreground">
          {t("title")}
        </span>
        {totalItems > 0 && (
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-medium bg-background/60">
            {totalItems}
          </Badge>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex h-full flex-col bg-background/50", className)}>
      {/* Header with collapse button and count badge */}
      <div className="flex items-center justify-between bg-gradient-to-r from-muted/60 to-muted/40 border-b border-border/80 px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={handleToggleCollapse}
            className="p-0.5 rounded hover:bg-muted transition-colors"
          >
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground transition-colors" />
          </button>
          <Hash className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium tracking-wide text-muted-foreground">
            {t("title")}
          </span>
        </div>
        {totalItems > 0 && (
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-medium bg-background/60">
            {totalItems}
          </Badge>
        )}
      </div>

      {/* Content with refined styling */}
      <ScrollArea className="flex-1 py-1">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
            <div className="p-3 rounded-full bg-muted/50 mb-3">
              <FileText className="h-5 w-5 text-muted-foreground/50" />
            </div>
            <p className="text-xs text-muted-foreground">{t("empty")}</p>
          </div>
        ) : (
          <div className="py-1">
            {outlineItems.map((item) => (
              <OutlineItemComponent
                key={item.id}
                item={item}
                onNavigate={handleNavigate}
                activeLine={activeLine}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
