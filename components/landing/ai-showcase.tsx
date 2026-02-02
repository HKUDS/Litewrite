"use client";

import { useState, useEffect } from "react";
import { Sparkles, Brain, Bot, ArrowRight, Check, ChevronDown, ChevronRight, Search, FileText, File, Loader2, Undo, Redo, Bold, Italic, Underline, List, ListOrdered, Table, Omega, MoreHorizontal } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useTranslations } from "@/lib/i18n";

// ==================== Shared utilities ====================

// LaTeX syntax highlighting helper
function highlightLatex(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Match LaTeX commands: \command
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
    const braceMatch = remaining.match(/^([{}])/);
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

    // Plain text
    const textMatch = remaining.match(/^([^\\{}$]+)/);
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

// Editor toolbar component
function EditorToolbar({ connected = true, connectedText }: { connected?: boolean; connectedText: string }) {
  return (
    <div className="flex items-center gap-1 px-3 py-1.5 bg-[#181825] border-b border-[#313244] text-[#6c7086]">
      <button aria-label="Undo" className="p-1 hover:bg-[#313244] rounded transition-colors">
        <Undo className="h-3.5 w-3.5" />
      </button>
      <button aria-label="Redo" className="p-1 hover:bg-[#313244] rounded transition-colors">
        <Redo className="h-3.5 w-3.5" />
      </button>
      <div className="w-px h-4 bg-[#313244] mx-1" />
      <select
        aria-label="Text style"
        className="bg-[#313244] text-[10px] text-[#cdd6f4] px-1.5 py-0.5 rounded border-none outline-none"
      >
        <option>Normal</option>
      </select>
      <div className="w-px h-4 bg-[#313244] mx-1" />
      <button aria-label="Bold" className="p-1 hover:bg-[#313244] rounded transition-colors">
        <Bold className="h-3.5 w-3.5" />
      </button>
      <button aria-label="Italic" className="p-1 hover:bg-[#313244] rounded transition-colors">
        <Italic className="h-3.5 w-3.5" />
      </button>
      <button aria-label="Underline" className="p-1 hover:bg-[#313244] rounded transition-colors">
        <Underline className="h-3.5 w-3.5" />
      </button>
      <div className="w-px h-4 bg-[#313244] mx-1" />
      <button aria-label="Bulleted list" className="p-1 hover:bg-[#313244] rounded transition-colors">
        <List className="h-3.5 w-3.5" />
      </button>
      <button aria-label="Numbered list" className="p-1 hover:bg-[#313244] rounded transition-colors">
        <ListOrdered className="h-3.5 w-3.5" />
      </button>
      <div className="w-px h-4 bg-[#313244] mx-1" />
      <button aria-label="Math" className="p-1 hover:bg-[#313244] rounded transition-colors">
        <Omega className="h-3.5 w-3.5" />
      </button>
      <button aria-label="Table" className="p-1 hover:bg-[#313244] rounded transition-colors">
        <Table className="h-3.5 w-3.5" />
      </button>
      <button aria-label="More options" className="p-1 hover:bg-[#313244] rounded transition-colors">
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      <div className="flex-1" />
      {connected && (
        <div className="flex items-center gap-1 text-[10px] text-[#a6e3a1]">
          <div className="w-1.5 h-1.5 rounded-full bg-[#a6e3a1]" />
          <span>{connectedText}</span>
        </div>
      )}
    </div>
  );
}

// ==================== TAP Completion Demo ====================
// Realistic Ghost Text effect, simulating TAP completion in a real editor

function TapCompletionDemo({ toAcceptText, connectedText }: { toAcceptText: string; connectedText: string }) {
  const [showGhost, setShowGhost] = useState(false);
  const [phase, setPhase] = useState<"typing" | "ghost" | "accepted">("typing");
  const [cycle, setCycle] = useState(0);
  const ghostText = " there exists $c \\in (a,b)$ such that $f'(c) = \\frac{f(b) - f(a)}{b - a}$.";

  // Simulate Ghost Text appearing all at once after typing
  useEffect(() => {
    let timer1: NodeJS.Timeout;
    let timer2: NodeJS.Timeout;
    let timer3: NodeJS.Timeout;

    // Phase 1: user is typing (cursor blinking)
    timer1 = setTimeout(() => {
      // Ghost text appears all at once
      setShowGhost(true);
      setPhase("ghost");
    }, 1500);

    // Phase 2: user presses Tab to accept
    timer2 = setTimeout(() => {
      setPhase("accepted");
    }, 4000);

    // Phase 3: reset animation and trigger a new cycle
    timer3 = setTimeout(() => {
      setShowGhost(false);
      setPhase("typing");
      setCycle((c) => c + 1);
    }, 6000);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, [cycle]);

  return (
    <div className="rounded-xl overflow-hidden bg-[#1e1e2e] text-[#cdd6f4] relative shadow-2xl border border-[#313244] h-[420px]">
      {/* Editor toolbar */}
      <EditorToolbar connectedText={connectedText} />

      {/* Editor content */}
      <div className="p-4 font-mono text-[13px] leading-6 overflow-x-auto min-h-[200px]">
        {/* Line 1 */}
        <div className="flex">
          <span className="w-8 text-right pr-4 text-[#6c7086] select-none flex-shrink-0">1</span>
          <span className="flex-1 whitespace-pre-wrap">{highlightLatex("\\begin{theorem}")}</span>
        </div>
        {/* Line 2 - with Ghost Text */}
        <div className="flex">
          <span className="w-8 text-right pr-4 text-[#6c7086] select-none flex-shrink-0">2</span>
          <span className="flex-1 whitespace-pre-wrap">
            {highlightLatex("Let $f$ be a continuous function on $[a,b]$. Then")}
            {/* Ghost Text appears all at once - consistent with tap-completion.ts */}
            {showGhost && phase !== "accepted" && (
              <span className="text-[#9ca3af] opacity-50 pointer-events-none select-none animate-in fade-in duration-150">
                {ghostText}
              </span>
            )}
            {/* After accepting, render as normal text (with syntax highlighting) */}
            {phase === "accepted" && (
              <span className="text-[#cdd6f4]">{highlightLatex(ghostText)}</span>
            )}
            {/* Blinking cursor - thin bar style */}
            {phase === "typing" && (
              <span className="inline-block w-[2px] h-[1em] bg-[#cdd6f4] animate-[blink_1s_step-end_infinite] ml-0.5 align-text-bottom" />
            )}
          </span>
        </div>
        {/* Line 3 */}
        <div className="flex">
          <span className="w-8 text-right pr-4 text-[#6c7086] select-none flex-shrink-0">3</span>
          <span className="flex-1 whitespace-pre-wrap">{highlightLatex("\\end{theorem}")}</span>
        </div>
        {/* Additional context lines */}
        <div className="flex">
          <span className="w-8 text-right pr-4 text-[#6c7086] select-none flex-shrink-0">4</span>
          <span className="flex-1 whitespace-pre-wrap">{"\u00A0"}</span>
        </div>
        <div className="flex">
          <span className="w-8 text-right pr-4 text-[#6c7086] select-none flex-shrink-0">5</span>
          <span className="flex-1 whitespace-pre-wrap">{highlightLatex("\\begin{proof}")}</span>
        </div>
        <div className="flex">
          <span className="w-8 text-right pr-4 text-[#6c7086] select-none flex-shrink-0">6</span>
          <span className="flex-1 whitespace-pre-wrap text-[#6c7086] italic">{"  % Your proof here..."}</span>
        </div>
        <div className="flex">
          <span className="w-8 text-right pr-4 text-[#6c7086] select-none flex-shrink-0">7</span>
          <span className="flex-1 whitespace-pre-wrap">{highlightLatex("\\end{proof}")}</span>
        </div>
      </div>

      {/* Bottom-right hotkey hint - shown when Ghost Text is visible */}
      <div className={cn(
        "absolute bottom-3 right-3 flex items-center gap-2 transition-all duration-300",
        phase === "ghost" ? "opacity-100" : "opacity-0"
      )}>
        <kbd className="px-2 py-1 rounded bg-[#a6e3a1] text-[#1e1e2e] text-[10px] font-medium shadow-sm animate-pulse">
          Tab
        </kbd>
        <span className="text-[10px] text-[#6c7086]">{toAcceptText}</span>
      </div>

      {/* Cursor blink animation */}
      <style jsx global>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ==================== Agent Inline Diff Demo ====================
// Realistic AI Chat + FileEditDiff style, simulating Agent-mode file editing

interface EditBlock {
  original: string[];
  updated: string[];
  lineRange: string;
}

interface AgentDiffTranslations {
  thinking: string;
  editing: string;
  done: string;
  planningEdits: string;
  writingChanges: string;
  applied: string;
}

function AgentDiffDemo({ translations }: { translations: AgentDiffTranslations }) {
  const [phase, setPhase] = useState<"thinking" | "editing" | "complete">("thinking");
  const [visibleBlocks, setVisibleBlocks] = useState(0);
  const [isExpanded, setIsExpanded] = useState(true);
  const [cycle, setCycle] = useState(0);

  // Animation: simulate the Agent workflow
  useEffect(() => {
    let timer1: NodeJS.Timeout;
    let timer2: NodeJS.Timeout;
    let timer3: NodeJS.Timeout;
    let resetTimer: NodeJS.Timeout;

    // Phase 1: Thinking
    timer1 = setTimeout(() => setPhase("editing"), 1500);

    // Phase 2: Show blocks progressively
    timer2 = setTimeout(() => setVisibleBlocks(1), 2000);
    timer3 = setTimeout(() => {
      setVisibleBlocks(2);
      setPhase("complete");
    }, 2800);

    // Reset animation and trigger new cycle
    resetTimer = setTimeout(() => {
      setPhase("thinking");
      setVisibleBlocks(0);
      setIsExpanded(true);
      setCycle((c) => c + 1);
    }, 8000);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      clearTimeout(resetTimer);
    };
  }, [cycle]);

  const editBlocks: EditBlock[] = [
    {
      lineRange: "Lines 3-3",
      original: ["Previous studies have explored this topic."],
      updated: ["Recent advances in neural language models have significantly impacted this field \\cite{vaswani2017attention}."],
    },
    {
      lineRange: "Lines 5-6",
      original: [],
      updated: [
        "Transformer architectures have become the foundation for modern NLP systems.",
        "These models demonstrate remarkable capabilities \\cite{brown2020gpt3}.",
      ],
    },
  ];

  return (
    <div className="rounded-xl overflow-hidden bg-[#1e1e2e] text-[#cdd6f4] shadow-2xl border border-[#313244] h-[420px] flex flex-col">
      {/* AI Chat panel header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#181825] border-b border-[#313244] flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-[#cba6f7]/20">
            <Bot className="h-4 w-4 text-[#cba6f7]" />
          </div>
          <span className="text-xs font-medium text-[#cdd6f4]">Agent</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={cn(
            "w-2 h-2 rounded-full transition-colors",
            phase === "complete" ? "bg-[#a6e3a1]" : "bg-[#cba6f7] animate-pulse"
          )} />
          <span className="text-[10px] text-[#6c7086]">
            {phase === "thinking" ? translations.thinking : phase === "editing" ? translations.editing : translations.done}
          </span>
        </div>
      </div>

      <div className="p-3 space-y-3 flex-1 overflow-y-auto">
        {/* User message bubble - realistic AI Chat styling */}
        <div className="rounded-lg border border-[#313244] bg-[#313244]/30 px-3 py-2">
          <p className="text-xs text-[#cdd6f4]">Improve the Related Work section with recent citations</p>
        </div>

        {/* Agent status indicator */}
        {phase === "thinking" && (
          <div className="flex items-center gap-2 text-xs text-[#6c7086]">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>{translations.planningEdits}</span>
          </div>
        )}

        {/* FileEditDiff-style edit card */}
        {visibleBlocks > 0 && (
          <div className="rounded-lg border border-[#313244] bg-[#313244]/20 overflow-hidden">
            {/* File header - collapsible */}
            <button
              className="flex items-center justify-between w-full px-3 py-2 bg-[#313244]/50 hover:bg-[#313244]/70 transition-colors"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              <div className="flex items-center gap-2 text-xs">
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3 text-[#6c7086]" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-[#6c7086]" />
                )}
                <File className="h-3 w-3 text-[#89b4fa]" />
                <span className="font-medium text-[#cdd6f4]">related.tex</span>
              </div>
              {phase === "complete" && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-[#a6e3a1]/20 text-[#a6e3a1]">
                  <Check className="w-3 h-3" />
                  {translations.applied}
                </span>
              )}
            </button>

            {/* Diff content */}
            {isExpanded && (
              <div className="font-mono text-xs">
                {editBlocks.slice(0, visibleBlocks).map((block, blockIdx) => (
                  <div key={blockIdx} className="border-t border-[#313244]/50">
                    {/* Line-range header */}
                    <div className="flex items-center gap-2 px-3 py-1 bg-[#181825]/50 text-[10px] text-[#6c7086]">
                      <span>{block.lineRange}</span>
                      {block.original.length > 0 && (
                        <span className="text-[#f38ba8]">-{block.original.length}</span>
                      )}
                      <span className="text-[#6c7086]">/</span>
                      <span className="text-[#a6e3a1]">+{block.updated.length}</span>
                    </div>

                    {/* Deleted lines */}
                    {block.original.map((line, i) => (
                      <div key={`del-${i}`} className="flex bg-[#f38ba8]/10">
                        <div className="w-5 flex-shrink-0 text-center text-[#f38ba8]/60 bg-[#f38ba8]/10 select-none">-</div>
                        <div className="flex-1 px-2 text-[#f38ba8]/80 whitespace-pre overflow-x-auto">{line}</div>
                      </div>
                    ))}

                    {/* Added lines */}
                    {block.updated.map((line, i) => (
                      <div key={`add-${i}`} className="flex bg-[#a6e3a1]/10">
                        <div className="w-5 flex-shrink-0 text-center text-[#a6e3a1]/60 bg-[#a6e3a1]/10 select-none">+</div>
                        <div className="flex-1 px-2 text-[#a6e3a1] whitespace-pre overflow-x-auto">{line}</div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Editing indicator */}
        {phase === "editing" && visibleBlocks < 2 && (
          <div className="flex items-center gap-2 text-xs text-[#6c7086]">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>{translations.writingChanges}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== Deep Research Demo ====================
// Realistic DeepResearchPanel style, simulating a deep research experience

interface ResearchStep {
  id: string;
  indicator: string;
  message: string;
  status: "completed" | "active";
}

// Constants moved outside component to avoid recreating on each render
const DEEP_RESEARCH_STEPS: Omit<ResearchStep, "status">[] = [
  { id: "1", indicator: ">", message: "Round 1: Starting research..." },
  { id: "2", indicator: "-", message: "Searching: transformer attention mechanisms" },
  { id: "3", indicator: "-", message: "Found 24 papers, 12 web pages" },
  { id: "4", indicator: "*", message: "Analyzing content relevance..." },
  { id: "5", indicator: "#", message: "Outline ready: 5 sections" },
  { id: "6", indicator: "+", message: "Writing: Introduction" },
  { id: "7", indicator: "+", message: "Writing: Background" },
  { id: "8", indicator: "=", message: "Report generated" },
  { id: "9", indicator: "v", message: "Research complete" },
];

const DEEP_RESEARCH_REPORT = `Transformer Attention Mechanisms

Introduction

Attention mechanisms have fundamentally transformed natural language processing and machine learning. The self-attention mechanism, first introduced in the landmark paper "Attention Is All You Need" (Vaswani et al., 2017), enables models to weigh the importance of different parts of the input sequence.

Background

The key innovation of self-attention is computing attention weights in parallel across all positions. This allows transformers to capture long-range dependencies more effectively than recurrent architectures.`;

interface DeepResearchTranslations {
  running: string;
  complete: string;
  researchQuery: string;
  researchProcess: string;
  steps: string;
  processing: string;
  researchReport: string;
  autoSaved: string;
  researching: string;
}

function DeepResearchDemo({ translations }: { translations: DeepResearchTranslations }) {
  const [steps, setSteps] = useState<ResearchStep[]>([]);
  const [isProcessCollapsed, setIsProcessCollapsed] = useState(false);
  const [isRunning, setIsRunning] = useState(true);
  const [reportContent, setReportContent] = useState("");
  const [isReportTyping, setIsReportTyping] = useState(false);
  const [cycle, setCycle] = useState(0);

  // Animation - simulate a realistic research flow
  useEffect(() => {
    let stepIndex = 0;
    let charIndex = 0;

    const stepInterval = setInterval(() => {
      if (stepIndex < DEEP_RESEARCH_STEPS.length) {
        setSteps((prev) => {
          const updated = prev.map((s) => ({ ...s, status: "completed" as const }));
          return [...updated, { ...DEEP_RESEARCH_STEPS[stepIndex], status: "active" as const }];
        });
        stepIndex++;
      } else {
        clearInterval(stepInterval);
        setIsRunning(false);
        setIsProcessCollapsed(true);
      }
    }, 450);

    // Type out report content progressively
    let reportInterval: NodeJS.Timeout | null = setInterval(() => {
      if (stepIndex > 5 && charIndex < DEEP_RESEARCH_REPORT.length) {
        // Mark typing as started
        if (charIndex === 0) {
          setIsReportTyping(true);
        }
        setReportContent(DEEP_RESEARCH_REPORT.slice(0, charIndex + 3));
        charIndex += 3;
      } else if (charIndex >= DEEP_RESEARCH_REPORT.length && reportInterval) {
        // Once fully shown, clear the interval to avoid leaking resources
        clearInterval(reportInterval);
        reportInterval = null;
        setIsReportTyping(false);
      }
    }, 20);

    // Reset animation and trigger a new cycle
    const resetTimeout = setTimeout(() => {
      setSteps([]);
      setReportContent("");
      setIsProcessCollapsed(false);
      setIsRunning(true);
      setIsReportTyping(false);
      setCycle((c) => c + 1);
    }, 12000);

    return () => {
      clearInterval(stepInterval);
      if (reportInterval) clearInterval(reportInterval);
      clearTimeout(resetTimeout);
    };
  }, [cycle]);

  return (
    <div className="rounded-xl overflow-hidden bg-[#1e1e2e] text-[#cdd6f4] flex flex-col shadow-2xl border border-[#313244] h-[420px]">
      {/* Panel header */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-[#181825] border-b border-[#313244] flex-shrink-0">
        <div className="p-1 rounded-md bg-[#89b4fa]/20">
          <Brain className="h-4 w-4 text-[#89b4fa]" />
        </div>
        <span className="text-xs font-medium text-[#cdd6f4]">Deep Research</span>
        <div className="flex-1" />
        {isRunning && (
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-[#89b4fa] animate-pulse" />
            <span className="text-[10px] text-[#6c7086]">{translations.running}</span>
          </div>
        )}
        {!isRunning && (
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-[#a6e3a1]" />
            <span className="text-[10px] text-[#6c7086]">{translations.complete}</span>
          </div>
        )}
      </div>

      {/* Research query display - realistic DeepResearchPanel styling */}
      <div className="px-4 py-3 border-b border-[#313244] bg-[#181825]/30 flex-shrink-0">
        <div className="text-[10px] text-[#6c7086] mb-1">{translations.researchQuery}</div>
        <div className="text-sm font-medium text-[#cdd6f4]">&quot;Recent advances in transformer architectures&quot;</div>
      </div>

      {/* Collapsible research process - realistic DeepResearchPanel styling */}
      <div className="border-b border-[#313244] flex-shrink-0">
        <button
          className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-[#313244]/30 transition-colors"
          onClick={() => setIsProcessCollapsed(!isProcessCollapsed)}
        >
          {isProcessCollapsed ? (
            <ChevronRight className="h-3.5 w-3.5 text-[#6c7086]" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-[#6c7086]" />
          )}
          <Search className="h-3.5 w-3.5 text-[#6c7086]" />
          <span className="text-xs font-medium text-[#6c7086]">{translations.researchProcess}</span>
          {isRunning && (
            <Loader2 className="h-3 w-3 animate-spin text-[#6c7086] ml-auto" />
          )}
          {!isRunning && steps.length > 0 && (
            <span className="text-xs text-[#6c7086] ml-auto">{steps.length} {translations.steps}</span>
          )}
        </button>

        {!isProcessCollapsed && (
          <div className="px-3 pb-3 max-h-32 overflow-y-auto">
            <div className="space-y-0.5">
              {steps.map((step, idx) => (
                <div
                  key={step.id}
                  className={cn(
                    "flex items-start gap-2 py-1 px-2 rounded transition-all duration-500",
                    step.status === "active" && idx === steps.length - 1 && "bg-[#cba6f7]/10"
                  )}
                >
                  <span className={cn(
                    "text-xs font-mono w-3 text-center flex-shrink-0 transition-colors duration-300",
                    step.status === "active" && idx === steps.length - 1 ? "text-[#cba6f7]" : "text-[#6c7086]"
                  )}>
                    {step.indicator}
                  </span>
                  <span className={cn(
                    "text-xs leading-relaxed",
                    step.status === "active" && idx === steps.length - 1 ? "text-[#cba6f7]" : "text-[#6c7086]"
                  )}>
                    {step.message}
                  </span>
                  {step.status === "completed" && (
                    <Check className="h-3 w-3 text-[#a6e3a1] ml-auto flex-shrink-0" />
                  )}
                  {step.status === "active" && idx === steps.length - 1 && (
                    <div className="h-3 w-3 rounded-full border-2 border-[#cba6f7] border-t-transparent animate-spin ml-auto flex-shrink-0" />
                  )}
                </div>
              ))}
              {isRunning && (
                <div className="flex items-center gap-2 py-1 px-2">
                  <div className="w-3 h-3 flex items-center justify-center">
                    <Loader2 className="h-3 w-3 animate-spin text-[#6c7086]" />
                  </div>
                  <span className="text-xs text-[#6c7086]">{translations.processing}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Report section - prose styling to match the real DeepResearchPanel */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {reportContent ? (
          <>
            {/* Report title bar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[#313244] flex-shrink-0 bg-[#181825]/30">
              <FileText className="h-3.5 w-3.5 text-[#6c7086]" />
              <span className="text-xs font-medium text-[#6c7086]">{translations.researchReport}</span>
              <div className="flex-1" />
              <span className="text-[10px] text-[#6c7086]">{translations.autoSaved}</span>
            </div>

            {/* Report content - uses prose styling */}
            <div className="flex-1 overflow-y-auto p-4 max-h-[200px]">
              <article className="prose prose-sm max-w-none">
                {reportContent.split('\n\n').map((para, idx) => {
                  const text = para.trim();
                  if (!text) return null;

                  // Heading detection
                  if (text === "Transformer Attention Mechanisms") {
                    return <h1 key={idx} className="text-base font-bold text-[#cdd6f4] mb-3 mt-0">{text}</h1>;
                  }
                  if (text === "Introduction" || text === "Background") {
                    return <h2 key={idx} className="text-sm font-semibold text-[#89b4fa] mt-4 mb-2">{text}</h2>;
                  }
                  // Normal paragraph
                  return <p key={idx} className="text-xs text-[#a6adc8] leading-relaxed mb-2">{text}</p>;
                })}
                {isReportTyping && (
                  <span className="inline-block w-1.5 h-3.5 bg-[#89b4fa] animate-pulse ml-0.5 align-text-bottom" />
                )}
              </article>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center min-h-[150px]">
            <div className="flex flex-col items-center gap-2 text-[#6c7086]">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-xs">{translations.researching}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== AI Features config ====================

const aiFeatureConfigs = [
  { id: "tap", icon: Sparkles },
  { id: "research", icon: Brain },
  { id: "agent", icon: Bot },
];

// ==================== Main component ====================

export function AIShowcase() {
  const [activeFeature, setActiveFeature] = useState("tap");
  const { t } = useTranslations("landing.aiShowcase");

  const currentConfig = aiFeatureConfigs.find((f) => f.id === activeFeature)!;
  const Icon = currentConfig.icon;

  return (
    <section id="ai-showcase" className="relative py-24 overflow-hidden">

      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        {/* Title */}
        <div className="mx-auto max-w-2xl text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 mb-6 rounded-full bg-gradient-ai text-white shadow-glow-ai">
            <Sparkles className="h-4 w-4" />
            <span className="text-sm font-medium">{t("badge")}</span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
            <span className="text-gradient-ai">{t("titleAI")}</span> {t("titleRest")}
            <span className="block mt-1">{t("titleLine2")}</span>
          </h2>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
            {t("description")}
          </p>
        </div>

        {/* Feature selector */}
        <div className="flex flex-wrap justify-center gap-4 mb-12">
          {aiFeatureConfigs.map((feature) => (
            <button
              key={feature.id}
              onClick={() => setActiveFeature(feature.id)}
              className={cn(
                "flex items-center gap-3 px-6 py-3 rounded-full transition-all duration-300",
                activeFeature === feature.id
                  ? "bg-gradient-ai text-white shadow-glow-ai"
                  : "bg-[var(--glass-bg)] backdrop-blur-sm border border-[var(--glass-border)] hover:bg-[var(--glass-hover)]"
              )}
            >
              <feature.icon className="h-5 w-5" />
              <span className="font-medium">{t(`${feature.id}.title`)}</span>
            </button>
          ))}
        </div>

        {/* Feature showcase area */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* Left: feature description */}
          <div className="order-2 lg:order-1">
            <GlassCard variant="heavy" padding="lg" className="relative overflow-hidden">
              {/* Decorative gradient */}
              <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-ai-purple/20 to-transparent rounded-full blur-3xl" />

              <div className="relative">
                <div className="inline-flex items-center gap-2 mb-4">
                  <div className="p-2 rounded-xl bg-gradient-ai">
                    <Icon className="h-5 w-5 text-white" />
                  </div>
                  <span className="text-sm font-medium text-muted-foreground">
                    {t(`${activeFeature}.subtitle`)}
                  </span>
                </div>

                <h3 className="text-2xl font-bold mb-4">{t(`${activeFeature}.title`)}</h3>
                <p className="text-muted-foreground mb-6 leading-relaxed">
                  {t(`${activeFeature}.description`)}
                </p>

                {/* Feature highlights */}
                <div className="space-y-3 mb-6">
                  <div className="flex items-center gap-3">
                    <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                    <span className="text-sm text-foreground/80">{t(`${activeFeature}.feature1`)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                    <span className="text-sm text-foreground/80">{t(`${activeFeature}.feature2`)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                    <span className="text-sm text-foreground/80">{t(`${activeFeature}.feature3`)}</span>
                  </div>
                </div>

                <Button asChild variant="gradient-ai" className="rounded-full group">
                  <Link href="/register">
                    {t("tryNow")}
                    <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Link>
                </Button>
              </div>
            </GlassCard>
          </div>

          {/* Right: demo area */}
          <div className="order-1 lg:order-2">
            {activeFeature === "tap" && <TapCompletionDemo toAcceptText={t("demo.toAccept")} connectedText={t("demo.connected")} />}
            {activeFeature === "agent" && <AgentDiffDemo translations={{
              thinking: t("demo.thinking"),
              editing: t("demo.editing"),
              done: t("demo.done"),
              planningEdits: t("demo.planningEdits"),
              writingChanges: t("demo.writingChanges"),
              applied: t("demo.applied"),
            }} />}
            {activeFeature === "research" && <DeepResearchDemo translations={{
              running: t("demo.running"),
              complete: t("demo.complete"),
              researchQuery: t("demo.researchQuery"),
              researchProcess: t("demo.researchProcess"),
              steps: t("demo.steps"),
              processing: t("demo.processing"),
              researchReport: t("demo.researchReport"),
              autoSaved: t("demo.autoSaved"),
              researching: t("demo.researching"),
            }} />}
          </div>
        </div>
      </div>
    </section>
  );
}
