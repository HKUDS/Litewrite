"use client";

import { useCallback, useState } from "react";
import { EditorView } from "@codemirror/view";
import { undo, redo } from "@codemirror/commands";
import {
  Undo2,
  Redo2,
  Bold,
  Italic,
  Strikethrough,
  List,
  ListOrdered,
  ListChecks,
  Table,
  Link,
  Quote,
  Image as ImageIcon,
  Code,
  FileCode,
  ChevronDown,
  Minus,
  Sigma,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/lib/i18n";

// Table grid picker component
interface TableGridPickerProps {
  onSelect: (rows: number, cols: number) => void;
  disabled?: boolean;
}

function TableGridPicker({ onSelect, disabled }: TableGridPickerProps) {
  const { t } = useTranslations("editor");
  const [open, setOpen] = useState(false);
  const [hoverRow, setHoverRow] = useState(0);
  const [hoverCol, setHoverCol] = useState(0);
  const maxRows = 8;
  const maxCols = 8;

  const handleSelect = (rows: number, cols: number) => {
    onSelect(rows, cols);
    setOpen(false);
    setHoverRow(0);
    setHoverCol(0);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={disabled}
            >
              <Table className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("markdownToolbar.insertTable")}</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-auto p-2" align="start">
        <div className="flex flex-col gap-2">
          <div className="text-xs text-muted-foreground text-center mb-1">
            {hoverRow > 0 && hoverCol > 0
              ? `${hoverRow} × ${hoverCol} ${t("markdownToolbar.tableSize")}`
              : t("markdownToolbar.selectTableSize")}
          </div>
          <div
            className="grid gap-0.5"
            style={{ gridTemplateColumns: `repeat(${maxCols}, 1fr)` }}
          >
            {Array.from({ length: maxRows * maxCols }).map((_, index) => {
              const row = Math.floor(index / maxCols) + 1;
              const col = (index % maxCols) + 1;
              const isHighlighted = row <= hoverRow && col <= hoverCol;
              return (
                <button
                  key={index}
                  aria-label={`Select ${row} × ${col} table`}
                  className={cn(
                    "w-5 h-5 border rounded-sm transition-colors",
                    isHighlighted
                      ? "bg-primary border-primary"
                      : "bg-muted/50 border-border hover:border-primary/50"
                  )}
                  onMouseEnter={() => {
                    setHoverRow(row);
                    setHoverCol(col);
                  }}
                  onClick={() => handleSelect(row, col)}
                />
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface MarkdownToolbarProps {
  editorView: EditorView | null;
  className?: string;
}

export function MarkdownToolbar({ editorView, className }: MarkdownToolbarProps) {
  const { t } = useTranslations("editor");

  // Get placeholder translations
  const placeholder = {
    listItem: t("markdownToolbar.placeholder.listItem"),
    todoItem: t("markdownToolbar.placeholder.todoItem"),
    doneItem: t("markdownToolbar.placeholder.doneItem"),
    quoteContent: t("markdownToolbar.placeholder.quoteContent"),
    codeContent: t("markdownToolbar.placeholder.codeContent"),
    tableColumn: t("markdownToolbar.placeholder.tableColumn"),
    tableData: t("markdownToolbar.placeholder.tableData"),
    imageAlt: t("markdownToolbar.placeholder.imageAlt"),
  };

  // Heading style options
  const headingStyles = [
    { label: t("markdownToolbar.normalText"), prefix: "", suffix: "" },
    { label: t("markdownToolbar.heading1"), prefix: "# ", suffix: "" },
    { label: t("markdownToolbar.heading2"), prefix: "## ", suffix: "" },
    { label: t("markdownToolbar.heading3"), prefix: "### ", suffix: "" },
    { label: t("markdownToolbar.heading4"), prefix: "#### ", suffix: "" },
    { label: t("markdownToolbar.heading5"), prefix: "##### ", suffix: "" },
    { label: t("markdownToolbar.heading6"), prefix: "###### ", suffix: "" },
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

  // Insert a prefix at the start of the line (for headings, etc.)
  const insertLinePrefix = useCallback(
    (prefix: string) => {
      if (!editorView) return;
      const pos = editorView.state.selection.main.head;
      const line = editorView.state.doc.lineAt(pos);
      // Remove existing heading markers
      let existingContent = line.text;
      const headingMatch = existingContent.match(/^#{1,6}\s*/);
      if (headingMatch) {
        existingContent = existingContent.slice(headingMatch[0].length);
      }
      const newContent = prefix + existingContent;
      editorView.dispatch({
        changes: { from: line.from, to: line.to, insert: newContent },
        selection: { anchor: line.from + newContent.length },
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
    wrapSelection("**", "**");
  }, [wrapSelection]);

  // Formatting: italic
  const handleItalic = useCallback(() => {
    wrapSelection("*", "*");
  }, [wrapSelection]);

  // Formatting: strikethrough
  const handleStrikethrough = useCallback(() => {
    wrapSelection("~~", "~~");
  }, [wrapSelection]);

  // Insert unordered list
  const handleUnorderedList = useCallback(() => {
    insertBlock(`- ${placeholder.listItem} 1
- ${placeholder.listItem} 2
- ${placeholder.listItem} 3`);
  }, [insertBlock, placeholder.listItem]);

  // Insert ordered list
  const handleOrderedList = useCallback(() => {
    insertBlock(`1. ${placeholder.listItem} 1
2. ${placeholder.listItem} 2
3. ${placeholder.listItem} 3`);
  }, [insertBlock, placeholder.listItem]);

  // Insert task list
  const handleTaskList = useCallback(() => {
    insertBlock(`- [ ] ${placeholder.todoItem} 1
- [ ] ${placeholder.todoItem} 2
- [x] ${placeholder.doneItem}`);
  }, [insertBlock, placeholder.todoItem, placeholder.doneItem]);

  // Insert blockquote
  const handleQuote = useCallback(() => {
    insertBlock(`> ${placeholder.quoteContent}`);
  }, [insertBlock, placeholder.quoteContent]);

  // Insert inline code
  const handleInlineCode = useCallback(() => {
    wrapSelection("`", "`");
  }, [wrapSelection]);

  // Insert code block
  const handleCodeBlock = useCallback(() => {
    insertBlock(`\`\`\`language
// ${placeholder.codeContent}
\`\`\``);
  }, [insertBlock, placeholder.codeContent]);

  // Generate table template
  const generateTableTemplate = useCallback((rows: number, cols: number) => {
    const headerRow = "| " + Array(cols).fill(null).map((_, i) => `${placeholder.tableColumn} ${i + 1}`).join(" | ") + " |";
    const separatorRow = "|" + Array(cols).fill("-----").join("|") + "|";
    const dataRows = Array(rows - 1)
      .fill(null)
      .map((_, rowIdx) =>
        "| " + Array(cols).fill(null).map((_, colIdx) => `${placeholder.tableData} ${rowIdx * cols + colIdx + 1}`).join(" | ") + " |"
      )
      .join("\n");
    return `${headerRow}\n${separatorRow}\n${dataRows}`;
  }, [placeholder.tableColumn, placeholder.tableData]);

  // Insert table
  const handleTable = useCallback((rows: number, cols: number) => {
    const tableContent = generateTableTemplate(rows, cols);
    insertBlock(tableContent);
  }, [insertBlock, generateTableTemplate]);

  // Insert link
  const handleLink = useCallback(() => {
    wrapSelection("[", "](url)");
  }, [wrapSelection]);

  // Insert image
  const handleImage = useCallback(() => {
    const imageText = `![${placeholder.imageAlt}](image-url)`;
    insertText(imageText, 2 + placeholder.imageAlt.length);
  }, [insertText, placeholder.imageAlt]);

  // Insert horizontal rule
  const handleHorizontalRule = useCallback(() => {
    insertBlock("---");
  }, [insertBlock]);

  // Insert math (inline)
  const handleInlineMath = useCallback(() => {
    wrapSelection("$", "$");
  }, [wrapSelection]);

  // Insert math (block)
  const handleBlockMath = useCallback(() => {
    insertBlock(`$$
E = mc^2
$$`);
  }, [insertBlock]);

  // Handle heading style
  const handleHeadingStyle = useCallback(
    (style: typeof headingStyles[0]) => {
      insertLinePrefix(style.prefix);
    },
    [insertLinePrefix]
  );

  const disabled = !editorView;

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 px-2 py-1 border-b border-border bg-muted/30",
        className
      )}
    >
      {/* Undo/Redo */}
      <div className="flex items-center">
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
      </div>

      <Separator orientation="vertical" className="mx-1 h-6" />

      {/* Heading styles */}
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
                <span className="text-xs">{t("markdownToolbar.heading")}</span>
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("markdownToolbar.headingStyle")}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start">
          {headingStyles.map((style, index) => (
            <DropdownMenuItem
              key={index}
              onClick={() => handleHeadingStyle(style)}
              className={index === 0 ? "" : `text-${Math.min(index + 1, 6) === 1 ? "2xl" : index === 1 ? "xl" : index === 2 ? "lg" : "base"}`}
            >
              {style.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className="mx-1 h-6" />

      {/* Text formatting */}
      <div className="flex items-center">
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
          <TooltipContent side="bottom">{t("markdownToolbar.boldTooltip")}</TooltipContent>
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
          <TooltipContent side="bottom">{t("markdownToolbar.italicTooltip")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleStrikethrough}
              disabled={disabled}
            >
              <Strikethrough className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("markdownToolbar.strikethroughTooltip")}</TooltipContent>
        </Tooltip>
      </div>

      <Separator orientation="vertical" className="mx-1 h-6" />

      {/* Lists */}
      <div className="flex items-center">
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
          <TooltipContent side="bottom">{t("markdownToolbar.unorderedListTooltip")}</TooltipContent>
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
          <TooltipContent side="bottom">{t("markdownToolbar.orderedListTooltip")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleTaskList}
              disabled={disabled}
            >
              <ListChecks className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("markdownToolbar.taskListTooltip")}</TooltipContent>
        </Tooltip>
      </div>

      <Separator orientation="vertical" className="mx-1 h-6" />

      {/* Quotes and code */}
      <div className="flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleQuote}
              disabled={disabled}
            >
              <Quote className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("markdownToolbar.quoteTooltip")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleInlineCode}
              disabled={disabled}
            >
              <Code className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("markdownToolbar.inlineCodeTooltip")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleCodeBlock}
              disabled={disabled}
            >
              <FileCode className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("markdownToolbar.codeBlockTooltip")}</TooltipContent>
        </Tooltip>
      </div>

      <Separator orientation="vertical" className="mx-1 h-6" />

      {/* Math */}
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
                <Sigma className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("markdownToolbar.mathTooltip")}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={handleInlineMath}>
            {t("markdownToolbar.inlineMath")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleBlockMath}>
            {t("markdownToolbar.blockMath")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className="mx-1 h-6" />

      {/* Table */}
      <TableGridPicker onSelect={handleTable} disabled={disabled} />

      <Separator orientation="vertical" className="mx-1 h-6" />

      {/* Links and images */}
      <div className="flex items-center">
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
          <TooltipContent side="bottom">{t("markdownToolbar.linkTooltip")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleImage}
              disabled={disabled}
            >
              <ImageIcon className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("markdownToolbar.imageTooltip")}</TooltipContent>
        </Tooltip>
      </div>

      <Separator orientation="vertical" className="mx-1 h-6" />

      {/* Horizontal rule */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleHorizontalRule}
            disabled={disabled}
          >
            <Minus className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("markdownToolbar.horizontalRule")}</TooltipContent>
      </Tooltip>
    </div>
  );
}
