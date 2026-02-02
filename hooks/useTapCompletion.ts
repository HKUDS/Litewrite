/**
 * TAP completion hook.
 *
 * Manages TAP completion request logic:
 * - Debounced trigger (fires after the user stops typing)
 * - Request deduplication and cancellation
 * - Error handling
 */
import { useCallback, useRef, useEffect, useState } from "react";
import { EditorView } from "@codemirror/view";
import { completionStatus } from "@codemirror/autocomplete";
import { useTranslations } from "@/lib/i18n";
import { ApiError, createApiErrorHandler } from "@/lib/api-error-handler";
import {
  setTapCompletion,
  dismissTapCompletion,
  TapCompletion,
} from "@/components/editor/tap-completion";

/**
 * Extract LaTeX preamble (\documentclass to \begin{document}).
 */
function extractPreamble(content: string): string {
  const match = content.match(/^([\s\S]*?\\begin\{document\})/);
  return match ? match[1] : "";
}

export interface UseTapCompletionOptions {
  /** Whether TAP completion is enabled */
  enabled?: boolean;
  /** Debounce time (ms): how long after typing stops to trigger a request */
  debounceMs?: number;
  /** Minimum prefix length: how many chars before cursor are required to trigger completion */
  minPrefixLength?: number;
  /** Project ID */
  projectId: string;
  /** File ID */
  fileId: string;
}

export interface UseTapCompletionReturn {
  /** Manually trigger a completion request */
  requestCompletion: () => void;
  /** Cancel current completion */
  cancelCompletion: () => void;
  /** Whether a request is in progress */
  isLoading: boolean;
  /** Most recent error */
  error: string | null;
  /** Clear error */
  clearError: () => void;
}

export function useTapCompletion(
  editorView: EditorView | null,
  options: UseTapCompletionOptions
): UseTapCompletionReturn {
  const { t } = useTranslations();
  const handleApiError = createApiErrorHandler(t);

  const {
    enabled = true,
    debounceMs = 400,
    minPrefixLength = 20,
    projectId,
    fileId,
  } = options;

  const [capAiEnabled, setCapAiEnabled] = useState<boolean | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const lastRequestId = useRef(0);
  const abortController = useRef<AbortController | null>(null);

  // Clear debounce timer
  const clearDebounce = useCallback(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }, []);

  // Cancel in-flight request
  const cancelRequest = useCallback(() => {
    if (abortController.current) {
      abortController.current.abort();
      abortController.current = null;
    }
  }, []);

  // Cancel completion
  const cancelCompletion = useCallback(() => {
    clearDebounce();
    cancelRequest();
    setIsLoading(false);

    if (editorView) {
      editorView.dispatch({
        effects: dismissTapCompletion.of(),
      });
    }
  }, [editorView, clearDebounce, cancelRequest]);

  // Load capability flags once (avoid hardcoding secrets on the client).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/internal/capabilities");
        if (!res.ok) {
          if (!cancelled) setCapAiEnabled(null);
          return;
        }
        const caps = await res.json();
        if (!cancelled) setCapAiEnabled(!!caps.aiEnabled);
      } catch {
        if (!cancelled) setCapAiEnabled(null);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const effectiveEnabled = enabled && (capAiEnabled ?? true);

  // Request completion
  const requestCompletion = useCallback(async () => {
    if (!editorView || !effectiveEnabled) return;

    const state = editorView.state;

    // If CodeMirror completion UI is active, skip TAP request
    if (completionStatus(state) === "active") return;

    const cursorPos = state.selection.main.head;
    const docLength = state.doc.length;

    // Check minimum length
    if (cursorPos < minPrefixLength) return;

    // Cancel previous request
    cancelRequest();

    const requestId = ++lastRequestId.current;
    abortController.current = new AbortController();
    setIsLoading(true);
    setError(null);

    try {
      // Read content directly from CodeMirror (avoid Yjs sync latency issues)
      const docContent = state.doc.toString();
      const prefix = docContent.slice(Math.max(0, cursorPos - 500), cursorPos);
      const suffix = docContent.slice(cursorPos, cursorPos + 500);
      const preamble = extractPreamble(docContent);

      const response = await fetch("/api/tap/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          fileId,
          prefix,
          suffix,
          preamble,
        }),
        signal: abortController.current.signal,
      });

      // Ensure this is the latest request
      if (requestId !== lastRequestId.current) {
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw handleApiError(errorData);
      }

      const result = await response.json();

      // Check again that this is still the latest request
      if (requestId !== lastRequestId.current) return;

      // Verify cursor position hasn't changed
      const currentCursorPos = editorView.state.selection.main.head;
      if (currentCursorPos !== cursorPos) return;

      // Set completion
      const hasInsertedText = result.proposed_changes?.inserted_text;
      const hasPrefixDiff = result.proposed_changes?.prefix_diff?.some(
        (s: { op: string }) => s.op !== "equal"
      );

      if (hasInsertedText || hasPrefixDiff) {
        // Compute prefix start offset (we sent the last 500 characters)
        const prefixStart = Math.max(0, cursorPos - 500);

        const completion: TapCompletion = {
          cursorPos,
          insertedText: result.proposed_changes.inserted_text || "",
          prefixDiff: result.proposed_changes.prefix_diff,
          suffixDiff: result.proposed_changes.suffix_diff,
          originalDocLength: docLength,
          prefixStart,
          showTimestamp: Date.now(),
          projectId,
          fileId,
        };

        editorView.dispatch({
          effects: setTapCompletion.of(completion),
        });
      }
    } catch (err) {
      if (err instanceof Error) {
        // Ignore aborted requests
        if (err.name === "AbortError") return;
        setError(err.message);
      } else {
        setError(t("common.error"));
      }
    } finally {
      if (requestId === lastRequestId.current) {
        setIsLoading(false);
      }
    }
  }, [editorView, effectiveEnabled, minPrefixLength, projectId, fileId, cancelRequest]);

  // Listen to editor changes and trigger completion via debounce
  useEffect(() => {
    if (!editorView || !effectiveEnabled) return;

    let lastDocLength = editorView.state.doc.length;

    const handleUpdate = (update: { docChanged: boolean; state: { doc: { length: number } } }) => {
      if (!update.docChanged) return;

      // Trigger only on document changes (not selection-only changes)
      const newDocLength = update.state.doc.length;
      if (newDocLength === lastDocLength) return;
      lastDocLength = newDocLength;

      // Clear previous timer
      clearDebounce();

      // Dismiss any current completion display
      editorView.dispatch({
        effects: dismissTapCompletion.of(),
      });

      // Set new debounce timer
      debounceTimer.current = setTimeout(() => {
        // Check again, since the completion UI may have opened during debounce
        if (completionStatus(editorView.state) === "active") return;
        requestCompletion();
      }, debounceMs);
    };

    const handleInput = () => {
      handleUpdate({
        docChanged: true,
        state: editorView.state,
      });
    };

    const dom = editorView.dom;
    dom.addEventListener("input", handleInput);

    return () => {
      dom.removeEventListener("input", handleInput);
      clearDebounce();
      cancelRequest();
    };
  }, [editorView, effectiveEnabled, debounceMs, requestCompletion, clearDebounce, cancelRequest]);

  // Cleanup
  useEffect(() => {
    return () => {
      clearDebounce();
      cancelRequest();
    };
  }, [clearDebounce, cancelRequest]);

  return {
    requestCompletion,
    cancelCompletion,
    isLoading,
    error,
    clearError: useCallback(() => setError(null), []),
  };
}
