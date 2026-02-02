"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { EditorView } from "@codemirror/view";
import { undo, redo } from "@codemirror/commands";
import {
  Undo2,
  Redo2,
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Table,
  Link,
  Quote,
  Image,
  ChevronDown,
  BookMarked,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/lib/i18n";
import { SymbolPicker } from "./symbol-picker";

interface EditorToolbarProps {
  editorView: EditorView | null;
  className?: string;
  onOpenReferenceSearch?: () => void;
  // Connection status
  isConnected?: boolean;
  isTapLoading?: boolean;
  tapError?: string | null;
}

// Table template
const tableTemplate = `\\begin{table}[htbp]
  \\centering
  \\caption{Table caption}
  \\begin{tabular}{|c|c|c|}
    \\hline
    Col 1 & Col 2 & Col 3 \\\\
    \\hline
    Data 1 & Data 2 & Data 3 \\\\
    \\hline
  \\end{tabular}
  \\label{tab:example}
\\end{table}`;

// Image template
const imageTemplate = `\\begin{figure}[htbp]
  \\centering
  \\includegraphics[width=0.8\\textwidth]{image.png}
  \\caption{Figure caption}
  \\label{fig:example}
\\end{figure}`;

export function EditorToolbar({
  editorView,
  className,
  onOpenReferenceSearch,
  isConnected = true,
  isTapLoading = false,
  tapError = null,
}: EditorToolbarProps) {
  const { t } = useTranslations("editor");

  // Paragraph style options
  const paragraphStyles = [
    { label: t("toolbar.normalText"), value: "", latex: "" },
    { label: t("toolbar.section"), value: "section", latex: "\\section{" },
    { label: t("toolbar.subsection"), value: "subsection", latex: "\\subsection{" },
    { label: t("toolbar.subsubsection"), value: "subsubsection", latex: "\\subsubsection{" },
    { label: t("toolbar.paragraph"), value: "paragraph", latex: "\\paragraph{" },
  ];

  // Wrap selected text
  const wrapSelection = useCallback(
    (prefix: string, suffix: string) => {
      if (!editorView) return;
      const { from, to } = editorView.state.selection.main;
      const text = editorView.state.sliceDoc(from, to);
      editorView.dispatch({
        changes: { from, to, insert: prefix + text + suffix },
        selection: { anchor: from + prefix.length, head: from + prefix.length + text.length },
      });
      editorView.focus();
    },
    [editorView]
  );

  // Insert text
  const insertText = useCallback(
    (text: string, cursorOffset?: number) => {
      if (!editorView) return;
      const pos = editorView.state.selection.main.head;
      editorView.dispatch({
        changes: { from: pos, insert: text },
        selection: { anchor: pos + (cursorOffset ?? text.length) },
      });
      editorView.focus();
    },
    [editorView]
  );

  // Insert block content (insert on a new line)
  const insertBlock = useCallback(
    (text: string) => {
      if (!editorView) return;
      const pos = editorView.state.selection.main.head;
      const line = editorView.state.doc.lineAt(pos);
      // Insert newline(s) and content at the end of the current line
      const insertPos = line.to;
      const insertContent = (line.text.trim() === "" ? "" : "\n\n") + text + "\n";
      editorView.dispatch({
        changes: { from: insertPos, insert: insertContent },
        selection: { anchor: insertPos + insertContent.length },
      });
      editorView.focus();
    },
    [editorView]
  );

  // Undo
  const handleUndo = useCallback(() => {
    if (editorView) {
      undo(editorView);
      editorView.focus();
    }
  }, [editorView]);

  // Redo
  const handleRedo = useCallback(() => {
    if (editorView) {
      redo(editorView);
      editorView.focus();
    }
  }, [editorView]);

  // Formatting: bold
  const handleBold = useCallback(() => {
    wrapSelection("\\textbf{", "}");
  }, [wrapSelection]);

  // Formatting: italic
  const handleItalic = useCallback(() => {
    wrapSelection("\\textit{", "}");
  }, [wrapSelection]);

  // Formatting: underline
  const handleUnderline = useCallback(() => {
    wrapSelection("\\underline{", "}");
  }, [wrapSelection]);

  // Insert unordered list
  const handleUnorderedList = useCallback(() => {
    insertBlock(`\\begin{itemize}
  \\item Item 1
  \\item Item 2
  \\item Item 3
\\end{itemize}`);
  }, [insertBlock]);

  // Insert ordered list
  const handleOrderedList = useCallback(() => {
    insertBlock(`\\begin{enumerate}
  \\item Item 1
  \\item Item 2
  \\item Item 3
\\end{enumerate}`);
  }, [insertBlock]);

  // Insert table
  const handleTable = useCallback(() => {
    insertBlock(tableTemplate);
  }, [insertBlock]);

  // Insert link
  const handleLink = useCallback(() => {
    wrapSelection("\\href{url}{", "}");
  }, [wrapSelection]);

  // Insert citation
  const handleCite = useCallback(() => {
    insertText("\\cite{}", 6);
  }, [insertText]);

  // Insert cross-reference
  const handleRef = useCallback(() => {
    insertText("\\ref{}", 5);
  }, [insertText]);

  // Insert image
  const handleImage = useCallback(() => {
    insertBlock(imageTemplate);
  }, [insertBlock]);

  // Insert paragraph style
  const handleParagraphStyle = useCallback(
    (style: typeof paragraphStyles[0]) => {
      if (!style.latex) return;
      wrapSelection(style.latex, "}");
    },
    [wrapSelection]
  );

  // Insert symbol
  const handleSymbol = useCallback(
    (symbol: string) => {
      insertText(symbol);
    },
    [insertText]
  );

  // Open reference search (delay to allow DropdownMenu close animation to finish)
  const handleOpenReferenceSearch = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        onOpenReferenceSearch?.();
      });
    });
  }, [onOpenReferenceSearch]);

  const disabled = !editorView;

  // Responsive overflow detection - detect actually clipped elements
  const toolbarRef = useRef<HTMLDivElement>(null);
  const leftToolsRef = useRef<HTMLDivElement>(null);
  const groupRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [hiddenGroups, setHiddenGroups] = useState<Set<number>>(new Set());

  // Detect actual overflow (elements are clipped)
  useEffect(() => {
    const checkOverflow = () => {
      if (!leftToolsRef.current) return;

      const containerRect = leftToolsRef.current.getBoundingClientRect();
      const newHiddenGroups = new Set<number>();

      // Check whether each tool group is clipped
      groupRefs.current.forEach((groupEl, index) => {
        if (!groupEl) return;
        const groupRect = groupEl.getBoundingClientRect();
        // If a group's right edge exceeds the container's right edge, treat it as clipped
        if (groupRect.right > containerRect.right + 2) { // +2 tolerance
          newHiddenGroups.add(index);
        }
      });

      setHiddenGroups(newHiddenGroups);
    };

    // Initial check (delayed to allow layout to settle)
    const timer = setTimeout(checkOverflow, 100);

    // Watch container size changes
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(checkOverflow);
    });
    if (leftToolsRef.current) {
      resizeObserver.observe(leftToolsRef.current);
    }
    if (toolbarRef.current) {
      resizeObserver.observe(toolbarRef.current);
    }

    return () => {
      clearTimeout(timer);
      resizeObserver.disconnect();
    };
  }, []);

  // Set tool group ref
  const setGroupRef = (index: number) => (el: HTMLDivElement | null) => {
    groupRefs.current[index] = el;
  };

  // Whether to show the "More" button
  const showOverflow = hiddenGroups.size > 0;

  // Whether a tool group is in the overflow menu
  const isInOverflow = (groupIndex: number) => hiddenGroups.has(groupIndex);

  return (
    <div
      ref={toolbarRef}
      className={cn(
        "relative z-10 flex items-center justify-between gap-0.5 px-2 py-1 border-b border-border/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm",
        className
      )}
    >
      {/* Left: formatting tools - natural overflow; clipped groups go into the More menu */}
      <div ref={leftToolsRef} className="flex items-center gap-0.5 min-w-0 overflow-hidden flex-1">
        {/* Undo/redo - Group 0 */}
        <div ref={setGroupRef(0)} className="flex items-center flex-shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleUndo}
                disabled={disabled}
              >
                <Undo2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("toolbar.undoShortcut")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleRedo}
                disabled={disabled}
              >
                <Redo2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("toolbar.redoShortcut")}</TooltipContent>
          </Tooltip>
          <Separator orientation="vertical" className="mx-1 h-6" />
        </div>

        {/* Paragraph styles - Group 1 */}
        <div ref={setGroupRef(1)} className="flex items-center flex-shrink-0">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1 px-2"
                    disabled={disabled}
                  >
                    <span className="text-xs">{t("toolbar.normalText")}</span>
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("toolbar.paragraphStyle")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start">
              {paragraphStyles.map((style) => (
                <DropdownMenuItem
                  key={style.value || "normal"}
                  onClick={() => handleParagraphStyle(style)}
                >
                  {style.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Separator orientation="vertical" className="mx-1 h-6" />
        </div>

        {/* Text formatting - Group 2 */}
        <div ref={setGroupRef(2)} className="flex items-center flex-shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleBold}
                disabled={disabled}
              >
                <Bold className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("toolbar.boldTooltip")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleItalic}
                disabled={disabled}
              >
                <Italic className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("toolbar.italicTooltip")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleUnderline}
                disabled={disabled}
              >
                <Underline className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("toolbar.underlineTooltip")}</TooltipContent>
          </Tooltip>
          <Separator orientation="vertical" className="mx-1 h-6" />
        </div>

        {/* Lists - Group 3 */}
        <div ref={setGroupRef(3)} className="flex items-center flex-shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleUnorderedList}
                disabled={disabled}
              >
                <List className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("toolbar.unorderedListTooltip")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleOrderedList}
                disabled={disabled}
              >
                <ListOrdered className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("toolbar.orderedListTooltip")}</TooltipContent>
          </Tooltip>
          <Separator orientation="vertical" className="mx-1 h-6" />
        </div>

        {/* Math symbols - Group 4 */}
        <div ref={setGroupRef(4)} className="flex items-center flex-shrink-0">
          <SymbolPicker onSelect={handleSymbol} disabled={disabled} />
          <Separator orientation="vertical" className="mx-1 h-6" />
        </div>

        {/* Table - Group 5 */}
        <div ref={setGroupRef(5)} className="flex items-center flex-shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleTable}
                disabled={disabled}
              >
                <Table className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("toolbar.insertTable")}</TooltipContent>
          </Tooltip>
          <Separator orientation="vertical" className="mx-1 h-6" />
        </div>

        {/* Links and citations - Group 6 */}
        <div ref={setGroupRef(6)} className="flex items-center flex-shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleLink}
                disabled={disabled}
              >
                <Link className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("toolbar.hyperlinkTooltip")}</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={disabled}
                  >
                    <Quote className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("toolbar.citation")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={handleCite}>
                {t("toolbar.citationRef")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleOpenReferenceSearch} disabled={!onOpenReferenceSearch}>
                <BookMarked className="h-4 w-4 mr-2" />
                {t("toolbar.searchReferences")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleRef}>
                {t("toolbar.crossRef")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Separator orientation="vertical" className="mx-1 h-6" />
        </div>

        {/* Image - Group 7 */}
        <div ref={setGroupRef(7)} className="flex items-center flex-shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleImage}
                disabled={disabled}
              >
                <Image className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("toolbar.insertImage")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* More button - overflow menu */}
        {showOverflow && (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 flex-shrink-0"
                    disabled={disabled}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("toolbar.more")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-48">
              {/* Undo/redo */}
              {isInOverflow(0) && (
                <>
                  <DropdownMenuItem onClick={handleUndo}>
                    <Undo2 className="h-4 w-4 mr-2" />
                    {t("toolbar.undoShortcut")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleRedo}>
                    <Redo2 className="h-4 w-4 mr-2" />
                    {t("toolbar.redoShortcut")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}

              {/* Paragraph styles */}
              {isInOverflow(1) && (
                <>
                  <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                    {t("toolbar.paragraphStyle")}
                  </DropdownMenuItem>
                  {paragraphStyles.slice(1).map((style) => (
                    <DropdownMenuItem
                      key={style.value}
                      onClick={() => handleParagraphStyle(style)}
                    >
                      {style.label}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                </>
              )}

              {/* Text formatting */}
              {isInOverflow(2) && (
                <>
                  <DropdownMenuItem onClick={handleBold}>
                    <Bold className="h-4 w-4 mr-2" />
                    {t("toolbar.boldTooltip")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleItalic}>
                    <Italic className="h-4 w-4 mr-2" />
                    {t("toolbar.italicTooltip")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleUnderline}>
                    <Underline className="h-4 w-4 mr-2" />
                    {t("toolbar.underlineTooltip")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}

              {/* Lists */}
              {isInOverflow(3) && (
                <>
                  <DropdownMenuItem onClick={handleUnorderedList}>
                    <List className="h-4 w-4 mr-2" />
                    {t("toolbar.unorderedListTooltip")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleOrderedList}>
                    <ListOrdered className="h-4 w-4 mr-2" />
                    {t("toolbar.orderedListTooltip")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}

              {/* Table */}
              {isInOverflow(5) && (
                <>
                  <DropdownMenuItem onClick={handleTable}>
                    <Table className="h-4 w-4 mr-2" />
                    {t("toolbar.insertTable")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}

              {/* Links and citations */}
              {isInOverflow(6) && (
                <>
                  <DropdownMenuItem onClick={handleLink}>
                    <Link className="h-4 w-4 mr-2" />
                    {t("toolbar.hyperlinkTooltip")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleCite}>
                    <Quote className="h-4 w-4 mr-2" />
                    {t("toolbar.citationRef")}
                  </DropdownMenuItem>
                  {onOpenReferenceSearch && (
                    <DropdownMenuItem onClick={handleOpenReferenceSearch}>
                      <BookMarked className="h-4 w-4 mr-2" />
                      {t("toolbar.searchReferences")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={handleRef}>
                    {t("toolbar.crossRef")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}

              {/* Image */}
              {isInOverflow(7) && (
                <DropdownMenuItem onClick={handleImage}>
                  <Image className="h-4 w-4 mr-2" />
                  {t("toolbar.insertImage")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

      {/* Right: connection status */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* TAP completion status */}
        {isTapLoading && (
          <span className="text-xs text-litewrite-cyan animate-pulse">
            {t("tap.loading")}
          </span>
        )}
        {tapError && (
          <span className="text-xs text-red-500" title={tapError}>
            {t("tap.error")}
          </span>
        )}
        {/* Connection status indicator */}
        <div className="flex items-center gap-1.5">
          <div
            className={`h-2 w-2 rounded-full ${
              isConnected ? "bg-litewrite-teal" : "bg-amber-500 animate-pulse"
            }`}
          />
          <span className="text-xs text-muted-foreground" style={{ whiteSpace: "nowrap" }}>
            {isConnected ? t("collaboration.connected") : t("collaboration.connecting")}
          </span>
        </div>
      </div>
    </div>
  );
}
