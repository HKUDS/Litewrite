"use client";

import { useState } from "react";
import { FileText, Check, Undo, Redo, Bold, Italic, Underline, List, ListOrdered, Table, Omega, MoreHorizontal, ChevronDown, ChevronUp, ZoomIn, ZoomOut, Download, Heading, Strikethrough, Code, Quote, Image, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/lib/i18n";

// LaTeX syntax highlighting helper
function highlightLatex(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Match LaTeX command: \command
    const cmdMatch = remaining.match(/^(\\[a-zA-Z]+\*?)/);
    if (cmdMatch) {
      parts.push(
        <span key={key++} className="text-[#89b4fa]">
          {cmdMatch[1]}
        </span>
      );
      remaining = remaining.slice(cmdMatch[1].length);
      continue;
    }

    // Match braces: {}
    const braceMatch = remaining.match(/^([{}[\]])/);
    if (braceMatch) {
      parts.push(
        <span key={key++} className="text-[#f9e2af]">
          {braceMatch[1]}
        </span>
      );
      remaining = remaining.slice(1);
      continue;
    }

    // Match math mode: $...$
    const mathMatch = remaining.match(/^(\$[^$]+\$)/);
    if (mathMatch) {
      parts.push(
        <span key={key++} className="text-[#a6e3a1]">
          {mathMatch[1]}
        </span>
      );
      remaining = remaining.slice(mathMatch[1].length);
      continue;
    }

    // Match comment: %
    const commentMatch = remaining.match(/^(%.*)/);
    if (commentMatch) {
      parts.push(
        <span key={key++} className="text-[#6c7086] italic">
          {commentMatch[1]}
        </span>
      );
      remaining = remaining.slice(commentMatch[1].length);
      continue;
    }

    // Plain text
    const textMatch = remaining.match(/^([^\\{}[\]$%]+)/);
    if (textMatch) {
      parts.push(<span key={key++}>{textMatch[1]}</span>);
      remaining = remaining.slice(textMatch[1].length);
      continue;
    }

    // Other characters
    parts.push(<span key={key++}>{remaining[0]}</span>);
    remaining = remaining.slice(1);
  }

  return parts;
}

// Markdown syntax highlighting helper
function highlightMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Match headings: # ## ###
    const headingMatch = remaining.match(/^(#{1,3}\s)/);
    if (headingMatch) {
      parts.push(
        <span key={key++} className="text-[#cba6f7] font-bold">
          {headingMatch[1]}
        </span>
      );
      remaining = remaining.slice(headingMatch[1].length);
      continue;
    }

    // Match bold: **text**
    const boldMatch = remaining.match(/^(\*\*[^*]+\*\*)/);
    if (boldMatch) {
      parts.push(
        <span key={key++} className="text-[#fab387] font-bold">
          {boldMatch[1]}
        </span>
      );
      remaining = remaining.slice(boldMatch[1].length);
      continue;
    }

    // Match italic: *text*
    const italicMatch = remaining.match(/^(\*[^*]+\*)/);
    if (italicMatch) {
      parts.push(
        <span key={key++} className="text-[#a6e3a1] italic">
          {italicMatch[1]}
        </span>
      );
      remaining = remaining.slice(italicMatch[1].length);
      continue;
    }

    // Match list marker: -
    const listMatch = remaining.match(/^(-\s)/);
    if (listMatch) {
      parts.push(
        <span key={key++} className="text-[#89b4fa]">
          {listMatch[1]}
        </span>
      );
      remaining = remaining.slice(listMatch[1].length);
      continue;
    }

    // Plain text
    const textMatch = remaining.match(/^([^#*\-]+)/);
    if (textMatch) {
      parts.push(<span key={key++}>{textMatch[1]}</span>);
      remaining = remaining.slice(textMatch[1].length);
      continue;
    }

    // Other characters
    parts.push(<span key={key++}>{remaining[0]}</span>);
    remaining = remaining.slice(1);
  }

  return parts;
}

// LaTeX code sample
const latexCode = [
  "\\documentclass{article}",
  "",
  "\\usepackage[utf8]{inputenc}",
  "\\usepackage{amsmath}",
  "\\usepackage{graphicx}",
  "",
  "\\title{test}",
  "\\author{Author}",
  "\\date{\\today}",
  "",
  "\\begin{document}",
  "",
  "\\maketitle",
  "",
  "\\section{Introduction}",
  "",
  "Start writing here...",
  "",
  "\\end{document}",
];

// Markdown code sample
const markdownCode = [
  "# Introduction",
  "",
  "This paper presents a novel approach to",
  "**retrieval-augmented generation**.",
  "",
  "## Methodology",
  "",
  "We propose a *lightweight* framework that combines:",
  "",
  "- Graph-based indexing",
  "- Dual-level retrieval",
  "",
  "### Results",
  "",
  "Our experiments show significant improvements:",
];

// LaTeX editor toolbar
function LatexToolbar({ connectedText }: { connectedText: string }) {
  return (
    <div className="flex items-center gap-1 px-3 py-1.5 bg-[#181825] border-b border-[#313244] text-[#cdd6f4]">
      <button aria-label="Undo" className="p-1.5 hover:bg-[#313244] rounded transition-colors">
        <Undo className="h-3.5 w-3.5" />
      </button>
      <button aria-label="Redo" className="p-1.5 hover:bg-[#313244] rounded transition-colors">
        <Redo className="h-3.5 w-3.5" />
      </button>
      <div className="w-px h-4 bg-[#313244] mx-1" />
      <select
        aria-label="Text style"
        className="bg-[#313244] text-xs px-2 py-1 rounded border-none outline-none"
      >
        <option>Normal</option>
      </select>
      <div className="w-px h-4 bg-[#313244] mx-1" />
      <button aria-label="Bold" className="p-1.5 hover:bg-[#313244] rounded transition-colors">
        <Bold className="h-3.5 w-3.5" />
      </button>
      <button aria-label="Italic" className="p-1.5 hover:bg-[#313244] rounded transition-colors">
        <Italic className="h-3.5 w-3.5" />
      </button>
      <button aria-label="Underline" className="p-1.5 hover:bg-[#313244] rounded transition-colors">
        <Underline className="h-3.5 w-3.5" />
      </button>
      <div className="w-px h-4 bg-[#313244] mx-1" />
      <button aria-label="Unordered list" className="p-1.5 hover:bg-[#313244] rounded transition-colors">
        <List className="h-3.5 w-3.5" />
      </button>
      <button aria-label="Ordered list" className="p-1.5 hover:bg-[#313244] rounded transition-colors">
        <ListOrdered className="h-3.5 w-3.5" />
      </button>
      <div className="w-px h-4 bg-[#313244] mx-1" />
      <button aria-label="Math symbols" className="p-1.5 hover:bg-[#313244] rounded transition-colors">
        <Omega className="h-3.5 w-3.5" />
      </button>
      <button aria-label="Insert table" className="p-1.5 hover:bg-[#313244] rounded transition-colors">
        <Table className="h-3.5 w-3.5" />
      </button>
      <button aria-label="More options" className="p-1.5 hover:bg-[#313244] rounded transition-colors">
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      <div className="flex-1" />
      <div className="flex items-center gap-1 text-xs text-[#a6e3a1]">
        <div className="w-2 h-2 rounded-full bg-[#a6e3a1]" />
        <span>{connectedText}</span>
      </div>
    </div>
  );
}

// Markdown editor toolbar
function MarkdownToolbar() {
  return (
    <div className="flex items-center gap-1 px-3 py-1.5 bg-[#181825] border-b border-[#313244] text-[#cdd6f4]">
      <button aria-label="Undo" className="p-1.5 hover:bg-[#313244] rounded transition-colors">
        <Undo className="h-3.5 w-3.5" />
      </button>
      <button aria-label="Redo" className="p-1.5 hover:bg-[#313244] rounded transition-colors">
        <Redo className="h-3.5 w-3.5" />
      </button>
      <div className="w-px h-4 bg-[#313244] mx-1" />
      <select
        aria-label="Heading style"
        className="bg-[#313244] text-xs px-2 py-1 rounded border-none outline-none"
      >
        <option>Heading</option>
      </select>
      <div className="w-px h-4 bg-[#313244] mx-1" />
      <button aria-label="Bold" className="p-1.5 hover:bg-[#313244] rounded transition-colors">
        <Bold className="h-3.5 w-3.5" />
      </button>
      <button aria-label="Italic" className="p-1.5 hover:bg-[#313244] rounded transition-colors">
        <Italic className="h-3.5 w-3.5" />
      </button>
      <button aria-label="Strikethrough" className="p-1.5 hover:bg-[#313244] rounded transition-colors">
        <Strikethrough className="h-3.5 w-3.5" />
      </button>
      <div className="w-px h-4 bg-[#313244] mx-1" />
      <button aria-label="Unordered list" className="p-1.5 hover:bg-[#313244] rounded transition-colors">
        <List className="h-3.5 w-3.5" />
      </button>
      <button aria-label="Ordered list" className="p-1.5 hover:bg-[#313244] rounded transition-colors">
        <ListOrdered className="h-3.5 w-3.5" />
      </button>
      <div className="w-px h-4 bg-[#313244] mx-1" />
      <button aria-label="Quote" className="p-1.5 hover:bg-[#313244] rounded transition-colors">
        <Quote className="h-3.5 w-3.5" />
      </button>
      <button aria-label="Inline code" className="p-1.5 hover:bg-[#313244] rounded transition-colors">
        <Code className="h-3.5 w-3.5" />
      </button>
      <button aria-label="Insert image" className="p-1.5 hover:bg-[#313244] rounded transition-colors">
        <Image className="h-3.5 w-3.5" />
      </button>
      <button aria-label="Insert link" className="p-1.5 hover:bg-[#313244] rounded transition-colors">
        <Link2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// PDF preview toolbar
function PdfToolbar({ compiledText }: { compiledText: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 bg-[#f8fafc] dark:bg-[#1e293b] border-b border-[#e2e8f0] dark:border-[#334155]">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 px-2 py-0.5 bg-[#14b8a6] text-white rounded text-xs font-medium">
          <Check className="h-3 w-3" />
          <span>{compiledText}</span>
        </div>
        <button aria-label="Download" className="p-1 hover:bg-[#e2e8f0] dark:hover:bg-[#334155] rounded transition-colors">
          <Download className="h-3.5 w-3.5 text-[#64748b]" />
        </button>
      </div>
      <div className="flex items-center gap-1">
        <button aria-label="Previous page" className="p-1 hover:bg-[#e2e8f0] dark:hover:bg-[#334155] rounded transition-colors">
          <ChevronUp className="h-3.5 w-3.5 text-[#64748b]" />
        </button>
        <span className="text-xs text-[#64748b] px-2">1 / 1</span>
        <button aria-label="Next page" className="p-1 hover:bg-[#e2e8f0] dark:hover:bg-[#334155] rounded transition-colors">
          <ChevronDown className="h-3.5 w-3.5 text-[#64748b]" />
        </button>
        <div className="w-px h-4 bg-[#e2e8f0] dark:bg-[#334155] mx-1" />
        <button aria-label="Zoom out" className="p-1 hover:bg-[#e2e8f0] dark:hover:bg-[#334155] rounded transition-colors">
          <ZoomOut className="h-3.5 w-3.5 text-[#64748b]" />
        </button>
        <span className="text-xs text-[#64748b] px-1">98%</span>
        <button aria-label="Zoom in" className="p-1 hover:bg-[#e2e8f0] dark:hover:bg-[#334155] rounded transition-colors">
          <ZoomIn className="h-3.5 w-3.5 text-[#64748b]" />
        </button>
      </div>
      <div className="flex items-center gap-1 text-xs text-[#14b8a6]">
        <span>Litewrite</span>
      </div>
    </div>
  );
}

// LaTeX editor card
function LatexEditorCard({ isActive, labelText, connectedText, compiledText, onMouseEnter }: {
  isActive: boolean;
  labelText: string;
  connectedText: string;
  compiledText: string;
  onMouseEnter?: () => void;
}) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      className={cn(
        "absolute w-[880px] rounded-xl shadow-2xl transition-all duration-500",
        "bg-[#1e1e2e] border border-[#313244]",
        isActive
          ? "z-20 scale-100 opacity-100"
          : "z-10 scale-[0.97] opacity-85"
      )}
      style={{
        top: isActive ? "40px" : "70px",
        left: isActive ? "calc(50% - 480px)" : "calc(50% - 500px)",
        transform: isActive
          ? "rotate(-2deg)"
          : "rotate(-1deg)",
      }}
    >
      {/* Floating label - fancy style */}
      <div className="absolute -top-5 left-6 z-50">
        <div className="relative group">
          {/* Glowing background */}
          <div className="absolute inset-0 bg-gradient-to-r from-[#14b8a6] to-[#0ea5e9] rounded-full blur-md opacity-60 group-hover:opacity-80 transition-opacity" />
          {/* Label body */}
          <div className="relative flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-[#14b8a6] to-[#0d9488] text-white rounded-full shadow-xl text-sm font-semibold border border-white/20">
            <FileText className="h-4 w-4 animate-pulse" />
            <span>{labelText}</span>
            <div className="absolute -right-1 -top-1 w-3 h-3 bg-[#a6e3a1] rounded-full animate-ping opacity-75" />
            <div className="absolute -right-1 -top-1 w-3 h-3 bg-[#a6e3a1] rounded-full" />
          </div>
        </div>
      </div>

      <div className="flex h-[520px] rounded-xl overflow-hidden">
        {/* Left: code editor */}
        <div className="w-1/2 flex flex-col border-r border-[#313244]">
          <LatexToolbar connectedText={connectedText} />
          <div className="flex-1 overflow-hidden">
            <div className="p-4 font-mono text-[13px] leading-6 text-[#cdd6f4]">
              {latexCode.map((line, idx) => (
                <div key={idx} className="flex">
                  <span className="w-8 text-right pr-4 text-[#6c7086] select-none flex-shrink-0">
                    {idx + 1}
                  </span>
                  <span className="flex-1 whitespace-pre-wrap">
                    {line ? highlightLatex(line) : "\u00A0"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: PDF preview */}
        <div className="w-1/2 flex flex-col bg-[#f8fafc] dark:bg-[#0f172a]">
          <PdfToolbar compiledText={compiledText} />
          <div className="flex-1 flex items-start justify-center p-6 overflow-auto">
            <div className="bg-white dark:bg-white shadow-lg w-full max-w-[320px] p-8 text-gray-900">
              <h1 className="text-xl font-bold text-center mb-1">test</h1>
              <p className="text-center text-sm text-gray-600 mb-0.5">Author</p>
              <p className="text-center text-sm text-gray-600 mb-6">January 18, 2026</p>

              <h2 className="text-base font-bold mb-3">1 Introduction</h2>
              <p className="text-sm leading-relaxed mb-4">Start writing here...</p>

              <h2 className="text-base font-bold mb-3">2 Methodology</h2>
              <p className="text-sm leading-relaxed">We propose a novel approach...</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Markdown editor card
function MarkdownEditorCard({ isActive, labelText, previewText, onMouseEnter }: {
  isActive: boolean;
  labelText: string;
  previewText: string;
  onMouseEnter?: () => void;
}) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      className={cn(
        "absolute w-[880px] rounded-xl shadow-2xl transition-all duration-500",
        "bg-[#1e1e2e] border border-[#313244]",
        isActive
          ? "z-20 scale-100 opacity-100"
          : "z-10 scale-[0.97] opacity-85"
      )}
      style={{
        top: isActive ? "100px" : "130px",
        left: isActive ? "calc(50% - 400px)" : "calc(50% - 380px)",
        transform: isActive
          ? "rotate(2deg)"
          : "rotate(3deg)",
      }}
    >
      {/* Floating label - fancy style */}
      <div className="absolute -top-5 right-6 z-50">
        <div className="relative group">
          {/* Glowing background */}
          <div className="absolute inset-0 bg-gradient-to-r from-[#8b5cf6] to-[#a855f7] rounded-full blur-md opacity-60 group-hover:opacity-80 transition-opacity" />
          {/* Label body */}
          <div className="relative flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-[#8b5cf6] to-[#7c3aed] text-white rounded-full shadow-xl text-sm font-semibold border border-white/20">
            <FileText className="h-4 w-4 animate-pulse" />
            <span>{labelText}</span>
            <div className="absolute -right-1 -top-1 w-3 h-3 bg-[#c4b5fd] rounded-full animate-ping opacity-75" />
            <div className="absolute -right-1 -top-1 w-3 h-3 bg-[#c4b5fd] rounded-full" />
          </div>
        </div>
      </div>

      <div className="flex h-[500px] rounded-xl overflow-hidden">
        {/* Left: Markdown editor */}
        <div className="w-1/2 flex flex-col border-r border-[#313244]">
          <MarkdownToolbar />
          <div className="flex-1 overflow-hidden">
            <div className="p-4 font-mono text-[13px] leading-6 text-[#cdd6f4]">
              {markdownCode.map((line, idx) => (
                <div key={idx} className="flex">
                  <span className="w-8 text-right pr-4 text-[#6c7086] select-none flex-shrink-0">
                    {idx + 1}
                  </span>
                  <span className="flex-1 whitespace-pre-wrap">
                    {line ? highlightMarkdown(line) : "\u00A0"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Markdown preview */}
        <div className="w-1/2 flex flex-col bg-[#0f172a]">
          {/* Preview header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[#334155]">
            <FileText className="h-3.5 w-3.5 text-[#64748b]" />
            <span className="text-xs font-medium text-[#64748b] uppercase tracking-wider">
              {previewText}
            </span>
          </div>
          <div className="flex-1 p-6 overflow-auto">
            <article className="prose prose-invert prose-sm max-w-none">
              <h1 className="text-xl font-bold text-white mb-4">Introduction</h1>
              <p className="text-[#94a3b8] mb-4">
                This paper presents a novel approach to{" "}
                <strong className="text-white">retrieval-augmented generation</strong>.
              </p>

              <h2 className="text-lg font-semibold text-white mt-6 mb-3">Methodology</h2>
              <p className="text-[#94a3b8] mb-3">
                We propose a <em className="text-[#a6e3a1]">lightweight</em> framework that combines:
              </p>
              <ul className="list-disc list-inside text-[#94a3b8] space-y-1 mb-4">
                <li>Graph-based indexing</li>
                <li>Dual-level retrieval</li>
              </ul>

              <h3 className="text-base font-semibold text-white mt-5 mb-2">Results</h3>
              <p className="text-[#94a3b8]">
                Our experiments show significant improvements:
              </p>
            </article>
          </div>
        </div>
      </div>
    </div>
  );
}

export function EditorShowcase() {
  const [activeEditor, setActiveEditor] = useState<"latex" | "markdown">("latex");
  const { t } = useTranslations("landing.editorShowcase");

  return (
    <section className="relative py-24 overflow-hidden">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        {/* Title area */}
        <div className="mx-auto max-w-2xl text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 mb-6 rounded-full bg-[var(--glass-bg)] backdrop-blur-sm border border-[var(--glass-border)]">
            <FileText className="h-4 w-4 text-litewrite-cyan" />
            <span className="text-sm font-medium text-muted-foreground">{t("badge")}</span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
            {t("titlePrefix")}{" "}
            <span className="text-litewrite-teal-dark">{t("titleLatex")}</span>
            {" "}{t("titleOr")}{" "}
            <span className="text-[#8b5cf6]">{t("titleMarkdown")}</span>
          </h2>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
            {t("description")}
          </p>
        </div>

        {/* Stacked editor showcase area - centered container */}
        <div
          className="relative mx-auto"
          style={{ height: "680px", maxWidth: "1000px" }}
        >
          {/* Markdown editor (bottom layer) */}
          <MarkdownEditorCard
            isActive={activeEditor === "markdown"}
            labelText={t("markdownLabel")}
            previewText={t("markdownPreview")}
            onMouseEnter={() => setActiveEditor("markdown")}
          />

          {/* LaTeX editor (top layer) */}
          <LatexEditorCard
            isActive={activeEditor === "latex"}
            labelText={t("latexLabel")}
            connectedText={t("connected")}
            compiledText={t("compiled")}
            onMouseEnter={() => setActiveEditor("latex")}
          />
        </div>
      </div>
    </section>
  );
}
