"use client";

import React, { useState, useRef, useCallback, useEffect, useMemo, memo } from "react";
import { ChevronDown, ChevronRight, Search, FileText, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/lib/i18n";
import { sanitizeSvg } from "@/lib/sanitize";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import "katex/dist/katex.min.css";
import { useResearchTaskStore, type ProcessStep as StoreProcessStep } from "@/stores/research-task-store";

// ==================== Debounce Hook ====================
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

// ==================== Type definitions ====================

interface ResearchEvent {
  type: string;
  message: string;
  data?: Record<string, unknown>;
}

interface ProcessStep {
  id: string;
  type: string;
  message: string;
  timestamp: Date;
  data?: Record<string, unknown>;
  isActive?: boolean;
}

interface DeepResearchPanelProps {
  query: string;
  taskId?: string | null;
  existingReport?: {
    report: string;
    bibtex: string;
    references: string;
    processSteps?: Array<{
      id: string;
      type: string;
      message: string;
      timestamp: string | Date;
      data?: Record<string, unknown>;
    }>;
  } | null;
  onError?: (error: string) => void;
}

// ==================== Mermaid rendering ====================

/**
 * Check whether Mermaid code is complete (basic structural validation).
 * During streaming rendering, incomplete code can cause syntax errors.
 */
function isMermaidCodeComplete(code: string): boolean {
  const trimmed = code.trim();
  if (!trimmed) return false;

  // Detect common Mermaid diagram type headers
  const diagramTypes = [
    'graph', 'flowchart', 'sequenceDiagram', 'classDiagram',
    'stateDiagram', 'erDiagram', 'journey', 'gantt', 'pie',
    'gitGraph', 'mindmap', 'timeline', 'quadrantChart',
    'sankey', 'xychart', 'block'
  ];

  const hasValidStart = diagramTypes.some(type =>
    trimmed.toLowerCase().startsWith(type.toLowerCase())
  );

  if (!hasValidStart) return false;

  // Check basic structure (must contain at least some content)
  const lines = trimmed.split('\n').filter(l => l.trim());
  if (lines.length < 2) return false;

  // Check for likely truncation (ends with common incomplete patterns)
  const lastLine = lines[lines.length - 1].trim();
  const incompletePatterns = [
    /\[$/, // Unclosed square bracket
    /\($/, // Unclosed parenthesis
    /\{$/, // Unclosed curly brace
    /-->$/, // Arrow without a target
    /---$/, // Incomplete connector
    /:$/, // Colon with no content after it
    /\|$/, // Incomplete pipe
  ];

  if (incompletePatterns.some(p => p.test(lastLine))) {
    return false;
  }

  return true;
}

// Mermaid init flag (initialize once globally)
let mermaidInitialized = false;

function MermaidBlock({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [renderFailed, setRenderFailed] = useState(false);

  useEffect(() => {
    const renderMermaid = async () => {
      // Check completeness first
      if (!isMermaidCodeComplete(code)) {
        setSvg("");
        setRenderFailed(false);
        return;
      }

      try {
        // Dynamically load mermaid
        const mermaid = (await import("mermaid")).default;

        // Initialize once
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            theme: "neutral",
            securityLevel: "loose",
            suppressErrorRendering: true,  // Prevent error rendering into the DOM
          });
          mermaidInitialized = true;
        }

        const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
        const { svg } = await mermaid.render(id, code);
        setSvg(svg);
        setRenderFailed(false);
      } catch {
        // Don't show any errors; keep the loading state.
        // Once the code is complete, it will re-render automatically.
        setSvg("");
        setRenderFailed(true);

        // Cleanup any error elements Mermaid may have inserted
        setTimeout(() => {
          document.querySelectorAll('svg[aria-roledescription="error"]').forEach(el => el.remove());
          document.querySelectorAll('#d').forEach(el => el.remove());
        }, 0);
      }
    };

    if (code.trim()) {
      renderMermaid();
    }
  }, [code]);

  // Render succeeded: show the diagram
  if (svg) {
    return (
      <div
        ref={containerRef}
        className="my-4 flex justify-center overflow-x-auto"
        dangerouslySetInnerHTML={{ __html: sanitizeSvg(svg) }}
      />
    );
  }

  // Not rendered yet (incomplete code or render failed): show loading
  return (
    <div className="flex items-center justify-center p-4 text-muted-foreground bg-muted/30 rounded-lg my-4">
      <Loader2 className="h-4 w-4 animate-spin mr-2" />
      <span className="text-xs">{renderFailed ? "Rendering diagram..." : "Generating diagram..."}</span>
    </div>
  );
}

// ==================== Optimized Markdown rendering ====================

interface MemoizedMarkdownProps {
  content: string;
  components: any;
  withMath?: boolean;
}

// KaTeX options - lifted to module scope to avoid recreating
const KATEX_OPTIONS = {
  strict: false, // Disable strict mode to reduce error-check overhead
  trust: true,   // Trust input to reduce security-check overhead
  throwOnError: false, // Don't throw; render raw LaTeX on errors
  macros: {}, // Predefined macros (add as needed)
};

const REMARK_PLUGINS_WITH_MATH = [remarkGfm, remarkMath];
const REMARK_PLUGINS_WITHOUT_MATH = [remarkGfm];
const REHYPE_PLUGINS_WITH_MATH = [[rehypeKatex, KATEX_OPTIONS], rehypeRaw];
const REHYPE_PLUGINS_WITHOUT_MATH: any[] = [];

// Single-section Markdown rendering - memoized to avoid re-rendering
const MarkdownSection = memo(function MarkdownSection({
  content,
  components,
  withMath = false,
  sectionIndex
}: MemoizedMarkdownProps & { sectionIndex: number }) {
  return (
    <div key={sectionIndex} className="markdown-section">
      <ReactMarkdown
        remarkPlugins={withMath ? REMARK_PLUGINS_WITH_MATH : REMARK_PLUGINS_WITHOUT_MATH}
        rehypePlugins={(withMath ? REHYPE_PLUGINS_WITH_MATH : REHYPE_PLUGINS_WITHOUT_MATH) as any}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}, (prevProps, nextProps) => {
  // Only re-render when content changes
  return prevProps.content === nextProps.content;
});

// Split long content into sections based on Markdown headings
function splitContentIntoSections(content: string): string[] {
  if (!content || content.length < 5000) {
    // Short content: no need to split
    return [content];
  }

  // Split by H1/H2 headings (# or ##)
  const sections: string[] = [];
  const lines = content.split('\n');
  let currentSection = '';

  for (const line of lines) {
    // Detect heading lines (# or ##, but not inside code blocks)
    if (/^#{1,2}\s/.test(line) && currentSection.trim()) {
      sections.push(currentSection);
      currentSection = line + '\n';
    } else {
      currentSection += line + '\n';
    }
  }

  // Add the last section
  if (currentSection.trim()) {
    sections.push(currentSection);
  }

  return sections.length > 0 ? sections : [content];
}

// Use React.memo to avoid unnecessary re-renders - sectioned version
const MemoizedMarkdown = memo(function MemoizedMarkdown({
  content,
  components,
  withMath = false
}: MemoizedMarkdownProps) {
  // Split content into sections
  const sections = useMemo(() => splitContentIntoSections(content), [content]);

  // Single section: render directly
  if (sections.length <= 1) {
    return (
      <ReactMarkdown
        remarkPlugins={withMath ? REMARK_PLUGINS_WITH_MATH : REMARK_PLUGINS_WITHOUT_MATH}
        rehypePlugins={(withMath ? REHYPE_PLUGINS_WITH_MATH : REHYPE_PLUGINS_WITHOUT_MATH) as any}
        components={components}
      >
        {content}
      </ReactMarkdown>
    );
  }

  // Multiple sections: render separately, each section memoized
  return (
    <>
      {sections.map((section, index) => (
        <MarkdownSection
          key={index}
          content={section}
          components={components}
          withMath={withMath}
          sectionIndex={index}
        />
      ))}
    </>
  );
}, (prevProps, nextProps) => {
  // Custom comparator: re-render only when content actually changes
  return prevProps.content === nextProps.content &&
         prevProps.withMath === nextProps.withMath;
});

// ==================== Event formatting ====================

function formatEventMessage(event: ResearchEvent): string {
  const { type, message, data } = event;

  switch (type) {
    case "progress":
      return message;

    case "iteration":
      return `Round ${data?.iteration}: ${message}`;

    case "search_start":
      return `Searching: ${data?.query || message}`;

    case "search_result": {
      const arxiv = data?.arxiv_count || 0;
      const web = data?.web_count || 0;
      return `Found ${arxiv} papers, ${web} web pages`;
    }

    case "analysis":
      return message;

    case "outline_start":
      return "Planning report structure...";

    case "outline_done": {
      const sections = (data?.outline as { sections?: unknown[] })?.sections?.length || 0;
      return `Outline ready: ${sections} sections`;
    }

    case "section_start":
      return `Writing: ${data?.title || message}`;

    case "section_done":
      return `Completed: ${data?.section || message}`;

    case "report_start":
      return "Generating report...";

    case "report_done":
      return "Report generated";

    case "done":
      return "Research complete";

    case "error":
      return `Error: ${message}`;

    default:
      return message || type;
  }
}

// ==================== Main component ====================

export function DeepResearchPanel({
  query,
  taskId,
  existingReport,
  onError,
}: DeepResearchPanelProps) {
  // i18n
  const { t } = useTranslations("aiChat");

  // Get task state from the store
  const task = useResearchTaskStore((state) => taskId ? state.tasks[taskId] : undefined);

  // State - prefer data from the store
  const [isProcessCollapsed, setIsProcessCollapsed] = useState(!!existingReport);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);

  // Derived display state - from store or existingReport
  const isRunning = task?.status === 'running';
  const isViewingExisting = !!existingReport && !taskId;

  // Get content from task or existingReport
  const rawReportContent = useMemo(() => {
    if (task) return task.reportContent;
    if (existingReport) return existingReport.report;
    return "";
  }, [task, existingReport]);

  // Debounce to reduce render frequency (during streaming: update every 300ms to reduce KaTeX pressure)
  const reportContent = useDebounce(rawReportContent, isRunning ? 300 : 0);

  const bibtex = useMemo(() => {
    if (task) return task.bibtex;
    if (existingReport) return existingReport.bibtex;
    return "";
  }, [task, existingReport]);

  const references = useMemo(() => {
    if (task) return task.references;
    if (existingReport) return existingReport.references;
    return "";
  }, [task, existingReport]);

  const error = task?.error || null;

  // Convert store processSteps or existingReport processSteps to local format
  const processSteps: ProcessStep[] = useMemo(() => {
    // Prefer task.processSteps
    if (task) {
      return task.processSteps.map((step: StoreProcessStep) => ({
        id: step.id,
        type: step.type,
        message: step.message,
        timestamp: step.timestamp,
        data: step.data,
      }));
    }
    // When viewing a saved report, use existingReport.processSteps
    if (existingReport?.processSteps) {
      return existingReport.processSteps.map(step => ({
        id: step.id,
        type: step.type,
        message: step.message,
        timestamp: typeof step.timestamp === 'string' ? new Date(step.timestamp) : step.timestamp,
        data: step.data,
      }));
    }
    return [];
  }, [task, existingReport]);

  // Refs
  const processRef = useRef<HTMLDivElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  // DEEP_RESEARCH_COMPLETE tracking ref - used to detect status changes
  const prevStatusRef = useRef<string | null>(null);

  // Auto-scroll to bottom
  const scrollToBottom = useCallback((ref: React.RefObject<HTMLDivElement | null>) => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, []);

  // Cancel research - via store
  const abortTask = useResearchTaskStore((state) => state.abortTask);
  const cancelResearch = useCallback(() => {
    if (taskId) {
      abortTask(taskId);
    }
  }, [taskId, abortTask]);

  // Call onError when the task fails
  useEffect(() => {
    if (task?.status === 'error' && task.error && onError) {
      onError(task.error);
    }
  }, [task?.status, task?.error, onError]);

  // Auto-collapse the process after completion
  useEffect(() => {
    const currentStatus = task?.status;

    if (currentStatus === 'completed' && !error) {
      setIsProcessCollapsed(true);
    }

    prevStatusRef.current = currentStatus ?? null;
  }, [task?.status, error, task?.projectId, task?.createdAt]);

  // Auto-scroll
  useEffect(() => {
    if (!isProcessCollapsed) {
      scrollToBottom(processRef);
    }
  }, [processSteps, isProcessCollapsed, scrollToBottom]);

  useEffect(() => {
    scrollToBottom(reportRef);
  }, [reportContent, scrollToBottom]);

  // Markdown component config - memoized to avoid unnecessary recreation
  const markdownComponents = useMemo(() => ({
    // Mermaid code blocks
    code: ({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) => {
      const match = /language-(\w+)/.exec(className || "");
      const lang = match ? match[1] : "";
      const codeContent = String(children).replace(/\n$/, "");

      if (lang === "mermaid") {
        return <MermaidBlock code={codeContent} />;
      }

      // Regular code blocks
      if (className) {
        return (
          <code className={cn(className, "block overflow-x-auto text-xs")} {...props}>
            {children}
          </code>
        );
      }

      // Inline code
      return (
        <code className="bg-muted px-1 py-0.5 rounded text-xs" {...props}>
          {children}
        </code>
      );
    },
    // Tables
    table: ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
      <div className="my-3 w-full overflow-x-auto">
        <table className="w-full border-collapse text-sm" {...props}>
          {children}
        </table>
      </div>
    ),
    th: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
      <th className="border border-border bg-muted px-3 py-1.5 text-left text-xs font-medium" {...props}>
        {children}
      </th>
    ),
    td: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
      <td className="border border-border px-3 py-1.5 text-sm" {...props}>
        {children}
      </td>
    ),
    // Links
    a: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 dark:text-blue-400 underline underline-offset-2 hover:opacity-80"
        {...props}
      >
        {children}
      </a>
    ),
    // Block quotes
    blockquote: ({ children, ...props }: React.BlockquoteHTMLAttributes<HTMLQuoteElement>) => (
      <blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic text-muted-foreground my-3 text-sm" {...props}>
        {children}
      </blockquote>
    ),
  }), []);

  return (
    <div className="flex flex-col h-full">
      {/* User query display */}
      <div className="px-4 py-3 border-b border-border bg-muted/30">
        <div className="text-xs text-muted-foreground mb-1">Research Query</div>
        <div className="text-sm font-medium">{query}</div>
      </div>

      {/* Research process section */}
      <div className="border-b border-border">
        {/* Collapse header */}
        <button
          className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors"
          onClick={() => setIsProcessCollapsed(!isProcessCollapsed)}
        >
          {isProcessCollapsed ? (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">
            Research Process
          </span>
          {isRunning && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />
          )}
          {!isRunning && processSteps.length > 0 && (
            <span className="text-xs text-muted-foreground ml-auto">
              {processSteps.length} steps
            </span>
          )}
        </button>

        {/* Process content */}
        {!isProcessCollapsed && (
          <div
            ref={processRef}
            className="max-h-64 overflow-y-auto px-3 pb-3"
          >
            {processSteps.length === 0 && !isRunning ? (
              <p className="text-xs text-muted-foreground py-2">
                Starting research...
              </p>
            ) : (
              <div className="space-y-0.5">
                {processSteps.map((step) => (
                  <div
                    key={step.id}
                    className={cn(
                      "flex items-start gap-2 py-1 px-2 rounded transition-all duration-500",
                      step.id === activeStepId && "research-step-active"
                    )}
                  >
                    <StepIndicator type={step.type} isActive={step.id === activeStepId} />
                    <span
                      className={cn(
                        "text-xs leading-relaxed",
                        step.type === "error"
                          ? "text-red-500"
                          : "text-muted-foreground"
                      )}
                    >
                      {step.message}
                    </span>
                  </div>
                ))}
                {isRunning && (
                  <div className="flex items-center gap-2 py-1 px-2">
                    <div className="w-3 h-3 flex items-center justify-center">
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Processing...
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="mx-3 my-2 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive">
                {t("errorOccurred")}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {error}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Report section */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {reportContent ? (
          <>
            {/* Report title */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">
                Research Report
              </span>
            </div>

            {/* Report content - rendered with optimized Markdown */}
            <div
              ref={reportRef}
              className="flex-1 overflow-y-auto p-4"
            >
              <article className="prose prose-sm dark:prose-invert max-w-none">
                <MemoizedMarkdown
                  content={reportContent}
                  components={markdownComponents}
                  withMath={true}
                />
              </article>

              {/* References */}
              {references && !isRunning && (
                <div className="mt-6 pt-4 border-t border-border">
                  <article className="prose prose-sm dark:prose-invert max-w-none">
                    <MemoizedMarkdown
                      content={references}
                      components={markdownComponents}
                      withMath={false}
                    />
                  </article>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            {isRunning ? (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-xs">Researching...</span>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center gap-2 text-red-500">
                <span className="text-xs">{error}</span>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">
                Report will appear here
              </span>
            )}
          </div>
        )}
      </div>

      {/* Bottom action bar */}
      {/* Animation styles */}
      <style jsx global>{`
        @keyframes shimmer {
          0% {
            background-position: -200% 0;
          }
          100% {
            background-position: 200% 0;
          }
        }

        .research-step-active {
          background: linear-gradient(
            90deg,
            transparent 0%,
            hsl(var(--primary) / 0.1) 50%,
            transparent 100%
          );
          background-size: 200% 100%;
          animation: shimmer 1.5s ease-in-out;
        }
      `}</style>
    </div>
  );
}

// ==================== Step indicator ====================

function StepIndicator({ type, isActive }: { type: string; isActive?: boolean }) {
  // Return a different indicator based on the type
  const getIndicator = () => {
    switch (type) {
      case "iteration":
        return ">";
      case "search_start":
      case "search_result":
        return "-";
      case "analysis":
        return "*";
      case "outline_start":
      case "outline_done":
        return "#";
      case "section_start":
      case "section_done":
        return "+";
      case "report_start":
      case "report_done":
        return "=";
      case "done":
        return "v";
      case "error":
        return "x";
      default:
        return ".";
    }
  };

  return (
    <span
      className={cn(
        "text-xs font-mono w-3 text-center flex-shrink-0 transition-colors duration-300",
        type === "error"
          ? "text-red-500"
          : isActive
            ? "text-primary"
            : "text-muted-foreground"
      )}
    >
      {getIndicator()}
    </span>
  );
}

export default DeepResearchPanel;
