"use client";

/**
 * Chat Markdown Renderer
 * ======================
 *
 * A lightweight markdown renderer for chat messages with:
 * - Code syntax highlighting
 * - LaTeX math rendering
 * - Copy code functionality
 * - Cursor-like styling
 */

import { useMemo, useCallback, useState, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkBreaks from "remark-breaks";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import "katex/dist/katex.min.css";

interface ChatMarkdownProps {
  content: string;
  className?: string;
  onCopyCode?: (code: string) => void;
}

// Generate a stable hash from code content for use as key
function hashCode(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

// Separate CodeBlock component to avoid closure issues
interface CodeBlockProps {
  codeClassName?: string;
  children: React.ReactNode;
  language: string;
  isLatex: boolean;
  codeContent: string;
  copiedKey: string | null;
  onCopy: (code: string, key: string) => void;
}

const CodeBlock = memo(function CodeBlock({
  codeClassName,
  children,
  language,
  isLatex,
  codeContent,
  copiedKey,
  onCopy,
}: CodeBlockProps) {
  const codeKey = hashCode(codeContent);

  return (
    <div className="relative">
      {/* Header */}
      <div className={cn(
        "flex items-center justify-between px-3 py-1.5",
        "bg-muted border-b border-border text-xs"
      )}>
        <span className={cn(
          "font-medium uppercase tracking-wider",
          isLatex ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
        )}>
          {language || "code"}
        </span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Copy button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => onCopy(codeContent, codeKey)}
            title="Copy code"
          >
            {copiedKey === codeKey ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
        </div>
      </div>

      {/* Code content */}
      <code
        className={cn(
          codeClassName,
          "block overflow-x-auto p-3 text-[0.8rem] leading-relaxed"
        )}
      >
        {children}
      </code>
    </div>
  );
});

export function ChatMarkdown({
  content,
  className,
  onCopyCode,
}: ChatMarkdownProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopyCode = useCallback((code: string, key: string) => {
    navigator.clipboard.writeText(code);
    setCopiedKey(key);
    onCopyCode?.(code);
    setTimeout(() => setCopiedKey(null), 2000);
  }, [onCopyCode]);

  const components = useMemo(() => ({
    // Code blocks
    pre: ({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) => {
      return (
        <pre
          {...props}
          className={cn(
            "relative group my-3 rounded-lg overflow-hidden",
            "border border-border bg-muted/50"
          )}
        >
          {children}
        </pre>
      );
    },

    code: ({ className: codeClassName, children, ...props }: React.HTMLAttributes<HTMLElement> & { inline?: boolean }) => {
      const isInline = !codeClassName;
      const match = /language-(\w+)/.exec(codeClassName || "");
      const language = match ? match[1] : "";
      const isLatex = language === "latex" || language === "tex";

      if (isInline) {
        return (
          <code
            className="relative rounded bg-muted px-[0.3rem] py-[0.1rem] font-mono text-[0.85em] text-foreground"
            {...props}
          >
            {children}
          </code>
        );
      }

      const codeContent = String(children).replace(/\n$/, "");

      return (
        <CodeBlock
          codeClassName={codeClassName}
          language={language}
          isLatex={isLatex}
          codeContent={codeContent}
          copiedKey={copiedKey}
          onCopy={handleCopyCode}
        >
          {children}
        </CodeBlock>
      );
    },

    // Paragraphs
    p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
      <p className="my-2 leading-relaxed" {...props}>
        {children}
      </p>
    ),

    // Lists
    ul: ({ children, ...props }: React.HTMLAttributes<HTMLUListElement>) => (
      <ul className="my-2 ml-4 list-disc space-y-1" {...props}>
        {children}
      </ul>
    ),

    ol: ({ children, ...props }: React.HTMLAttributes<HTMLOListElement>) => (
      <ol className="my-2 ml-4 list-decimal space-y-1" {...props}>
        {children}
      </ol>
    ),

    li: ({ children, ...props }: React.HTMLAttributes<HTMLLIElement>) => (
      <li className="leading-relaxed" {...props}>
        {children}
      </li>
    ),

    // Headings
    h1: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h1 className="text-xl font-bold mt-4 mb-2" {...props}>{children}</h1>
    ),
    h2: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h2 className="text-lg font-semibold mt-3 mb-2" {...props}>{children}</h2>
    ),
    h3: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h3 className="text-base font-semibold mt-3 mb-1" {...props}>{children}</h3>
    ),

    // Links
    a: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2 hover:text-primary/80"
        {...props}
      >
        {children}
      </a>
    ),

    // Blockquote
    blockquote: ({ children, ...props }: React.BlockquoteHTMLAttributes<HTMLQuoteElement>) => (
      <blockquote
        className="border-l-2 border-primary/50 pl-3 my-2 text-muted-foreground italic"
        {...props}
      >
        {children}
      </blockquote>
    ),

    // Strong/Bold
    strong: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => (
      <strong className="font-semibold" {...props}>{children}</strong>
    ),

    // Emphasis/Italic
    em: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => (
      <em className="italic" {...props}>{children}</em>
    ),

    // Horizontal rule
    hr: ({ ...props }: React.HTMLAttributes<HTMLHRElement>) => (
      <hr className="my-3 border-border" {...props} />
    ),

    // Tables
    table: ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
      <div className="my-3 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm" {...props}>
          {children}
        </table>
      </div>
    ),
    th: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
      <th className="border-b border-border bg-muted px-3 py-2 text-left font-medium" {...props}>
        {children}
      </th>
    ),
    td: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
      <td className="border-b border-border px-3 py-2" {...props}>
        {children}
      </td>
    ),
  }), [copiedKey, handleCopyCode]);

  return (
    <div className={cn("chat-markdown text-sm", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
        rehypePlugins={[rehypeHighlight, rehypeKatex]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default ChatMarkdown;
