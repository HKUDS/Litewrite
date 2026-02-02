"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslations } from "@/lib/i18n";
import { ApiError, createApiErrorHandler } from "@/lib/api-error-handler";
import type {
  Attachment,
  ChatMessage,
  ChatMessageItem,
  AskReferenceEvent,
  AskContextEvent,
  SessionMessage,
  SessionMessageItem,
  SessionSummary,
  SessionAction,
  PendingFileEdit,
  AskFileEditEvent,
  StreamEvent,
} from "@/types/ask";
import { useEditStore } from "@/stores/edit-store";
import { useVibeLockStore } from "@/stores/vibe-lock-store";

// Note: RelativePosition is now calculated on the server side (WebSocket server)
// The server handles position tracking and updates startLine/endLine in real-time
// Frontend just uses the line numbers from the server directly

type ChatMode = "ask" | "agent";

interface UseAskOptions {
  projectId: string;
  // User info for vibe lock
  userId?: string;
  userName?: string;
  onMessage?: (message: ChatMessage) => void;
  onError?: (error: { code: string; message: string }) => void;
  onDone?: (data: { conversationId: string }) => void;
  onContext?: (data: AskContextEvent["data"]) => void;
  // Agent mode callbacks
  onFileEdit?: (data: AskFileEditEvent["data"]) => void;
}

interface UseAskReturn {
  // Loading states
  isLoading: boolean;
  isLoadingSessions: boolean;

  // Current request state
  status: string;
  currentMessage: string;
  references: AskReferenceEvent["data"][];
  contexts: AskContextEvent["data"][];
  error: { code: string; message: string } | null;

  // Stream events - ordered list of text and file edits for display
  streamEvents: StreamEvent[];

  // Context usage - for progress ring display
  historyTokens: number;
  historyLimit: number;

  // Session management
  sessions: SessionSummary[];
  currentSessionId: string | null;
  messageHistory: ChatMessage[];

  // Mode
  mode: ChatMode;
  setMode: (mode: ChatMode) => void;

  // Agent mode: pending file edits
  pendingEdits: PendingFileEdit[];
  applyEdit: (editId: string) => Promise<void>;
  rejectEdit: (editId: string) => void;

  // Methods
  sendMessage: (message: string, attachments?: Attachment[], enableRAG?: boolean, mode?: ChatMode) => Promise<void>;
  abort: () => void;
  loadSessions: () => Promise<void>;
  selectSession: (sessionId: string) => Promise<void>;
  createNewSession: () => void;
  deleteSession: (sessionId: string) => Promise<void>;
}

/**
 * Ask Mode Hook with Multi-Session Support
 *
 * Manages multiple conversation sessions per user per project.
 */
export function useAsk({
  projectId,
  userId,
  userName,
  onMessage,
  onError,
  onDone,
  onContext,
  onFileEdit,
}: UseAskOptions): UseAskReturn {
  const { t } = useTranslations();
  const handleApiError = createApiErrorHandler(t);

  // Loading states
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);

  // Current request state
  const [status, setStatus] = useState("");
  const [currentMessage, setCurrentMessage] = useState("");

  // Vibe lock store
  const setVibeLock = useVibeLockStore((state) => state.setLock);
  const clearVibeLock = useVibeLockStore((state) => state.clearLock);

  // Track locked files during current request
  const lockedFilesRef = useRef<string[]>([]);

  // Agent mode: pending file edits - use edit store directly (single source of truth)
  const storePendingEdits = useEditStore((state) => state.pendingEdits);
  const storeAddEdit = useEditStore((state) => state.addEdit);

  // Convert store format to hook format
  const pendingEdits: PendingFileEdit[] = storePendingEdits.map(edit => ({
    editId: edit.id,
    filePath: edit.filePath,
    blocks: edit.blocks,
    description: edit.description || "",
    status: edit.status,
  }));

  const [references, setReferences] = useState<AskReferenceEvent["data"][]>([]);
  const [contexts, setContexts] = useState<AskContextEvent["data"][]>([]);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  // Stream events - ordered list of text and file edits for display
  const [streamEvents, setStreamEvents] = useState<StreamEvent[]>([]);

  // Context usage - for progress ring display
  const [historyTokens, setHistoryTokens] = useState(0);
  const [historyLimit, setHistoryLimit] = useState(64000);  // Default: 64K, updated from backend

  // Session state
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // Use ref to track current session ID to avoid stale closure issues
  const currentSessionIdRef = useRef<string | null>(null);

  // Mode state: "ask" (read-only) or "agent" (editing)
  const [mode, setMode] = useState<ChatMode>("ask");
  const [messageHistory, setMessageHistory] = useState<ChatMessage[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const currentMessageIdRef = useRef<string>("");
  // Collect message items in order (text and actions)
  const collectedItemsRef = useRef<ChatMessageItem[]>([]);

  // Reset current request state
  const resetCurrentRequest = useCallback(() => {
    console.log('[DEBUG] resetCurrentRequest called');
    setIsLoading(false);
    setStatus("");
    setCurrentMessage("");
    setReferences([]);
    setContexts([]);
    setError(null);
    // Clear all stream events for new request
    // Historical items are now stored in messageHistory.items
    setStreamEvents([]);
    // Reset collected items for new request
    collectedItemsRef.current = [];
    // NOTE: Do NOT reset pendingEdits here - they should persist across requests
    // until user explicitly keeps or undoes them
  }, []);

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    setStatus("");
  }, []);

  // Load chat configuration from backend (context limits, etc.)
  const loadChatConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/internal/chat-config');
      if (response.ok) {
        const config = await response.json();
        if (config.historyLimit !== undefined) {
          setHistoryLimit(config.historyLimit);
        }
      }
    } catch (err) {
      console.error("Failed to load chat config:", err);
      // Keep default value on error
    }
  }, []);

  // Load all sessions for current user
  const loadSessions = useCallback(async () => {
    if (!projectId) return;

    setIsLoadingSessions(true);
    try {
      const response = await fetch(`/api/chat?projectId=${projectId}`);
      if (response.ok) {
        const data = await response.json();
        setSessions(data.sessions || []);

        // Auto-select most recent session if none selected
        if (!currentSessionId && data.sessions?.length > 0) {
          await selectSessionInternal(data.sessions[0].id);
        }
      }
    } catch (err) {
      console.error("Failed to load sessions:", err);
    } finally {
      setIsLoadingSessions(false);
      setSessionsLoaded(true);
    }
  }, [projectId, currentSessionId]);

  // Internal: Load specific session content
  const selectSessionInternal = useCallback(async (sessionId: string) => {
    if (!projectId) return;

    try {
      const response = await fetch(`/api/chat?projectId=${projectId}&sessionId=${sessionId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.session) {
          // Update ref FIRST before anything else (critical for avoiding race conditions)
          currentSessionIdRef.current = sessionId;
          setCurrentSessionId(sessionId);

          // Load historyTokens from session (for context progress ring)
          setHistoryTokens(data.session.historyTokens || 0);

          // Convert SessionMessage to ChatMessage
          const messages: ChatMessage[] = data.session.messages.map((msg: SessionMessage) => ({
            id: `${msg.role}_${msg.timestamp}`,
            role: msg.role,
            content: msg.content,
            timestamp: new Date(msg.timestamp),
            attachments: msg.fileRefs?.map((ref: { filePath: string; lineRange?: { start: number; end: number } }) => ({
              type: "selection" as const,
              filePath: ref.filePath,
              fileName: ref.filePath.split("/").pop() || ref.filePath,
              lineRange: ref.lineRange,
            })),
            // New items format (primary)
            items: msg.items,
            // Legacy fields for backward compatibility
            actions: msg.actions,
            latexBlocks: msg.latexBlocks,
          }));
          setMessageHistory(messages);
        }
      }
    } catch (err) {
      console.error("Failed to load session:", err);
    }
  }, [projectId]);

  // Select a session (public method)
  const selectSession = useCallback(async (sessionId: string) => {
    resetCurrentRequest();
    await selectSessionInternal(sessionId);
  }, [resetCurrentRequest, selectSessionInternal]);

  // Create new session (just reset state, actual session created on first message)
  const createNewSession = useCallback(() => {
    resetCurrentRequest();
    setCurrentSessionId(null);
    currentSessionIdRef.current = null;  // Clear ref
    setMessageHistory([]);
    setHistoryTokens(0);  // Reset context usage for new session
  }, [resetCurrentRequest]);

  // Delete a session
  const deleteSession = useCallback(async (sessionId: string) => {
    if (!projectId) return;

    try {
      const response = await fetch(`/api/chat?projectId=${projectId}&sessionId=${sessionId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        // Remove from local list
        setSessions(prev => prev.filter(s => s.id !== sessionId));

        // If deleted current session, clear it
        if (currentSessionId === sessionId) {
          setCurrentSessionId(null);
          currentSessionIdRef.current = null;
          setMessageHistory([]);
        }
      }
    } catch (err) {
      console.error("Failed to delete session:", err);
    }
  }, [projectId, currentSessionId]);

  // Apply a pending file edit - delegate to edit store
  const storeApplyEdit = useEditStore((state) => state.applyEdit);
  const applyEdit = useCallback(async (editId: string) => {
    await storeApplyEdit(editId);
  }, [storeApplyEdit]);

  // Reject a pending file edit - delegate to edit store
  const storeRejectEdit = useEditStore((state) => state.rejectEdit);
  const rejectEdit = useCallback((editId: string) => {
    storeRejectEdit(editId);
  }, [storeRejectEdit]);

  // Load chat config on mount (context limits, etc.)
  useEffect(() => {
    loadChatConfig();
  }, [loadChatConfig]);

  // Load sessions on mount
  useEffect(() => {
    if (!sessionsLoaded && projectId) {
      loadSessions();
    }
  }, [sessionsLoaded, projectId, loadSessions]);

  // Send message
  const sendMessage = useCallback(async (
    message: string,
    attachments: Attachment[] = [],
    enableRAG = false,
    requestMode?: ChatMode,
  ) => {
    resetCurrentRequest();
    setIsLoading(true);

    // Use provided mode or current mode state
    const effectiveMode = requestMode || mode;

    // Reset locked files - will be populated when LLM calls read_file
    lockedFilesRef.current = [];

    // Add user message to local history immediately (using items format)
    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: "user",
      items: [{ type: "text", content: message }],
      timestamp: new Date(),
      attachments,
    };
    setMessageHistory(prev => [...prev, userMessage]);

    // Create AbortController
    abortControllerRef.current = new AbortController();

    // Use ref to get the latest session ID (avoids stale closure)
    const effectiveSessionId = currentSessionIdRef.current;

    const requestBody = {
      projectId,
      message,
      attachments: attachments.map(att => ({
        ...att,
        preview: undefined,
      })),
      enableRAG,
      sessionId: effectiveSessionId,  // null = create new session
      mode: effectiveMode,  // "ask" or "agent"
    };


    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw handleApiError(errorData);
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      // Read SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let messageContent = "";  // For currentMessage display
      const collectedReferences: AskReferenceEvent["data"][] = [];
      const collectedContexts: AskContextEvent["data"][] = [];

      // Track processed edit IDs to prevent duplicate processing (React StrictMode workaround)
      const processedEditIds = new Set<string>();

      // IMPORTANT: Keep currentEventType outside the while loop!
      // SSE events may be split across chunks: "event: file_edit" in one chunk,
      // "data: {...}" in the next. We need to remember the event type across chunks.
      let currentEventType = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmedLine = line.trim();

          if (trimmedLine.startsWith("event: ")) {
            currentEventType = trimmedLine.slice(7);
            continue;
          }

          if (trimmedLine.startsWith("data: ")) {
            try {
              const data = JSON.parse(trimmedLine.slice(6));

              switch (currentEventType) {
                case "status":
                  setStatus(data.message || data.status);
                  break;

                case "message":
                  console.log('[DEBUG] Received message event, chunk length:', data.chunk?.length, 'messageId:', data.messageId);
                  messageContent += data.chunk;
                  setCurrentMessage(messageContent);
                  currentMessageIdRef.current = data.messageId;

                  // Collect to items - append to last text item or create new one
                  const lastItem = collectedItemsRef.current[collectedItemsRef.current.length - 1];
                  if (lastItem?.type === "text") {
                    // Append to existing text item
                    lastItem.content += data.chunk;
                  } else {
                    // Create new text item (first one, or after an action)
                    collectedItemsRef.current.push({ type: "text", content: data.chunk });
                  }

                  // Update stream events for display
                  setStreamEvents(prev => {
                    const lastTextIdx = prev.map((e, i) => e.type === "text" ? i : -1)
                      .filter(i => i >= 0)
                      .pop();

                    const hasFileEditAfterText = lastTextIdx !== undefined &&
                      prev.slice(lastTextIdx + 1).some(e => e.type === "file_edit");

                    if (lastTextIdx !== undefined && !hasFileEditAfterText) {
                      return prev.map((e, i) =>
                        i === lastTextIdx && e.type === "text"
                          ? { ...e, content: e.content + data.chunk }
                          : e
                      );
                    } else {
                      return [...prev, {
                        type: "text" as const,
                        content: data.chunk,
                        id: `text_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                      }];
                    }
                  });
                  break;

                case "reference":
                  collectedReferences.push(data);
                  setReferences([...collectedReferences]);
                  break;

                case "context":
                  collectedContexts.push(data);
                  setContexts([...collectedContexts]);
                  onContext?.(data);
                  break;

                // Vibe lock: file being read by AI
                case "file_locked":
                  if (data.filePath) {
                    lockedFilesRef.current.push(data.filePath);
                    setVibeLock({
                      filePath: data.filePath,
                      userId: userId || "anonymous",
                      userName: userName || "AI",
                      projectId,
                      lockedAt: Date.now(),
                    });
                  }
                  break;

                // Agent mode: file operation events
                case "file_edit":
                  // Prevent duplicate processing (React StrictMode causes double execution)
                  // Use Python backend's editId for deduplication (same across double calls)
                  if (processedEditIds.has(data.editId)) {
                    console.log('[file_edit] Skipping duplicate:', data.editId);
                    break;
                  }
                  processedEditIds.add(data.editId);
                  console.log('[file_edit] Processing new edit:', data.editId, 'All processed:', [...processedEditIds]);

                  // Note: RelativePosition is now calculated on the server side
                  // The server handles position tracking via WebSocket
                  // Frontend just uses the line numbers from the server directly

                  // Two tracks:
                  // 1. allBlocks - blocks for all diffs, used for pending-edits storage
                  // 2. blocks - blocks generated in this AI run, used for session display
                  const blocksForStore = data.allBlocks || data.blocks;  // For pending edits
                  const blocksForDisplay = data.blocks;  // For session display

                  // Add edit to store (store handles smart merge internally)
                  // Use allBlocks to save to pending edits
                  storeAddEdit({
                    filePath: data.filePath,
                    projectId: projectId,
                    blocks: blocksForStore,
                    description: data.description,
                  });

                  // Collect action to items (preserves order with messages)
                  const firstBlock = blocksForDisplay[0];
                  const actionItem: SessionAction = {
                    type: "edit_file",
                    filePath: data.filePath,
                    lineRange: firstBlock ? { start: firstBlock.startLine, end: firstBlock.endLine } : undefined,
                    updatedSnippet: firstBlock?.updated?.substring(0, 100),
                    blocks: blocksForDisplay,
                    description: data.description,
                  };
                  collectedItemsRef.current.push({ type: "action", action: actionItem });
                  console.log('[DEBUG] file_edit collected, total items:', collectedItemsRef.current.length);

                  // Add to stream events for display
                  // Only display blocks generated in this AI run
                  const editData: PendingFileEdit = {
                    editId: data.editId,
                    filePath: data.filePath,
                    blocks: blocksForDisplay,
                    description: data.description,
                    status: "pending",
                  };

                  setStreamEvents(streamPrev => {
                    // Check if we already have an edit event for this file
                    // If so, update it; otherwise add new event
                    const existingIdx = streamPrev.findIndex(
                      e => e.type === "file_edit" && e.edit?.filePath === data.filePath
                    );

                    if (existingIdx >= 0) {
                      // Update existing event with new edit data
                      console.log('[StreamEvents] Updating existing edit for file:', data.filePath);
                      return streamPrev.map((e, i) =>
                        i === existingIdx && e.type === "file_edit"
                          ? { ...e, edit: editData, id: data.editId }
                          : e
                      );
                    } else {
                      // Add new event
                      console.log('[StreamEvents] Adding new edit:', data.editId);
                      return [...streamPrev, {
                        type: "file_edit" as const,
                        edit: editData,
                        id: data.editId,
                      }];
                    }
                  });

                  onFileEdit?.(data);
                  break;

                // Context management events
                case "token_usage":
                  // Update token usage for progress ring
                  if (data.historyTokens !== undefined) {
                    setHistoryTokens(data.historyTokens);
                  }
                  // Update limit from backend (allows dynamic configuration)
                  if (data.historyLimit !== undefined) {
                    setHistoryLimit(data.historyLimit);
                  }
                  break;

                case "history_compressed":
                  // AI server compressed the history - update session
                  console.log('[history_compressed] Updating session with compressed history');
                  setHistoryTokens(data.tokensAfter || 0);

                  // Call API to update session's compressedHistory
                  const sessionIdForUpdate = currentSessionIdRef.current;
                  if (sessionIdForUpdate && data.compressedHistory) {
                    fetch('/api/chat/history', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        projectId,
                        sessionId: sessionIdForUpdate,
                        compressedHistory: data.compressedHistory,
                        historyTokens: data.tokensAfter,
                      }),
                    }).catch(err => {
                      console.error('[history_compressed] Failed to update session:', err);
                    });
                  }
                  break;

                // Plan-and-Execute events
                case "error":
                  const err = { code: data.code, message: data.message };
                  setError(err);
                  onError?.(err);
                  break;

                case "done":
                  // Update session ID (for new sessions)
                  if (data.conversationId && !currentSessionIdRef.current) {
                    setCurrentSessionId(data.conversationId);
                    currentSessionIdRef.current = data.conversationId;
                    // Add new session to local list (avoid reload which causes UI flicker)
                    // Use LLM-generated title if available, otherwise fallback
                    const sessionTitle = data.title || (message.slice(0, 50) + (message.length > 50 ? "..." : ""));
                    const newSession: SessionSummary = {
                      id: data.conversationId,
                      title: sessionTitle,
                      messageCount: 2, // user + assistant
                      createdAt: Date.now(),
                      updatedAt: Date.now(),
                    };
                    setSessions(prev => [newSession, ...prev]);
                  }

                  // Build complete message with collected items
                  console.log('[DEBUG] done event - collectedItems:', collectedItemsRef.current.length);

                  // IMPORTANT: Clear streamEvents FIRST to avoid double rendering
                  // (messageHistory + streamEvents showing same content)
                  setStreamEvents([]);
                  setCurrentMessage("");

                  if (collectedItemsRef.current.length > 0) {
                    const fullMessage: ChatMessage = {
                      id: currentMessageIdRef.current || Date.now().toString(),
                      role: "assistant",
                      items: [...collectedItemsRef.current],  // Copy to avoid mutation
                      timestamp: new Date(),
                      references: collectedReferences,
                    };

                    console.log('[DEBUG] Adding to messageHistory:', { id: fullMessage.id, items: fullMessage.items?.length });
                    // Prevent duplicate messages (defensive check)
                    setMessageHistory(prev => {
                      // Check if this message ID already exists
                      if (prev.some(m => m.id === fullMessage.id)) {
                        console.warn('[DEBUG] Duplicate message detected, skipping:', fullMessage.id);
                        return prev;
                      }
                      return [...prev, fullMessage];
                    });
                    onMessage?.(fullMessage);
                  } else {
                    console.log('[DEBUG] Skipping messageHistory update - no items');
                  }

                  onDone?.({
                    conversationId: data.conversationId,
                  });
                  break;
              }
            } catch (e) {
              console.warn("Failed to parse SSE data:", trimmedLine, e);
            }
          }
        }
      }

    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        setMessageHistory(prev => prev.slice(0, -1));
        return;
      }

      const errObj =
        err instanceof ApiError
          ? { code: err.code || "REQUEST_ERROR", message: err.message }
          : { code: "REQUEST_ERROR", message: err instanceof Error ? err.message : t("aiChat.error") };
      setError(errObj);
      onError?.(errObj);

      setMessageHistory(prev => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
      setStatus("");
      abortControllerRef.current = null;

      // Clear vibe locks
      for (const filePath of lockedFilesRef.current) {
        clearVibeLock(projectId, filePath);
      }
      lockedFilesRef.current = [];
    }
  }, [projectId, userId, userName, currentSessionId, resetCurrentRequest, mode, onMessage, onError, onDone, onContext, setVibeLock, clearVibeLock, handleApiError, t]);

  return {
    isLoading,
    isLoadingSessions,
    status,
    currentMessage,
    references,
    contexts,
    error,
    // Stream events - ordered list of text and file edits for display
    streamEvents,
    // Context usage - for progress ring display
    historyTokens,
    historyLimit,
    sessions,
    currentSessionId,
    messageHistory,
    mode,
    setMode,
    // Agent mode: file edits
    pendingEdits,
    applyEdit,
    rejectEdit,
    // Methods
    sendMessage,
    abort,
    loadSessions,
    selectSession,
    createNewSession,
    deleteSession,
  };
}

export default useAsk;
