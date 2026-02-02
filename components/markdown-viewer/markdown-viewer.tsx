"use client";

import { useMemo, useCallback, useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import { visit } from "unist-util-visit";
import type { Root, Element } from "hast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { useTranslations } from "@/lib/i18n";
import { Eye, Copy, Check, FileText, Printer, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { MermaidBlock } from "./mermaid-block";
import { EChartsBlock, isEChartsConfig } from "./echarts-block";
import "katex/dist/katex.min.css";

interface MarkdownViewerProps {
  content: string;
  className?: string;
  projectId?: string;
  onLineClick?: (line: number) => void;
}

/**
 * Check whether a path is relative (not an external URL).
 */
function isRelativePath(src: string): boolean {
  if (!src) return false;
  // External URL or data URL
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:") || src.startsWith("blob:")) {
    return false;
  }
  // Protocol-relative URL (e.g. //cdn.example.com/image.png)
  if (src.startsWith("//")) {
    return false;
  }
  // Absolute path (already an API path)
  if (src.startsWith("/api/")) {
    return false;
  }
  return true;
}

/**
 * Convert an image path to an API path.
 */
function resolveImageSrc(src: string, projectId?: string): string {
  if (!src || !projectId) return src;
  if (!isRelativePath(src)) return src;

  // Remove leading ./ or /
  const cleanPath = src.replace(/^\.?\//, "");
  // URL-encode each path segment to handle special characters (e.g. #, ?, %)
  const encodedPath = cleanPath.split("/").map(segment => encodeURIComponent(segment)).join("/");
  return `/api/projects/${projectId}/assets/${encodedPath}`;
}

/**
 * Rehype plugin to add data-sourcepos attributes to elements.
 * This replaces the deprecated rawSourcePos prop from older react-markdown versions.
 */
function rehypeSourcePos() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.position) {
        const { start, end } = node.position;
        // Format: "startLine:startColumn-endLine:endColumn"
        node.properties = node.properties || {};
        node.properties["data-sourcepos"] = `${start.line}:${start.column}-${end.line}:${end.column}`;
      }
    });
  };
}

export function MarkdownViewer({ content, className, projectId, onLineClick }: MarkdownViewerProps) {
  const { t } = useTranslations("markdown");
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const contentRef = useRef<HTMLElement>(null);

  const handleCopyCode = useCallback((code: string, index: number) => {
    navigator.clipboard.writeText(code);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  }, []);

  // Double-click to jump to the corresponding editor line
  const handleDoubleClick = useCallback((e: MouseEvent) => {
    if (!onLineClick) return;

    // Walk up from the target to find an element with data-sourcepos (provided by rehypeSourcePos)
    let target = e.target as HTMLElement | null;
    while (target && target !== contentRef.current) {
      const sourcePos = target.getAttribute("data-sourcepos");
      if (sourcePos) {
        // Example format: "3:1-5:10"
        const start = sourcePos.split("-")[0];
        const lineText = start.split(":")[0];
        const lineNumber = parseInt(lineText, 10);
        if (!isNaN(lineNumber)) {
          onLineClick(lineNumber);
          return;
        }
      }
      target = target.parentElement;
    }
  }, [onLineClick]);

  // Attach double-click listener
  useEffect(() => {
    const element = contentRef.current;
    if (!element || !onLineClick) return;

    element.addEventListener("dblclick", handleDoubleClick);
    return () => {
      element.removeEventListener("dblclick", handleDoubleClick);
    };
  }, [handleDoubleClick, onLineClick]);

  // PDF download
  const handleDownloadPdf = useCallback(async () => {
    if (!projectId || !content) return;

    setIsDownloading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/export/md-pdf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content,
          filename: "document",
        }),
      });

      if (!response.ok) {
        let message = t("pdfGenerateFailed");
        // The response body can only be consumed once: read as text first, then try JSON.
        const text = await response.text();
        if (text) {
          try {
            const error = JSON.parse(text);
            message = error.error || message;
          } catch {
            // Not JSON; use raw text
            message = text;
          }
        }
        throw new Error(message);
      }

      // Get filename
      const contentDisposition = response.headers.get("Content-Disposition");
      let filename = "document.pdf";
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match) {
          filename = decodeURIComponent(match[1]);
        }
      }

      // Download file
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(t("downloadSuccess"));
    } catch (error) {
      console.error("PDF download error:", error);
      toast.error(error instanceof Error ? error.message : t("pdfDownloadFailed"));
    } finally {
      setIsDownloading(false);
    }
  }, [projectId, content, t]);

  // Code block counter - use useRef to avoid closure issues
  const codeBlockIndexRef = useRef(0);
  // Reset counter on each render
  codeBlockIndexRef.current = 0;

  const components = useMemo(() => ({
    // Custom code block rendering
    pre: ({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) => {
      return (
        <pre {...props} className="relative group">
          {children}
        </pre>
      );
    },
    code: ({ className, children, ...props }: React.HTMLAttributes<HTMLElement> & { inline?: boolean }) => {
      const isInline = !className;

      if (isInline) {
        return (
          <code
            className="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm"
            {...props}
          >
            {children}
          </code>
        );
      }

      const currentIndex = codeBlockIndexRef.current++;
      const codeContent = String(children).replace(/\n$/, "");
      const match = /language-(\w+)/.exec(className || "");
      const language = match ? match[1] : "";

      // Mermaid diagram rendering
      if (language === "mermaid") {
        return <MermaidBlock code={codeContent} />;
      }

      // ECharts chart rendering
      if (language === "echarts" || (language === "json" && isEChartsConfig(codeContent))) {
        return <EChartsBlock code={codeContent} />;
      }

      return (
        <div className="relative group">
          <code className={cn(className, "block overflow-x-auto")} {...props}>
            {children}
          </code>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => handleCopyCode(codeContent, currentIndex)}
          >
            {copiedIndex === currentIndex ? (
              <Check className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      );
    },
    // Custom table styles
    table: ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
      <div className="my-4 w-full overflow-x-auto">
        <table className="w-full border-collapse" {...props}>
          {children}
        </table>
      </div>
    ),
    th: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
      <th
        className="border border-border bg-muted px-4 py-2 text-left font-semibold"
        {...props}
      >
        {children}
      </th>
    ),
    td: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
      <td className="border border-border px-4 py-2" {...props}>
        {children}
      </td>
    ),
    // Custom task list
    li: ({ children, className: liClassName, ...props }: React.HTMLAttributes<HTMLLIElement> & { checked?: boolean }) => {
      const hasCheckbox = typeof children === 'object' &&
        Array.isArray(children) &&
        children.length > 0 &&
        typeof children[0] === 'object' &&
        children[0] !== null &&
        'type' in children[0] &&
        children[0].type === 'input';

      return (
        <li
          className={cn(
            hasCheckbox && "list-none flex items-start gap-2",
            liClassName
          )}
          {...props}
        >
          {children}
        </li>
      );
    },
    // Custom links
    a: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-4 hover:text-primary/80 transition-colors"
        {...props}
      >
        {children}
      </a>
    ),
    // Custom images - support project-relative paths
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    img: ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => (
      <img
        src={resolveImageSrc(src || "", projectId)}
        alt={alt || ""}
        className="max-w-full h-auto rounded-lg my-4"
        loading="lazy"
        {...props}
      />
    ),
    // Custom blockquote
    blockquote: ({ children, ...props }: React.BlockquoteHTMLAttributes<HTMLQuoteElement>) => (
      <blockquote
        className="border-l-4 border-primary pl-4 italic text-muted-foreground my-4"
        {...props}
      >
        {children}
      </blockquote>
    ),
    // Custom horizontal rule
    hr: ({ ...props }: React.HTMLAttributes<HTMLHRElement>) => (
      <hr className="my-8 border-border" {...props} />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [copiedIndex, handleCopyCode, projectId]);

  // Empty state
  if (!content.trim()) {
    return (
      <div className={cn("flex h-full flex-col items-center justify-center p-8 text-center", className)}>
        <div className="mb-4 rounded-full bg-muted p-4">
          <FileText className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="mb-2 text-lg font-medium">{t("empty.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("empty.description")}</p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className={cn("flex h-full flex-col bg-background", className)}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("preview")}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleDownloadPdf}
                  disabled={isDownloading || !projectId}
                >
                  {isDownloading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("downloadPdf")}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1">
          <article
            ref={contentRef}
            className="markdown-body prose prose-slate dark:prose-invert max-w-none p-6"
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeSourcePos, rehypeHighlight, rehypeKatex, rehypeRaw]}
              components={components}
            >
              {content}
            </ReactMarkdown>
          </article>
        </ScrollArea>
      </div>
    </TooltipProvider>
  );
}
