"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import {
  Sparkles,
  Plus,
  History,
  ArrowUp,
  AtSign,
  ChevronDown,
  Loader2,
  X,
  MessageSquare,
  Trash2,
  Bot,
  Compass,
  Code,
  Copy,
  Check,
  FileText,
  AlertCircle,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/lib/i18n";
import { DeepResearchPanel } from "./deep-research-panel";
// FilePickerButton was removed
import { ChatInput, type ChatInputRef } from "./chat-input";
import { FileEditDiff } from "./file-edit-diff";
import { ChatMarkdown } from "./chat-markdown";
import type { Attachment, LineRange, LatexBlock, ChatMessage, DeepResearchReport, DeepResearchReportSummary } from "@/types/ask";
import { useAsk } from "@/hooks/use-ask";
// Note: useEditStore.addEdit is called directly in use-ask.ts
import { useResearchTaskStore } from "@/stores/research-task-store";
// Deep Research API functions (call via API because storage runs on the server)
async function listUserReportsApi(projectId: string): Promise<DeepResearchReportSummary[]> {
  const res = await fetch(`/api/deep-research/list?projectId=${encodeURIComponent(projectId)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.reports || [];
}

async function getReportByIdApi(projectId: string, reportId: string): Promise<DeepResearchReport | null> {
  const res = await fetch(`/api/deep-research/${encodeURIComponent(reportId)}?projectId=${encodeURIComponent(projectId)}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.report || null;
}

async function deleteReportByIdApi(projectId: string, reportId: string): Promise<boolean> {
  const res = await fetch(`/api/deep-research/${encodeURIComponent(reportId)}?projectId=${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
  });
  return res.ok;
}

// Mode type
export type ChatMode = "ask" | "agent" | "deep-research";

// Modes visible in the mode selector are computed at runtime (capability-gated).

// Progress ring component
function ProgressCircle({ progress, size = 20 }: { progress: number; size?: number }) {
  const radius = (size - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);
  const center = size / 2;

  // Hide after completion
  if (progress >= 1) {
    return null;
  }

  return (
    <svg
      width={size}
      height={size}
      className="shrink-0 transition-opacity duration-500"
      style={{ opacity: progress >= 1 ? 0 : 1 }}
    >
      {/* Background ring */}
      <circle
        className="text-blue-200 dark:text-blue-900"
        strokeWidth="2"
        stroke="currentColor"
        fill="transparent"
        r={radius}
        cx={center}
        cy={center}
      />
      {/* Progress ring */}
      <circle
        className="text-blue-500 transition-all duration-300"
        strokeWidth="2"
        stroke="currentColor"
        fill="transparent"
        r={radius}
        cx={center}
        cy={center}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${center} ${center})`}
        strokeLinecap="round"
      />
    </svg>
  );
}

// Mode config - Cursor style
const MODE_CONFIG: Record<ChatMode, {
  icon: LucideIcon;
  label: string;
  description: string;
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  ask: {
    icon: MessageSquare,
    label: "Ask",
    description: "Ask questions about your document",
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/50",
  },
  agent: {
    icon: Bot,
    label: "Agent",
    description: "Edit documents with AI assistance",
    color: "text-muted-foreground",
    bgColor: "bg-muted",
    borderColor: "border-border",
  },
  "deep-research": {
    icon: Compass,
    label: "Deep Research",
    description: "In-depth research and analysis",
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/50",
  },
};

// Model selector was removed - models are configured on the backend

interface AiChatProps {
  projectId: string;
  mode?: ChatMode;
  onModeChange?: (mode: ChatMode) => void;
  // New: receive editor selection
  selectedText?: string;
  selectedRange?: LineRange;
  currentFilePath?: string;
  // New: insert content into editor
  onInsertContent?: (content: string, lineRange?: LineRange) => void;
  onReplaceContent?: (content: string, lineRange: LineRange) => void;
}

export function AiChat({
  projectId,
  mode: controlledMode,
  onModeChange,
  selectedText,
  selectedRange,
  currentFilePath,
  onInsertContent,
  onReplaceContent,
}: AiChatProps) {
  // Get user session
  const { data: session } = useSession();

  // i18n
  const { t } = useTranslations("aiChat");

  // Capability flags (server-derived; no secrets exposed)
  const [capAiEnabled, setCapAiEnabled] = useState<boolean>(true);
  const [capAiReason, setCapAiReason] = useState<string | undefined>(undefined);
  const [capDeepResearchEnabled, setCapDeepResearchEnabled] = useState<boolean>(true);
  const [capDeepResearchReason, setCapDeepResearchReason] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/internal/capabilities");
        if (!res.ok) return;
        const caps = await res.json();
        if (cancelled) return;
        setCapAiEnabled(!!caps.aiEnabled);
        setCapAiReason(caps.aiReason);
        setCapDeepResearchEnabled(!!caps.deepResearchEnabled);
        setCapDeepResearchReason(caps.deepResearchReason);
      } catch {
        // Best-effort: keep optimistic defaults.
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Global edit store (for CommandBar visibility tracking)
  // NOTE: addEdit is now called directly in use-ask.ts, not here

  // Research Task Store
  const {
    tasks: researchTasks,
    startTask: startResearchTask,
    getTask: getResearchTask,
    getRunningTasks,
  } = useResearchTaskStore();

  // State
  const [inputEmpty, setInputEmpty] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [internalMode, setInternalMode] = useState<ChatMode>("ask");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [researchQuery, setResearchQuery] = useState<string | null>(null);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);

  // Preserve previous session id when switching to/from Deep Research
  const [previousSessionId, setPreviousSessionId] = useState<string | null>(null);

  // Deep Research report list
  const [researchReports, setResearchReports] = useState<DeepResearchReportSummary[]>([]);
  const [isLoadingReports, setIsLoadingReports] = useState(false);
  const [currentReport, setCurrentReport] = useState<DeepResearchReport | null>(null);

  // History dialog tab
  const [historyTab, setHistoryTab] = useState<"chat" | "research">("chat");

  // Current task
  const currentTask = currentTaskId ? getResearchTask(currentTaskId) : null;

  // Refresh report list when a task completes
  useEffect(() => {
    if (currentTask?.status === 'completed') {
      loadResearchReports();
    }
  }, [currentTask?.status]);

  // Attachments
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [copiedBlockId, setCopiedBlockId] = useState<string | null>(null);

  // Hide Deep Research mode when it is disabled.
  const visibleModes = useMemo<ChatMode[]>(() => {
    const modes: ChatMode[] = ["ask", "agent"];
    if (capDeepResearchEnabled) modes.push("deep-research");
    return modes;
  }, [capDeepResearchEnabled]);

  // If Deep Research is currently selected but disabled, fall back to Ask.
  useEffect(() => {
    const current = controlledMode ?? internalMode;
    if (!capDeepResearchEnabled && current === "deep-research") {
      setInternalMode("ask");
      onModeChange?.("ask");
    }
  }, [capDeepResearchEnabled, controlledMode, internalMode, onModeChange]);

  // Ask hook with multi-session support
  // NOTE: All hooks must be called before any conditional returns to follow React rules of hooks
  const {
    isLoading: askIsLoading,
    isLoadingSessions,
    status: askStatus,
    currentMessage: askCurrentMessage,
    references,
    error: askError,
    // Stream events - ordered list of text and file edits
    streamEvents,
    // Context usage - for progress ring
    historyTokens,
    historyLimit,
    sendMessage: sendAskMessage,
    abort: abortAsk,
    sessions,           // All sessions for this user
    currentSessionId,   // Current session ID
    messageHistory,     // Messages in current session
    loadSessions,       // Reload sessions list
    selectSession,      // Switch to a session
    createNewSession,   // Start new session
    deleteSession,      // Delete a session
    mode: askMode,      // Current Ask/Agent mode ("ask" | "agent")
    setMode: setAskMode,  // Update Ask/Agent mode
    // Agent mode: file edits
    pendingEdits,
    applyEdit,
    rejectEdit,
  } = useAsk({
    projectId,
    userId: session?.user?.id,
    userName: session?.user?.name || session?.user?.email || undefined,
    onError: (error) => {
      console.error("Ask error:", error);
    },
    onDone: (data) => {
      console.log("Ask done:", data);
    },
    onFileEdit: (data) => {
      // NOTE: Don't call addEditToStore here!
      // use-ask.ts already calls storeAddEdit with the correct allBlocks.
      // This callback is only for additional UI handling if needed.
      console.log("File edit completed:", data.filePath, data.blocks?.length, "blocks");
    },
  });

  // Use controlled mode (if provided) or internal state
  const mode = controlledMode ?? internalMode;

  // Whether Ask/Agent is streaming (disable switching)
  const isStreamingInAskAgent = (mode === "ask" || mode === "agent") && askIsLoading;

  const inputRef = useRef<ChatInputRef>(null);

  // Notify parent on mode change (parent handles panel open logic for draw mode).
  // Ask and Agent share the same session (chat history).
  // Deep Research is independent; switching requires saving/restoring session state.
  const handleModeChange = useCallback((newMode: ChatMode) => {
    const currentMode = controlledMode ?? internalMode;

    // Switch from ask/agent -> deep-research
    if ((currentMode === "ask" || currentMode === "agent") && newMode === "deep-research") {
      // Save current session id so we can restore when switching back
      setPreviousSessionId(currentSessionId);
      // Clear research query (enter empty state)
      setResearchQuery(null);
      // Clear input
      inputRef.current?.clear();
    }

    // Switch from deep-research -> ask/agent
    if (currentMode === "deep-research" && (newMode === "ask" || newMode === "agent")) {
      // If no research was started (researchQuery is empty), restore previous session
      if (!researchQuery && previousSessionId) {
        selectSession(previousSessionId);
      }
      // Clear previousSessionId
      setPreviousSessionId(null);
      // Clear research query
      setResearchQuery(null);
      // Clear input
      inputRef.current?.clear();
    }

    setInternalMode(newMode);
    // Sync with hook for Ask/Agent modes
    if (newMode === "ask" || newMode === "agent") {
      setAskMode(newMode);
    }
    onModeChange?.(newMode);
  }, [controlledMode, internalMode, currentSessionId, researchQuery, previousSessionId, selectSession, onModeChange, setAskMode]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Add selected content as an attachment
  const addSelectionAsAttachment = useCallback(() => {
    if (selectedText && currentFilePath && inputRef.current) {
      inputRef.current.insertAttachment({
        type: "selection",
        filePath: currentFilePath,
        fileName: currentFilePath.split("/").pop() || currentFilePath,
        lineRange: selectedRange,
        preview: selectedText.slice(0, 200),
      });
    }
  }, [selectedText, selectedRange, currentFilePath]);

  // Copy LaTeX block
  const copyLatexBlock = useCallback(async (block: LatexBlock) => {
    try {
      await navigator.clipboard.writeText(block.content);
      setCopiedBlockId(block.id);
      setTimeout(() => setCopiedBlockId(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, []);

  // Insert LaTeX block into editor
  const insertLatexBlock = useCallback((block: LatexBlock) => {
    onInsertContent?.(block.content);
  }, [onInsertContent]);

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messageHistory, askCurrentMessage, scrollToBottom]);

  // Create new conversation
  const createNewConversation = () => {
    createNewSession();
    // Clear Deep Research state
    setResearchQuery(null);
    setCurrentReport(null);
    setCurrentTaskId(null);
  };

  // Load Deep Research reports
  const loadResearchReports = useCallback(async () => {
    if (!session?.user?.id) return;
    setIsLoadingReports(true);
    try {
      const reports = await listUserReportsApi(projectId);
      setResearchReports(reports);
    } catch (error) {
      console.error("Failed to load research reports:", error);
    } finally {
      setIsLoadingReports(false);
    }
  }, [projectId, session?.user?.id]);

  // Select a Deep Research report to view
  const selectResearchReport = useCallback(async (reportId: string) => {
    if (!session?.user?.id) return;
    try {
      const report = await getReportByIdApi(projectId, reportId);
      if (report) {
        setCurrentReport(report);
        setCurrentTaskId(null); // Clear current task
        // Switch to deep-research mode to display the report
        setInternalMode("deep-research");
        setResearchQuery(report.query);
        onModeChange?.("deep-research"); // Notify parent
        setHistoryOpen(false);
      }
    } catch (error) {
      console.error("Failed to load report:", error);
    }
  }, [projectId, session?.user?.id, onModeChange]);

  // Delete a Deep Research report
  const deleteResearchReport = useCallback(async (reportId: string) => {
    if (!session?.user?.id) return;
    try {
      await deleteReportByIdApi(projectId, reportId);
      setResearchReports(prev => prev.filter(r => r.id !== reportId));
    } catch (error) {
      console.error("Failed to delete report:", error);
    }
  }, [projectId, session?.user?.id]);

  // Load report list when opening History dialog (Research tab)
  useEffect(() => {
    if (historyOpen && historyTab === "research") {
      loadResearchReports();
    }
  }, [historyOpen, historyTab, loadResearchReports]);

  // Send message
  const handleSend = async (text?: string, atts?: Attachment[]) => {
    // If args are not provided, read from input
    let query = text;
    let messageAttachments = atts;

    if (query === undefined) {
      const inputData = inputRef.current?.getValue();
      query = inputData?.text || "";
      messageAttachments = inputData?.attachments || attachments;
    }

    if (!query && (!messageAttachments || messageAttachments.length === 0)) return;
    if (isLoading || askIsLoading) return;

    // Clear input
    inputRef.current?.clear();

    // Deep Research mode special handling
    if (mode === "deep-research") {
      // Clear previous report and start a new research
      setCurrentReport(null);
      setResearchQuery(query);

      // Start background task via store (persistence is handled inside the store)
      if (session?.user?.id && query) {
        const taskId = startResearchTask(projectId, session.user.id, query);
        setCurrentTaskId(taskId);
      }
      return;
    }

    // Ask/Agent modes: use the unified API
    if (mode === "ask" || mode === "agent") {
      setIsLoading(true);
      try {
        // sendAskMessage selects the toolset based on askMode
        await sendAskMessage(query || "", messageAttachments || [], false, mode === "agent" ? "agent" : "ask");
      } catch (err) {
        console.error(`${mode} error:`, err);
      } finally {
        setIsLoading(false);
        setAttachments([]); // Clear attachments after sending
      }
      return;
    }
  };

  // Keyboard handling
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Check isComposing to avoid sending while IME is composing
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  // Format relative time
  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes} minutes ago`;
    if (hours < 24) return `${hours} hours ago`;
    return `${days} days ago`;
  };

  // If AI is disabled, render an explicit placeholder instead of crashing.
  // NOTE: This check must be AFTER all hooks to follow React rules of hooks.
  if (!capAiEnabled) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t("title")}</span>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-lg border bg-card p-5 text-center">
            <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <div className="text-base font-semibold mb-2">AI is disabled</div>
            <div className="text-sm text-muted-foreground">
              {capAiReason
                ? capAiReason
                : "Set OPENROUTER_API_KEY (or OPENROUTER_API_KEYS) and restart the services to enable AI features."}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-background min-w-0 overflow-hidden">
      {/* Top toolbar - compact style */}
      {(
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5 bg-muted/30">
          <span className="text-sm font-medium text-muted-foreground truncate">
            {mode === "deep-research"
              ? (researchQuery
                  ? (researchQuery.length > 30 ? researchQuery.slice(0, 30) + "..." : researchQuery)
                  : "Deep Research")
              : (sessions.find(s => s.id === currentSessionId)?.title || "New Chat")}
          </span>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={createNewConversation}
                  disabled={isStreamingInAskAgent}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">New Chat</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setHistoryOpen(true)}
                  disabled={isStreamingInAskAgent}
                >
                  <History className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">History</TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-hidden min-w-0">
        {/* Deep Research mode - running */}
        {mode === "deep-research" && researchQuery ? (
          <DeepResearchPanel
            query={researchQuery}
            taskId={currentTaskId}
            existingReport={currentReport}
            onError={(error) => {
              console.error("Research error:", error);
            }}
          />
        ) : mode === "deep-research" ? (
          /* Deep Research mode - waiting for input */
          <div className="h-full overflow-y-auto p-3">
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center mb-4">
                <Compass className="h-6 w-6 text-blue-500" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Deep Research</h3>
              <p className="text-sm text-muted-foreground max-w-xs">
                Enter a research topic to generate a comprehensive report with academic references.
              </p>
            </div>
          </div>
        ) : (
        /* Ask/Agent mode - message list */
        <div ref={scrollRef} className="h-full overflow-y-auto p-3">
          {isLoadingSessions ? (
            /* Loading sessions */
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">{t("loadingHistory")}</p>
            </div>
          ) : messageHistory.length === 0 ? (
            /* Welcome screen when there is no history */
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-2">AI Assistant</h3>
              <p className="text-sm text-muted-foreground max-w-xs">
                Ask questions, get help with your LaTeX document, or use Agent mode for editing.
              </p>
            </div>
          ) : (
            /* Render message list when history exists */
            <div className="space-y-4">
              {messageHistory.map((message) => {
                return (
                  <div key={message.id} className="group">
                    {message.role === "user" ? (
                      <>
                        {/* User message */}
                        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                          <div className="flex flex-wrap items-center gap-1.5 text-sm">
                            {/* Render message content (including file reference parsing) */}
                            {(() => {
                              /* Get content: from items or legacy content */
                              const content = message.items
                                ? message.items.filter((item): item is { type: "text"; content: string } => item.type === "text").map(item => item.content).join("")
                                : (message.content || "");

                              /* Parse file references in the form [[FILE:filename (lines)]] */
                              const parts: React.ReactNode[] = [];
                              const regex = /\[\[FILE:([^\]]+)\]\]/g;
                              let lastIndex = 0;
                              let match;
                              let keyIndex = 0;

                              while ((match = regex.exec(content)) !== null) {
                                /* Add plain text before the match */
                                if (match.index > lastIndex) {
                                  parts.push(
                                    <span key={`text-${keyIndex++}`} className="text-foreground">
                                      {content.slice(lastIndex, match.index)}
                                    </span>
                                  );
                                }

                                /* Parse the file reference payload */
                                const fileRef = match[1];
                                const fileMatch = fileRef.match(/^(.+?)\s*\((\d+)-(\d+)\)/);

                                if (fileMatch) {
                                  const [, fileName, startLine, endLine] = fileMatch;
                                  parts.push(
                                    <span
                                      key={`file-${keyIndex++}`}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-background text-xs border border-border"
                                    >
                                      <Code className="h-3 w-3 text-blue-500" />
                                      <span className="font-medium">{fileName}</span>
                                      <span className="text-muted-foreground font-mono">
                                        ({startLine}-{endLine})
                                      </span>
                                    </span>
                                  );
                                } else {
                                  /* Whole-file reference (no line range) */
                                  parts.push(
                                    <span
                                      key={`file-${keyIndex++}`}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-background text-xs border border-border"
                                    >
                                      <Code className="h-3 w-3 text-blue-500" />
                                      <span className="font-medium">{fileRef}</span>
                                    </span>
                                  );
                                }
                                lastIndex = regex.lastIndex;
                              }

                              /* Add remaining text */
                              if (lastIndex < content.length) {
                                parts.push(
                                  <span key={`text-${keyIndex++}`} className="text-foreground">
                                    {content.slice(lastIndex)}
                                  </span>
                                );
                              }

                              return parts.length > 0 ? parts : <span className="text-foreground">{content}</span>;
                            })()}
                          </div>
                        </div>

                      </>
                    ) : (
                      /* AI response - render items in order */
                      <div className="mt-3 space-y-3">
                        {message.items && message.items.length > 0 ? (
                          /* New format: render items in order */
                          message.items.map((item, itemIdx) => {
                            if (item.type === "text") {
                              return (
                                <ChatMarkdown
                                  key={`${message.id}-item-${itemIdx}`}
                                  content={item.content}
                                  onCopyCode={(code) => navigator.clipboard.writeText(code)}
                                />
                              );
                            }
                            if (item.type === "action" && item.action.type === "edit_file" && item.action.blocks) {
                              return (
                                <FileEditDiff
                                  key={`${message.id}-item-${itemIdx}`}
                                  editId={`historical-${message.id}-${itemIdx}`}
                                  filePath={item.action.filePath}
                                  blocks={item.action.blocks}
                                  description={item.action.description}
                                  status="applied"
                                  hideActions={true}
                                />
                              );
                            }
                            return null;
                          })
                        ) : (
                          /* Legacy format: render content and actions separately */
                          <>
                            {message.content && (
                              <ChatMarkdown
                                content={message.content}
                                onCopyCode={(code) => navigator.clipboard.writeText(code)}
                              />
                            )}
                            {message.actions && message.actions.length > 0 && (
                              <div className="space-y-2">
                                {message.actions
                                  .filter((action) => action.type === "edit_file" && action.blocks)
                                  .map((action, actionIdx) => (
                                    <FileEditDiff
                                      key={`${message.id}-action-${actionIdx}`}
                                      editId={`historical-${message.id}-${actionIdx}`}
                                      filePath={action.filePath}
                                      blocks={action.blocks!}
                                      description={action.description}
                                      status="applied"
                                      hideActions={true}
                                    />
                                  ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    </div>
                );
              })}

              {/* Ask/Agent streaming output */}
              {(askIsLoading || streamEvents.length > 0) && (mode === "ask" || mode === "agent") && (
                <div className="mt-3 space-y-3">
                  {/* Status hint (shown only when there is no content yet) */}
                  {askStatus && streamEvents.length === 0 && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {askStatus}
                    </div>
                  )}

                  {/* Render streaming events in order */}
                  {streamEvents.map((event) => {
                    if (event.type === "text") {
                      return (
                        <ChatMarkdown
                          key={event.id}
                          content={event.content}
                          onCopyCode={(code) => navigator.clipboard.writeText(code)}
                        />
                      );
                    }
                    if (event.type === "file_edit") {
                      /* Get the latest status from pendingEdits */
                      const latestEdit = pendingEdits.find(e => e.editId === event.edit.editId);
                      const edit = latestEdit || event.edit;
                      return (
                        <FileEditDiff
                          key={event.id}
                          editId={edit.editId}
                          filePath={edit.filePath}
                          blocks={edit.blocks}
                          description={edit.description}
                          status={edit.status}
                          hideActions={true}
                        />
                      );
                    }
                    return null;
                  })}

                  {/* Loading indicator during streaming */}
                  {askIsLoading && streamEvents.length > 0 && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                  )}
                </div>
              )}

              {/* Deep Research mode loading state */}
              {isLoading && (mode as ChatMode) === "deep-research" && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground mt-3">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("thinking")}
                </div>
              )}

              {/* Error message */}
              {askError && (
                <div className="mt-4 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-destructive">
                        {t("errorOccurred")}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {askError.message}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-border p-3 space-y-2">
        {/* Input - in Deep Research mode: disable input while running or when a report exists */}
        {(() => {
            // Deep Research mode special handling
            const isDeepResearch = mode === "deep-research";
            const hasActiveTask = isDeepResearch && (currentTask || currentReport);
            const isTaskRunning = currentTask?.status === 'running';

            // If there is an active task/report in Deep Research mode, show status instead of input
            if (hasActiveTask) {
              return (
                <div className="flex items-center justify-center py-3 px-4 rounded-lg bg-muted/50 text-sm text-muted-foreground">
                  {isTaskRunning ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Research in progress... {Math.round((currentTask?.progress || 0) * 100)}%
                    </>
                  ) : (
                    <>
                      <FileText className="h-4 w-4 mr-2" />
                      Research completed. Start a new research from the mode selector.
                    </>
                  )}
                </div>
              );
            }

            return (
              <ChatInput
                ref={inputRef}
                placeholder={isDeepResearch ? "Enter a research topic..." : t("inputPlaceholder")}
                disabled={isLoading || askIsLoading}
                disableAttachments={isDeepResearch}
                onSubmit={handleSend}
                onChange={(isEmpty) => setInputEmpty(isEmpty)}
              />
            );
          })()}

        {/* Toolbar */}
        <div className="flex items-center justify-between">
          {/* Left: mode and model selection */}
          <div className="flex items-center gap-2">
            {/* Mode selector - Cursor style */}
            <DropdownMenu
              open={modeMenuOpen}
              onOpenChange={(open) => {
                // Prevent opening dropdown while streaming
                if (open && isStreamingInAskAgent) return;
                setModeMenuOpen(open);
              }}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-7 px-2 text-xs gap-1.5 transition-colors",
                    MODE_CONFIG[mode].bgColor,
                    MODE_CONFIG[mode].borderColor,
                    MODE_CONFIG[mode].color,
                    isStreamingInAskAgent && "opacity-50 cursor-not-allowed"
                  )}
                  disabled={isStreamingInAskAgent}
                >
                  {(() => {
                    const Icon = MODE_CONFIG[mode].icon;
                    return <Icon className="h-3.5 w-3.5" />;
                  })()}
                  {MODE_CONFIG[mode].label}
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {visibleModes.map((modeKey) => {
                  const config = MODE_CONFIG[modeKey];
                  const Icon = config.icon;
                  return (
                    <DropdownMenuItem
                      key={modeKey}
                      onClick={() => handleModeChange(modeKey)}
                      className={cn(
                        "flex items-start gap-3 p-2 cursor-pointer",
                        mode === modeKey && config.bgColor
                      )}
                    >
                      <div className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                        config.bgColor
                      )}>
                        <Icon className={cn("h-4 w-4", config.color)} />
                      </div>
                      <div className="flex flex-col">
                        <span className={cn("font-medium", mode === modeKey && config.color)}>
                          {config.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {config.description}
                        </span>
                      </div>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Model selector removed - models are configured on the backend */}
          </div>

          {/* Right: action buttons */}
          <div className="flex items-center gap-1">
              {/* RAG context search, web search, and file upload buttons were removed */}

              {/* Add selection - hidden in Deep Research mode */}
              {selectedText && mode !== "deep-research" && (
              <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-blue-500"
                      onClick={addSelectionAsAttachment}
                    >
                    <AtSign className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                  <TooltipContent side="top">{t("addSelectionAsReference")}</TooltipContent>
              </Tooltip>
              )}

              {/* Context Usage Progress Ring - only show in Ask/Agent modes */}
              {mode !== "deep-research" && historyTokens > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center mr-1">
                      <ProgressCircle
                        progress={historyTokens / historyLimit}
                        size={20}
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Context: {Math.round(historyTokens / 1000)}K / {Math.round(historyLimit / 1000)}K
                  </TooltipContent>
                </Tooltip>
              )}

              {/* Send button */}
              <Button
                size="icon"
                className="h-7 w-7 rounded-full"
                onClick={() => handleSend()}
                disabled={inputEmpty || isLoading || askIsLoading}
              >
                {isLoading || askIsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </Button>
            </div>
        </div>
      </div>

      {/* History dialog */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-[90vw] sm:max-w-[400px] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              {t("historyTitle")}
            </DialogTitle>
          </DialogHeader>

          <div className="w-full overflow-hidden">
            <Tabs value={historyTab} onValueChange={(v) => setHistoryTab(v as "chat" | "research")} className="w-full">
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="chat" className="text-xs">
                  <MessageSquare className="h-3.5 w-3.5 mr-1" />
                  Chat
                </TabsTrigger>
                <TabsTrigger value="research" className="text-xs">
                  <Compass className="h-3.5 w-3.5 mr-1" />
                  Research
                </TabsTrigger>
              </TabsList>

            {/* Chat History Tab */}
            <TabsContent value="chat" className="mt-3">
              <ScrollArea className="max-h-[350px]">
                {isLoadingSessions ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">{t("loading")}</p>
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                    <MessageSquare className="h-10 w-10 mb-2 opacity-50" />
                    <p className="text-sm">{t("noConversations")}</p>
                    <p className="text-xs mt-1">{t("noConversationsHint")}</p>
                  </div>
                ) : (
                  <div className="space-y-2 pr-4">
                    {sessions.map((sess) => (
                      <div
                        key={sess.id}
                        className={cn(
                          "group flex items-center justify-between p-3 rounded-lg cursor-pointer",
                          "hover:bg-accent transition-colors",
                          currentSessionId === sess.id && "bg-accent"
                        )}
                        onClick={() => {
                          selectSession(sess.id);
                          // If currently in deep-research mode, switch back to ask mode
                          if (mode === "deep-research") {
                            setInternalMode("ask");
                            setAskMode("ask");
                            setResearchQuery(null);
                            setCurrentReport(null);
                            onModeChange?.("ask");
                          }
                          setHistoryOpen(false);
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{sess.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {t("messageCount", { count: sess.messageCount })} · {formatTime(new Date(sess.updatedAt))}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteSession(sess.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            {/* Research Reports Tab */}
            <TabsContent value="research" className="mt-3">
              <ScrollArea className="max-h-[350px]">
                {isLoadingReports ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">{t("loading")}</p>
                  </div>
                ) : (
                  <div className="space-y-2 pr-4">
                    {/* Running tasks */}
                    {getRunningTasks().map((task) => (
                      <div
                        key={task.id}
                        className={cn(
                          "group flex items-center justify-between p-3 rounded-lg cursor-pointer",
                          "hover:bg-accent transition-colors",
                          currentTaskId === task.id && "bg-accent"
                        )}
                        onClick={() => {
                          setCurrentTaskId(task.id);
                          setResearchQuery(task.query);
                          setCurrentReport(null);
                          setInternalMode("deep-research");
                          onModeChange?.("deep-research");
                          setHistoryOpen(false);
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {task.query.length > 30 ? task.query.slice(0, 30) + "..." : task.query}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Running... {Math.round(task.progress * 100)}%
                          </p>
                        </div>
                        <ProgressCircle progress={task.progress} size={24} />
                      </div>
                    ))}

                    {/* Completed reports - filter out running tasks to avoid duplicates */}
                    {(() => {
                      const runningTasks = getRunningTasks();
                      // Only filter running tasks; completed tasks should still appear in the report list
                      const runningTaskIds = new Set(runningTasks.map(t => t.id));
                      const filteredReports = researchReports.filter(r => !runningTaskIds.has(r.id));

                      if (filteredReports.length === 0 && runningTasks.length === 0) {
                        return (
                          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                            <Compass className="h-10 w-10 mb-2 opacity-50" />
                            <p className="text-sm">No research reports yet</p>
                            <p className="text-xs mt-1">Use Deep Research mode to create reports</p>
                          </div>
                        );
                      }

                      return filteredReports.map((report) => (
                        <div
                          key={report.id}
                          className={cn(
                            "group flex items-center justify-between p-3 rounded-lg cursor-pointer",
                            "hover:bg-accent transition-colors"
                          )}
                          onClick={() => selectResearchReport(report.id)}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{report.queryPreview}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatTime(new Date(report.createdAt))}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteResearchReport(report.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ));
                    })()}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
            </Tabs>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
