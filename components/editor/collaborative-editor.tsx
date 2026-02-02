"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { EditorState, Compartment, StateField, StateEffect } from "@codemirror/state";
import {
  EditorView,
  keymap,
  highlightSpecialChars,
  drawSelection,
  highlightActiveLine,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  lineNumbers,
  highlightActiveLineGutter,
  Decoration,
  type DecorationSet,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  indentOnInput,
  bracketMatching,
  foldKeymap,
  syntaxHighlighting,
  StreamLanguage,
} from "@codemirror/language";
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
  startCompletion,
  acceptCompletion,
  type Completion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import {
  createCustomSearchExtensions,
  searchPanelState,
  toggleSearchPanelEffect,
} from "./search-extensions";
import { SearchPanel } from "./search-panel";
import { lintKeymap } from "@codemirror/lint";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { latexHighlightStyleLight } from "./latex-highlight-theme";
import * as Y from "yjs";
import { createMarkdownExtensions, createMarkdownAutocomplete } from "./markdown-extensions";
import { yCollab } from "y-codemirror.next";
import { WebsocketProvider } from "y-websocket";
import { getUserColorById, generateUserColor, generateUserName } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { useTranslations } from "@/lib/i18n";
import { toast } from "sonner";
import { useVibeLockStore } from "@/stores/vibe-lock-store";
import {
  createTapCompletionExtensions,
  dismissTapCompletion,
  remoteUpdateAnnotation,
} from "./tap-completion";
import { useTapCompletion } from "@/hooks/useTapCompletion";
import { useUserSettings } from "@/lib/hooks/use-user-settings";
import { createCitationAutocomplete, createLabelAutocomplete } from "./citation-autocomplete";
import { createLatexFoldGutter, latexFoldService } from "./latex-fold";
import {
  createLatexPreviewExtension,
  projectIdField,
  setProjectIdEffect,
} from "./latex-formula-tooltip";
import { getInlineDiffExtensions, setCurrentFile, setCurrentFileEffect, setYjsRefs as setInlineDiffYjsRefs, setPendingEditsEffect } from "./inline-diff-extension";
import { useEditStore, type PendingEdit } from "@/stores/edit-store";
import type { PendingLockInfo, EditBlock, EditLock } from "@/types/ask";
import type { BibEntry } from "@/lib/bibtex-parser";
import {
  getLockExtensions,
  setOwnLocks,
  setRemoteLocks,
  setLockFile,
  setCurrentUserId,
  setLockYjsRefs,
} from "./pending-edit-lock-extension";
import { syncTexLogger } from "@/lib/synctex-logger";

// Font family mapping
const fontFamilyMap: Record<string, string> = {
  jetbrains: '"JetBrains Mono"',
  fira: '"Fira Code"',
  "sf-mono": '"SF Mono"',
  consolas: 'Consolas',
  monaco: 'Monaco',
  "source-code": '"Source Code Pro"',
};

// LaTeX formatting commands
function formatBold(view: EditorView): boolean {
  return wrapSelection(view, "\\textbf{", "}");
}

function formatItalic(view: EditorView): boolean {
  return wrapSelection(view, "\\textit{", "}");
}

function formatUnderline(view: EditorView): boolean {
  return wrapSelection(view, "\\underline{", "}");
}

function wrapSelection(view: EditorView, prefix: string, suffix: string): boolean {
  const { state } = view;
  const selection = state.selection.main;

  if (selection.empty) {
    // If nothing is selected, insert an empty wrapper and place cursor inside.
    const insertPos = selection.from;
    view.dispatch({
      changes: { from: insertPos, insert: prefix + suffix },
      selection: { anchor: insertPos + prefix.length },
    });
  } else {
    // If text is selected, wrap it with the formatting command.
    const selectedText = state.sliceDoc(selection.from, selection.to);
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: prefix + selectedText + suffix },
      selection: { anchor: selection.from + prefix.length, head: selection.from + prefix.length + selectedText.length },
    });
  }
  return true;
}

export type EditorMode = "latex" | "markdown";

export interface CollaboratorInfo {
  name: string;
  color: string;
  id?: string;
  image?: string; // User avatar URL
}

interface CollaborativeEditorProps {
  projectId: string;
  fileId: string;
  fileName?: string;  // Actual filename (used for copy UI)
  initialContent?: string;
  // Version restore: when triggered, force-reset the collaborative Yjs doc to initialContent.
  // This prevents the editor from rehydrating old content via WS/Redis after storage restore.
  restoreToken?: number;
  onContentChange?: (content: string) => void;
  onCollaboratorsChange?: (collaborators: CollaboratorInfo[]) => void;
  wsUrl?: string;
  mode?: EditorMode;
  // When fileId changes (especially rename), prefill local Yjs with initialContent before
  // joining the collaborative room to avoid a brief empty UI.
  // NOTE: This writes initialContent as a local update into the room (safe when the backend
  // has already cleaned legacy Yjs data for the target fileId).
  prefillOnConnect?: boolean;
  // User identity (real logged-in user)
  userId?: string;
  userName?: string;
  userImage?: string; // User avatar URL
  // TAP completion config
  enableTapCompletion?: boolean;
  tapDebounceMs?: number;
  // SyncTeX jump target (reverse sync)
  targetLine?: number;
  targetToLineEnd?: boolean;         // Jump to line end (used for pending-edits navigation)
  targetWord?: string;               // Double-click selected word
  targetContextBefore?: string;      // Context before the word (for exact matching)
  targetContextAfter?: string;       // Context after the word (for exact matching)
  onTargetLineReached?: () => void;
  // SyncTeX forward sync (editor -> PDF)
  onForwardSync?: (line: number) => void;
  // EditorView ready callback (toolbar, etc.)
  onEditorReady?: (view: EditorView | null) => void;
  // Cursor line change callback (outline sync)
  onCursorLineChange?: (line: number) => void;
  // Citation autocomplete
  referenceEntries?: BibEntry[];
  onOpenReferenceSearch?: () => void;
  // Connection status callback
  onConnectionStatusChange?: (status: { isConnected: boolean; isTapLoading: boolean; tapError: string | null }) => void;
}

type TranslateFunction = (key: string, params?: Record<string, string | number>) => string;

// LaTeX autocomplete with smart template insertion

// Helper: create a completion item with cursor positioning
function createCompletion(
  label: string,
  type: string,
  info: string,
  template: string,
  cursorOffset: number // Offset backward from the end of inserted text
): Completion {
  return {
    label,
    type,
    info,
    apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
      view.dispatch({
        changes: { from, to, insert: template },
        selection: { anchor: from + template.length - cursorOffset },
      });
    },
  };
}

// Helper: create environment completion (\\begin{env}...\\end{env})
function createEnvCompletion(
  label: string,
  envName: string,
  info: string,
  innerContent: string = ""
): Completion {
  const template = `\\begin{${envName}}\n${innerContent}\n\\end{${envName}}`;
  const cursorOffset = `\n\\end{${envName}}`.length + (innerContent ? 0 : 0);
  return {
    label,
    type: "function",
    info,
    apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
      view.dispatch({
        changes: { from, to, insert: template },
        selection: { anchor: from + `\\begin{${envName}}\n`.length + innerContent.length },
      });
    },
  };
}

function createLatexCompletions(t: TranslateFunction): Completion[] {
  const info = (key: string) => t(`latexCompletion.${key}`);

  return [
    // Document structure commands
    createCompletion("\\documentclass", "keyword", info("documentClass"), "\\documentclass{article}", 1),
    createCompletion("\\usepackage", "keyword", info("usePackage"), "\\usepackage{}", 1),
    createCompletion("\\title", "keyword", info("title"), "\\title{}", 1),
    createCompletion("\\author", "keyword", info("author"), "\\author{}", 1),
    createCompletion("\\date", "keyword", info("date"), "\\date{}", 1),
    { label: "\\maketitle", type: "keyword", info: info("makeTitle") },
    { label: "\\tableofcontents", type: "keyword", info: info("tableOfContents") },

    // Sectioning commands
    createCompletion("\\part", "keyword", info("part"), "\\part{}", 1),
    createCompletion("\\chapter", "keyword", info("chapter"), "\\chapter{}", 1),
    createCompletion("\\section", "keyword", info("section"), "\\section{}", 1),
    createCompletion("\\subsection", "keyword", info("subsection"), "\\subsection{}", 1),
    createCompletion("\\subsubsection", "keyword", info("subsubsection"), "\\subsubsection{}", 1),
    createCompletion("\\paragraph", "keyword", info("paragraph"), "\\paragraph{}", 1),

    // Environments
    createEnvCompletion("\\begin{document}", "document", info("documentBody")),
    createEnvCompletion("\\begin{equation}", "equation", info("equationEnv")),
    createEnvCompletion("\\begin{equation*}", "equation*", info("equationNoNum")),
    createEnvCompletion("\\begin{align}", "align", info("alignEnv")),
    createEnvCompletion("\\begin{align*}", "align*", info("alignNoNum")),
    createEnvCompletion("\\begin{itemize}", "itemize", info("itemizeEnv"), "  \\item "),
    createEnvCompletion("\\begin{enumerate}", "enumerate", info("enumerateEnv"), "  \\item "),
    createEnvCompletion("\\begin{figure}", "figure", info("figureEnv"), "  \\centering\n  \\includegraphics[width=0.8\\textwidth]{}\n  \\caption{}\n  \\label{fig:}"),
    createEnvCompletion("\\begin{table}", "table", info("tableEnv"), "  \\centering\n  \\caption{}\n  \\begin{tabular}{|c|c|c|}\n    \\hline\n    & & \\\\\n    \\hline\n  \\end{tabular}\n  \\label{tab:}"),
    createEnvCompletion("\\begin{abstract}", "abstract", info("abstractEnv")),
    createEnvCompletion("\\begin{center}", "center", info("centerEnv")),
    createEnvCompletion("\\begin{quote}", "quote", info("quoteEnv")),
    createEnvCompletion("\\begin{verbatim}", "verbatim", info("verbatimEnv")),
    createEnvCompletion("\\begin{minipage}", "minipage", info("minipageEnv")),

    // Citations and labels
    createCompletion("\\cite", "function", info("cite"), "\\cite{}", 1),
    createCompletion("\\ref", "function", info("ref"), "\\ref{}", 1),
    createCompletion("\\eqref", "function", info("eqref"), "\\eqref{}", 1),
    createCompletion("\\label", "function", info("label"), "\\label{}", 1),
    createCompletion("\\pageref", "function", info("pageref"), "\\pageref{}", 1),

    // Text formatting
    createCompletion("\\textbf", "function", info("textbf"), "\\textbf{}", 1),
    createCompletion("\\textit", "function", info("textit"), "\\textit{}", 1),
    createCompletion("\\underline", "function", info("underline"), "\\underline{}", 1),
    createCompletion("\\emph", "function", info("emph"), "\\emph{}", 1),
    createCompletion("\\texttt", "function", info("texttt"), "\\texttt{}", 1),
    createCompletion("\\textsc", "function", info("textsc"), "\\textsc{}", 1),

    // Math commands
    createCompletion("\\frac", "function", info("frac"), "\\frac{}{}", 3),
    createCompletion("\\sqrt", "function", info("sqrt"), "\\sqrt{}", 1),
    createCompletion("\\sqrt[n]", "function", info("sqrtN"), "\\sqrt[]{}", 3),
    { label: "\\sum", type: "function", info: info("sum") },
    { label: "\\prod", type: "function", info: info("prod") },
    { label: "\\int", type: "function", info: info("int") },
    { label: "\\iint", type: "function", info: info("iint") },
    { label: "\\iiint", type: "function", info: info("iiint") },
    { label: "\\oint", type: "function", info: info("oint") },
    { label: "\\lim", type: "function", info: info("lim") },
    { label: "\\infty", type: "function", info: info("infty") },
    { label: "\\partial", type: "function", info: info("partial") },
    { label: "\\nabla", type: "function", info: info("nabla") },
    createCompletion("\\left(", "function", info("leftParen"), "\\left( \\right)", 8),
    createCompletion("\\left[", "function", info("leftBracket"), "\\left[ \\right]", 8),
    createCompletion("\\left\\{", "function", info("leftBrace"), "\\left\\{ \\right\\}", 10),

    // Greek letters
    { label: "\\alpha", type: "variable", info: "α" },
    { label: "\\beta", type: "variable", info: "β" },
    { label: "\\gamma", type: "variable", info: "γ" },
    { label: "\\delta", type: "variable", info: "δ" },
    { label: "\\epsilon", type: "variable", info: "ε" },
    { label: "\\zeta", type: "variable", info: "ζ" },
    { label: "\\eta", type: "variable", info: "η" },
    { label: "\\theta", type: "variable", info: "θ" },
    { label: "\\iota", type: "variable", info: "ι" },
    { label: "\\kappa", type: "variable", info: "κ" },
    { label: "\\lambda", type: "variable", info: "λ" },
    { label: "\\mu", type: "variable", info: "μ" },
    { label: "\\nu", type: "variable", info: "ν" },
    { label: "\\xi", type: "variable", info: "ξ" },
    { label: "\\pi", type: "variable", info: "π" },
    { label: "\\rho", type: "variable", info: "ρ" },
    { label: "\\sigma", type: "variable", info: "σ" },
    { label: "\\tau", type: "variable", info: "τ" },
    { label: "\\upsilon", type: "variable", info: "υ" },
    { label: "\\phi", type: "variable", info: "φ" },
    { label: "\\chi", type: "variable", info: "χ" },
    { label: "\\psi", type: "variable", info: "ψ" },
    { label: "\\omega", type: "variable", info: "ω" },

    // Figures / images
    createCompletion("\\includegraphics", "function", info("includegraphics"), "\\includegraphics[width=0.8\\textwidth]{}", 1),
    createCompletion("\\caption", "function", info("caption"), "\\caption{}", 1),

    // Links
    createCompletion("\\href", "function", info("href"), "\\href{}{}", 3),
    createCompletion("\\url", "function", info("url"), "\\url{}", 1),

    // Footnotes and margin notes
    createCompletion("\\footnote", "function", info("footnote"), "\\footnote{}", 1),
    createCompletion("\\marginpar", "function", info("marginpar"), "\\marginpar{}", 1),
  ];
}

function createLatexAutocomplete(t: TranslateFunction) {
  const latexCompletions = createLatexCompletions(t);

  return (context: CompletionContext) => {
    const word = context.matchBefore(/\\[a-zA-Z{}\[\]*]*/);
    if (!word || word.text.length < 1) return null;

    const query = word.text.toLowerCase();
    const options = latexCompletions.filter((c) =>
      c.label.toLowerCase().startsWith(query)
    );

    return {
      from: word.from,
      options,
      validFor: /^\\[a-zA-Z{}\[\]*]*$/,
    };
  };
}

// SyncTeX highlight effects - highlight a specific word range (without triggering highlightSelectionMatches)
const addSyncTexHighlight = StateEffect.define<{ from: number; to: number }>();
const clearSyncTexHighlight = StateEffect.define<null>();

const syncTexHighlightMark = Decoration.mark({ class: "synctex-word-highlight" });

const syncTexHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(addSyncTexHighlight)) {
        decorations = Decoration.none.update({
          add: [syncTexHighlightMark.range(effect.value.from, effect.value.to)],
        });
      } else if (effect.is(clearSyncTexHighlight)) {
        decorations = Decoration.none;
      }
    }
    return decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// Enhanced LaTeX highlight theme
// Use the light theme as default; dark theme adapts via CSS variables.
const latexHighlightStyle = latexHighlightStyleLight;

// Editor theme - use CSS variables to support dynamic font settings
const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "var(--editor-font-size, 14px)",
  },
  ".cm-content": {
    fontFamily: 'var(--editor-font-family, "JetBrains Mono"), "Fira Code", monospace',
    padding: "16px 0",
  },
  ".cm-line": {
    padding: "0 16px",
  },
  ".cm-gutters": {
    backgroundColor: "hsl(var(--background))",
    borderRight: "1px solid hsl(var(--border))",
    color: "hsl(var(--muted-foreground))",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "hsl(var(--accent))",
  },
  ".cm-activeLine": {
    backgroundColor: "hsl(var(--accent) / 0.5)",
  },
  ".cm-cursor": {
    borderLeftColor: "hsl(var(--primary))",
    borderLeftWidth: "2px",
  },
  ".cm-matchingBracket": {
    backgroundColor: "hsl(var(--primary) / 0.3)",
    outline: "1px solid hsl(var(--primary))",
  },
  ".cm-tooltip": {
    backgroundColor: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "6px",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "hsl(var(--accent)) !important",
    color: "hsl(var(--foreground)) !important", // Force foreground color to match other items
  },
  // Yjs collaborator cursor styles
  ".cm-ySelectionInfo": {
    position: "absolute",
    top: "-1.4em",
    left: "-1px",
    fontSize: "11px",
    fontFamily: "var(--font-geist-sans)",
    padding: "2px 6px",
    borderRadius: "4px",
    color: "white",
    whiteSpace: "nowrap",
    userSelect: "none",
    pointerEvents: "none",
    zIndex: 10,
  },
  ".cm-yLineSelection": {
    mixBlendMode: "multiply",
  },
});

export function CollaborativeEditor({
  projectId,
  fileId,
  fileName,
  initialContent = "",
  restoreToken,
  onContentChange,
  onCollaboratorsChange,
  wsUrl,
  mode = "latex",
  prefillOnConnect = false,
  userId,
  userName,
  userImage,
  enableTapCompletion = false,
  tapDebounceMs = 1000,
  targetLine,
  targetToLineEnd = false,
  targetWord,
  targetContextBefore,
  targetContextAfter,
  onTargetLineReached,
  onForwardSync,
  onEditorReady,
  onCursorLineChange,
  referenceEntries = [],
  onOpenReferenceSearch,
  onConnectionStatusChange,
}: CollaborativeEditorProps) {
  const { t } = useTranslations("editor");
  const { t: tRoot } = useTranslations();
  // Get WebSocket URL: prefer props, then env, then default
  const effectiveWsUrl = wsUrl || process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:1234";
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const onCollaboratorsChangeRef = useRef(onCollaboratorsChange);
  const referenceEntriesRef = useRef(referenceEntries);
  const onOpenReferenceSearchRef = useRef(onOpenReferenceSearch);
  const tRef = useRef(t);
  const tRootRef = useRef(tRoot);
  const editableCompartmentRef = useRef<Compartment | null>(null);
  const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [editorReady, setEditorReady] = useState<EditorView | null>(null);
  const [isSynced, setIsSynced] = useState(false);

  // User settings
  const { settings } = useUserSettings();

  // Search panel state
  const [searchOpen, setSearchOpen] = useState(false);
  const [showReplace, setShowReplace] = useState(false);

  // Reset search panel state on file switch
  // Avoid React state being out of sync with the new editor's CodeMirror searchPanelState.
  useEffect(() => {
    setSearchOpen(false);
    setShowReplace(false);
  }, [fileId]);

  // TAP completion hook
  const { isLoading: isTapLoading, error: tapError } = useTapCompletion(
    editorReady,
    {
      enabled: enableTapCompletion,
      debounceMs: tapDebounceMs,
      projectId,
      fileId,
    }
  );

  // Vibe Lock: check whether current file is locked
  const vibeLock = useVibeLockStore((state) => state.getFileLock(projectId, fileId));
  const setVibeLock = useVibeLockStore((state) => state.setLock);
  const isVibeLocked = !!vibeLock;
  const vibeLockedByOther = isVibeLocked && vibeLock?.userId !== userId;

  // Track remote vibe locks from Awareness
  const [remoteVibeLock, setRemoteVibeLock] = useState<{
    userName: string;
    userId: string;
  } | null>(null);

  // Combined lock state: local or remote
  const effectiveVibeLock = vibeLock || (remoteVibeLock ? {
    ...remoteVibeLock,
    filePath: fileId,
    projectId,
    lockedAt: Date.now(),
  } : null);
  const isEffectivelyLocked = !!effectiveVibeLock;
  const lockedByOther = isEffectivelyLocked && effectiveVibeLock?.userId !== userId;

  // Keep refs up to date
  useEffect(() => {
    onCollaboratorsChangeRef.current = onCollaboratorsChange;
    referenceEntriesRef.current = referenceEntries;
    onOpenReferenceSearchRef.current = onOpenReferenceSearch;
    tRef.current = t;
    tRootRef.current = tRoot;
  }, [onCollaboratorsChange, referenceEntries, onOpenReferenceSearch, t, tRoot]);

  // Notify parent when EditorView is ready
  useEffect(() => {
    onEditorReady?.(editorReady);
  }, [editorReady, onEditorReady]);

  // Notify parent when connection status changes
  useEffect(() => {
    onConnectionStatusChange?.({
      isConnected,
      isTapLoading,
      tapError,
    });
  }, [isConnected, isTapLoading, tapError, onConnectionStatusChange]);

  // Sync local vibe lock to Yjs Awareness (broadcast to other users)
  useEffect(() => {
    const provider = providerRef.current;
    if (!provider) return;

    // Set vibeWriting field in awareness
    // If we have a local lock on this file, broadcast it
    // If not, clear the vibeWriting field
    if (vibeLock && vibeLock.filePath === fileId) {
      provider.awareness.setLocalStateField("vibeWriting", fileId);
    } else {
      provider.awareness.setLocalStateField("vibeWriting", null);
    }
  }, [vibeLock, fileId]);

  // Vibe Lock: disable editor input (prevents typing even if cursor stays inside the editor)
  useEffect(() => {
    const view = editorViewRef.current;
    const compartment = editableCompartmentRef.current;
    if (!view || !compartment) return;

    // Disable when locked; restore when unlocked
    view.dispatch({
      effects: compartment.reconfigure(EditorView.editable.of(!isEffectivelyLocked)),
    });
  }, [isEffectivelyLocked]);

  // Handle SyncTeX jump target line (reverse sync)
  // Must wait for Yjs sync; otherwise after a file switch doc.lines may be 1 (empty doc).
  useEffect(() => {
    if (targetLine && editorViewRef.current && isSynced) {
      const view = editorViewRef.current;
      const doc = view.state.doc;

      // Clamp line number into valid range
      const lineNumber = Math.min(Math.max(1, targetLine), doc.lines);
      const line = doc.line(lineNumber);
      const lineText = line.text;

      const wordInfo = targetWord ? `"${targetWord}"` : "(none)";
      const contextInfo = (targetContextBefore || targetContextAfter) ? ", with context" : "";
      syncTexLogger.log("Jump to line " + lineNumber + ", word: " + wordInfo + contextInfo);

      // Default cursor position: start of line, or end of line if targetToLineEnd is true
      let selectionStart = targetToLineEnd ? line.to : line.from;
      let selectionEnd = targetToLineEnd ? line.to : line.from;
      let foundWord = false;

      // Normalize text: collapse whitespace for similarity matching
      const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

      // Compute similarity between two strings (0-1) based on edit distance
      const calculateSimilarity = (str1: string, str2: string): number => {
        const s1 = normalize(str1);
        const s2 = normalize(str2);
        if (s1 === s2) return 1;
        if (s1.length === 0 || s2.length === 0) return 0;

        // Use a simplified edit-distance similarity
        const len1 = s1.length;
        const len2 = s2.length;
        const maxLen = Math.max(len1, len2);

        // Build edit-distance matrix (rolling array to save memory)
        let prev = Array.from({ length: len2 + 1 }, (_, i) => i);
        let curr = new Array(len2 + 1);

        for (let i = 1; i <= len1; i++) {
          curr[0] = i;
          for (let j = 1; j <= len2; j++) {
            const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            curr[j] = Math.min(
              prev[j] + 1,      // delete
              curr[j - 1] + 1,  // insert
              prev[j - 1] + cost // replace
            );
          }
          [prev, curr] = [curr, prev];
        }

        const distance = prev[len2];
        return 1 - distance / maxLen;
      };

      // Find best match position with a sliding window
      const findBestMatch = (text: string, pattern: string, wordOffset: number, wordLen: number): { index: number; similarity: number } | null => {
        const patternLen = pattern.length;
        syncTexLogger.log("findBestMatch: text length=" + text.length + ", pattern length=" + patternLen);
        if (patternLen === 0 || text.length === 0) return null;

        let bestIndex = -1;
        let bestSimilarity = 0;
        const similarityThreshold = 0.45; // Lower threshold to tolerate PDF extraction differences (e.g. missing spaces)

        // Sliding window search
        // Allow larger window variance (±15) because PDF extraction may miss/add spaces
        const windowVariance = Math.max(15, Math.floor(patternLen * 0.3)); // At least ±15, or 30% of pattern length

        for (let i = 0; i <= text.length - Math.min(patternLen / 2, wordLen); i++) {
          // Try different window lengths
          const minWindowLen = Math.max(wordLen, patternLen - windowVariance);
          const maxWindowLen = patternLen + windowVariance;

          for (let windowLen = minWindowLen; windowLen <= maxWindowLen && i + windowLen <= text.length; windowLen++) {
            const window = text.substring(i, i + windowLen);
            const similarity = calculateSimilarity(window, pattern);
            if (similarity > bestSimilarity && similarity >= similarityThreshold) {
              bestSimilarity = similarity;
              bestIndex = i;
            }
          }
        }

        return bestIndex >= 0 ? { index: bestIndex, similarity: bestSimilarity } : null;
      };

      // Case-insensitive indexOf
      const indexOfIgnoreCase = (text: string, search: string): number => {
        return text.toLowerCase().indexOf(search.toLowerCase());
      };

      // Find a whole word in text (word-boundary match, case-insensitive)
      const findWholeWord = (text: string, word: string): number => {
        // First try word-boundary regex match (case-insensitive)
        try {
          const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          // Use negative lookbehind/lookahead: previous/next cannot be a letter; add 'i' flag for case-insensitive
          const regex = new RegExp(`(?<![a-zA-Z])${escapedWord}(?![a-zA-Z])`, 'i');
          const match = regex.exec(text);
          if (match) {
            return match.index;
          }
        } catch (e) {
          // Fallback when regex fails
        }
        // If word-boundary match fails, fall back to indexOfIgnoreCase
        return indexOfIgnoreCase(text, word);
      };

      // Search for the word in a given line (context match + similarity match)
      const searchInLine = (searchLine: { from: number; text: string }, searchLineNum: number, word: string): { start: number; end: number } | null => {
        const searchLineText = searchLine.text;
        const searchPattern = (targetContextBefore || '') + word + (targetContextAfter || '');

        // 1) Exact full-pattern match: before + word + after
        const patternIndex = indexOfIgnoreCase(searchLineText, searchPattern);
        if (patternIndex !== -1) {
          const wordStartInPattern = (targetContextBefore || '').length;
          const wordIndex = patternIndex + wordStartInPattern;
          syncTexLogger.log(`Found exact context match in line ${searchLineNum}`);
          return { start: searchLine.from + wordIndex, end: searchLine.from + wordIndex + word.length };
        }

        // 2) Partial context match: before + word
        if (targetContextBefore) {
          const beforePattern = targetContextBefore + word;
          const beforeIndex = indexOfIgnoreCase(searchLineText, beforePattern);
          if (beforeIndex !== -1) {
            const wordIndex = beforeIndex + targetContextBefore.length;
            syncTexLogger.log(`Found match with before context in line ${searchLineNum}`);
            return { start: searchLine.from + wordIndex, end: searchLine.from + wordIndex + word.length };
          }
        }

        // 3) Partial context match: word + after
        if (targetContextAfter) {
          const afterPattern = word + targetContextAfter;
          const afterIndex = indexOfIgnoreCase(searchLineText, afterPattern);
          if (afterIndex !== -1) {
            syncTexLogger.log(`Found match with after context in line ${searchLineNum}`);
            return { start: searchLine.from + afterIndex, end: searchLine.from + afterIndex + word.length };
          }
        }

        // 4) Similarity match
        const wordOffset = (targetContextBefore || '').length;
        const bestMatch = findBestMatch(searchLineText, searchPattern, wordOffset, word.length);
        if (bestMatch) {
          const matchedRegion = searchLineText.substring(bestMatch.index, bestMatch.index + searchPattern.length + 10);

          // 4.1 Use wordOffset to calculate position (consistent with exact match logic)
          // This ensures we find the target word, not a duplicate in the context
          const expectedWord = matchedRegion.substring(wordOffset, wordOffset + word.length);
          if (expectedWord.toLowerCase() === word.toLowerCase()) {
            syncTexLogger.log(`Found similarity match (${(bestMatch.similarity * 100).toFixed(0)}%) in line ${searchLineNum}`);
            return { start: searchLine.from + bestMatch.index + wordOffset, end: searchLine.from + bestMatch.index + wordOffset + word.length };
          }

          // 4.2 Word-boundary fallback (if the word isn't at the expected position due to fuzzy matching)
          const wordIndexInRegion = findWholeWord(matchedRegion, word);
          if (wordIndexInRegion !== -1) {
            syncTexLogger.log(`Found similarity fallback match in line ${searchLineNum}`);
            return { start: searchLine.from + bestMatch.index + wordIndexInRegion, end: searchLine.from + bestMatch.index + wordIndexInRegion + word.length };
          }

        }

        return null;
      };

      // If targetWord is provided, search and position cursor on it
      if (targetWord && targetWord.length > 0) {
        // Search in current line first
        const result = searchInLine(line, lineNumber, targetWord);

        if (result) {
          selectionStart = result.start;
          selectionEnd = result.end;
          foundWord = true;
        } else {
          // Not found in current line; search within ±1 line
          for (let offset = 1; offset <= 1 && !foundWord; offset++) {
            for (const delta of [-offset, offset]) {
              const nearbyLineNum = lineNumber + delta;
              if (nearbyLineNum >= 1 && nearbyLineNum <= doc.lines) {
                const nearbyLine = doc.line(nearbyLineNum);
                const nearbyResult = searchInLine(nearbyLine, nearbyLineNum, targetWord);

                if (nearbyResult) {
                  selectionStart = nearbyResult.start;
                  selectionEnd = nearbyResult.end;
                  foundWord = true;
                  syncTexLogger.log(`Found in nearby line ${nearbyLineNum} (offset ${delta})`);
                  break;
                }
              }
            }
          }

          if (!foundWord) {
            syncTexLogger.log("Context match failed in line " + lineNumber + " and nearby ±1 lines");

            // Last resort: search the word directly in the SyncTeX line
            const directWordIndex = findWholeWord(line.text, targetWord);
            if (directWordIndex !== -1) {
              selectionStart = line.from + directWordIndex;
              selectionEnd = line.from + directWordIndex + targetWord.length;
              foundWord = true;
              syncTexLogger.log(`Found direct word match (no context) in line ${lineNumber}`);
            }
          }
        }
      }

      // Scroll to target. Place cursor after the word (avoid selecting it, which would trigger
      // highlightSelectionMatches and highlight all occurrences). Also apply SyncTeX highlight
      // until the next jump.
      const effects: StateEffect<unknown>[] = [
        EditorView.scrollIntoView(selectionEnd, { y: "center" }),
        // Clear previous highlight
        clearSyncTexHighlight.of(null),
      ];

      if (foundWord) {
        // Add word highlight
        effects.push(addSyncTexHighlight.of({ from: selectionStart, to: selectionEnd }));
      }

      view.dispatch({
        selection: { anchor: selectionEnd },  // Place cursor after the word
        effects,
      });

      // Focus editor
      view.focus();

      // Notify parent that the jump completed
      if (onTargetLineReached) {
        onTargetLineReached();
      }

      const selectedInfo = foundWord ? ', selected "' + targetWord + '"' : (targetToLineEnd ? ", cursor at line end" : ", cursor at line start");
      syncTexLogger.log("Scrolled to line " + lineNumber + selectedInfo);
    }
  }, [targetLine, targetToLineEnd, targetWord, targetContextBefore, targetContextAfter, onTargetLineReached, isSynced]);

  // Store onForwardSync callback in a ref (used by CodeMirror extensions)
  const onForwardSyncRef = useRef(onForwardSync);
  useEffect(() => {
    onForwardSyncRef.current = onForwardSync;
  }, [onForwardSync]);

  // Store onCursorLineChange callback in a ref (outline sync)
  const onCursorLineChangeRef = useRef(onCursorLineChange);
  useEffect(() => {
    onCursorLineChangeRef.current = onCursorLineChange;
  }, [onCursorLineChange]);

  // Initialize editor and Yjs
  useEffect(() => {
    if (!editorContainerRef.current) return;

    // Reset sync state on file switch
    setIsSynced(false);

    // Create Yjs document
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;

    // Get Y.Text for the editor
    const ytext = ydoc.getText("content");

    // UX: prefill local content before joining the room to avoid a brief blank editor.
    // Useful when renaming an open file: the backend has cleared legacy Yjs data for the
    // new fileId, so prefill won't mix in stale content.
    if (prefillOnConnect && ytext.length === 0 && initialContent) {
      ydoc.transact(() => {
        if (ytext.length === 0) {
          ytext.insert(0, initialContent);
        }
      });
    }

    // Create WebSocket provider
    const roomName = `${projectId}-${fileId}`;
    const provider = new WebsocketProvider(effectiveWsUrl, roomName, ydoc);
    providerRef.current = provider;

    // Set user identity (prefer real user info passed via props)
    const userColor = userId ? getUserColorById(userId) : generateUserColor();
    const displayName = userName || generateUserName();
    provider.awareness.setLocalStateField("user", {
      name: displayName,
      color: userColor,
      colorLight: userColor + "33",
      id: userId,
      image: userImage, // User avatar
    });

    // Track whether initial content has been applied
    let contentInitialized = false;

    // Wait for sync before deciding whether to initialize content
    const handleSync = (synced: boolean) => {
      if (synced && !contentInitialized) {
        contentInitialized = true;
        // Only initialize when server-side content is empty
        if (ytext.length === 0 && initialContent) {
          ytext.insert(0, initialContent);
        }
        // Mark sync complete; allow SyncTeX jumps
        setIsSynced(true);
      }
    };

    // Listen to sync state
    provider.on("sync", handleSync);

    // If already synced, handle immediately
    if (provider.synced) {
      handleSync(true);
    }

    // Listen to connection status
    provider.on("status", ({ status }: { status: string }) => {
      setIsConnected(status === "connected");
    });

    // Track collaborators and vibe lock state
    const updateCollaboratorsAndLocks = () => {
      const states = provider.awareness.getStates();
      const users: CollaboratorInfo[] = [];
      let foundRemoteLock: { userName: string; userId: string } | null = null;

      states.forEach((state) => {
        if (state.user) {
          users.push({
            name: state.user.name,
            color: state.user.color,
            id: state.user.id,
            image: state.user.image, // User avatar
          });

          // Check if this user has a vibe lock on current file
          if (state.vibeWriting === fileId && state.user.id !== userId) {
            foundRemoteLock = {
              userName: state.user.name,
              userId: state.user.id,
            };
          }
        }
      });

      setCollaborators(users);
      setRemoteVibeLock(foundRemoteLock);
      onCollaboratorsChangeRef.current?.(users);
    };

    provider.awareness.on("change", updateCollaboratorsAndLocks);
    updateCollaboratorsAndLocks();

    // Create CodeMirror editor
    const languageCompartment = new Compartment();
    const editableCompartment = new Compartment();
    editableCompartmentRef.current = editableCompartment;

    // Choose language extensions based on mode
    const languageExtensions = mode === "markdown"
      ? createMarkdownExtensions()
      : [
          StreamLanguage.define(stex),
          syntaxHighlighting(latexHighlightStyle),
        ];

    // LaTeX hover/cursor live preview (formulas, tables, images)
    const latexPreviewExtensions = mode === "latex"
      ? createLatexPreviewExtension(projectId, tRef.current)
      : [];

    // Choose autocomplete based on mode.
    // Create citation autocomplete (use refs to always read the latest entries)
    const citationAutocomplete = createCitationAutocomplete(
      () => referenceEntriesRef.current,
      () => onOpenReferenceSearchRef.current?.()
    );
    const labelAutocomplete = createLabelAutocomplete();

    const autocompleteConfig = mode === "markdown"
      ? { override: [createMarkdownAutocomplete(tRootRef.current)], activateOnTyping: true }
      : {
          override: [citationAutocomplete, labelAutocomplete, createLatexAutocomplete(tRootRef.current)],
          activateOnTyping: true,
          activateOnTypingDelay: 100,
        };

    // Add a sticky footer to citation autocomplete UI
    const citationFooterPlugin = EditorView.updateListener.of((update) => {
      if (mode !== "latex") return;

      // Check whether autocomplete tooltip is open
      const tooltip = document.querySelector(".cm-tooltip-autocomplete");
      if (!tooltip) return;

      // Check whether cursor is inside \\cite{...}
      const pos = update.view.state.selection.main.head;
      const line = update.view.state.doc.lineAt(pos);
      const textBefore = line.text.slice(0, pos - line.from);
      const isInCite = /\\(cite[a-z]*|citep|citet)\{[^}]*$/.test(textBefore);

      if (!isInCite) {
        // Remove existing footer
        const existingFooter = tooltip.querySelector(".citation-search-footer");
        if (existingFooter) existingFooter.remove();
        return;
      }

      // Avoid adding footer twice
      if (tooltip.querySelector(".citation-search-footer")) return;

      // Create footer
      const footer = document.createElement("div");
      footer.className = "citation-search-footer";
      footer.style.cssText = `
        padding: 6px 10px;
        border-top: 1px solid hsl(var(--border));
        background: hsl(var(--muted));
        display: flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        font-size: 12px;
        color: hsl(var(--muted-foreground));
        position: sticky;
        bottom: 0;
      `;
      footer.innerHTML = `
        <span style="font-size: 14px;">🔍</span>
        <span>Open advanced reference search</span>
        <kbd style="margin-left: auto; padding: 2px 6px; border-radius: 4px; background: hsl(var(--background)); border: 1px solid hsl(var(--border)); font-size: 10px;">⌃⇧Space</kbd>
      `;
      footer.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpenReferenceSearchRef.current?.();
      });
      footer.addEventListener("mouseover", () => {
        footer.style.background = "hsl(var(--accent))";
        footer.style.color = "hsl(var(--accent-foreground))";
      });
      footer.addEventListener("mouseout", () => {
        footer.style.background = "hsl(var(--muted))";
        footer.style.color = "hsl(var(--muted-foreground))";
      });

      tooltip.appendChild(footer);
    });

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        // LaTeX smart folding (replaces default foldGutter)
        createLatexFoldGutter(),
        latexFoldService,
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(autocompleteConfig),

        // Auto-trigger citation/label autocomplete after commands like \\cite{, \\ref{
        EditorView.inputHandler.of((view, from, to, text) => {
          // Only handle in LaTeX mode
          if (mode !== "latex") return false;

          // When typing '{', check whether it follows \\cite/\\ref/... commands
          if (text === "{") {
            const line = view.state.doc.lineAt(from);
            const textBefore = line.text.slice(0, from - line.from);
            // Match \\cite/\\citep/\\citet/\\ref/\\eqref/... etc.
            if (/\\(cite[a-z]*|citep|citet|ref|eqref|pageref|autoref)$/.test(textBefore)) {
              // Delay trigger (wait for closeBrackets to insert '}')
              setTimeout(() => startCompletion(view), 10);
            }
          }
          return false; // Return false to let default handling continue
        }),

        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),

        // SyncTeX highlight extension (highlights a specific word range)
        syncTexHighlightField,

        // Citation autocomplete footer
        citationFooterPlugin,

        // Line wrapping
        EditorView.lineWrapping,

        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          ...lintKeymap,
          // Prefer accepting completion on Tab; otherwise indent
          { key: "Tab", run: acceptCompletion },
          indentWithTab,
        ]),

        // LaTeX formatting shortcuts (Ctrl/Cmd+B/I/U)
        keymap.of([
          { key: "Mod-b", run: formatBold, preventDefault: true },
          { key: "Mod-i", run: formatItalic, preventDefault: true },
          { key: "Mod-u", run: formatUnderline, preventDefault: true },
        ]),

        // Custom search extensions (replace default search panel)
        ...createCustomSearchExtensions(),

        languageCompartment.of(languageExtensions),
        ...latexPreviewExtensions,
        editorTheme,

        // Editable state control (used by Vibe Lock)
        editableCompartment.of(EditorView.editable.of(true)),

        // Yjs collaboration extension
        yCollab(ytext, provider.awareness),

        // TAP completion extensions
        ...(enableTapCompletion ? createTapCompletionExtensions() : []),

        // Agent inline diff extensions
        ...getInlineDiffExtensions(),

        // Lock extensions for pending edits (own + remote)
        ...getLockExtensions(),

        // Content change listeners
        EditorView.updateListener.of((update) => {
          if (update.docChanged && onContentChange) {
            onContentChange(update.state.doc.toString());
          }
          // Watch selection changes and report current line number
          if (update.selectionSet && onCursorLineChangeRef.current) {
            const pos = update.state.selection.main.head;
            const line = update.state.doc.lineAt(pos).number;
            onCursorLineChangeRef.current(line);
          }
          // Watch search panel state changes
          for (const tr of update.transactions) {
            for (const effect of tr.effects) {
              if (effect.is(toggleSearchPanelEffect)) {
                setSearchOpen(effect.value.open);
                if (effect.value.showReplace !== undefined) {
                  setShowReplace(effect.value.showReplace);
                }
              }
            }
          }
        }),

        // Ctrl+Click triggers forward SyncTeX (editor -> PDF)
        // Clear SyncTeX highlight on normal clicks or when typing begins
        // Add file path + line number metadata on copy
        EditorView.domEventHandlers({
          click(event, view) {
            if ((event.ctrlKey || event.metaKey) && onForwardSyncRef.current) {
              event.preventDefault();
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos !== null) {
                const line = view.state.doc.lineAt(pos);
                console.log(`[Editor] Forward sync from line ${line.number} (Ctrl+Click)`);
                onForwardSyncRef.current(line.number);
              }
              return true; // Prevent default behavior
            }
            // Clear SyncTeX highlight on normal click
            view.dispatch({
              effects: clearSyncTexHighlight.of(null),
            });
            return false;
          },
          keydown(event, view) {
            // Clear SyncTeX highlight when typing a character (exclude modifier/function keys)
            if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) {
              view.dispatch({
                effects: clearSyncTexHighlight.of(null),
              });
            }
            return false;
          },
          // The copy event is handled via a native DOM listener below
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: editorContainerRef.current,
    });

    editorViewRef.current = view;
    setEditorReady(view);

    // Add a native copy event listener (CodeMirror domEventHandlers copy may not fire)
    const handleCopy = (event: ClipboardEvent) => {
            const selection = view.state.selection.main;
      console.log("[Litewrite Copy] Native copy event triggered, selection:", { empty: selection.empty, from: selection.from, to: selection.to });
      if (selection.empty) return;

            const selectedText = view.state.sliceDoc(selection.from, selection.to);
            const startLine = view.state.doc.lineAt(selection.from);
            const endLine = view.state.doc.lineAt(selection.to);

            // Build metadata object
      // Use passed-in fileName; fall back to parsing from fileId
      const actualFileName = fileName || fileId.split("/").pop() || fileId;
            const metadata = {
              type: "litewrite-selection",
              filePath: fileId,
        fileName: actualFileName,
              startLine: startLine.number,
              endLine: endLine.number,
              startChar: selection.from - startLine.from,
              endChar: selection.to - endLine.from,
              text: selectedText,
              projectId: projectId,
            };

      console.log("[Litewrite Copy] Metadata:", metadata);

            if (event.clipboardData) {
              event.clipboardData.setData("text/plain", selectedText);
        // Embed metadata via text/html
        const escapedText = selectedText
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
        const escapedMetadata = JSON.stringify(metadata)
          .replace(/&/g, "&amp;")
          .replace(/'/g, "&#39;");
        const htmlContent = `<pre data-litewrite-selection='${escapedMetadata}'>${escapedText}</pre>`;
        event.clipboardData.setData("text/html", htmlContent);
        console.log("[Litewrite Copy] HTML content set");
              event.preventDefault();
      }
    };

    editorContainerRef.current?.addEventListener("copy", handleCopy);

    // Handle paste-to-upload images (supports Markdown and LaTeX)
    const handlePaste = async (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;

      // Find image data in clipboard items
      let imageFile: File | null = null;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          imageFile = items[i].getAsFile();
          break;
        }
      }

      if (!imageFile) return;

      // Prevent default paste behavior
      event.preventDefault();

      try {
        // Generate a unique filename
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(2, 8);
        // Handle MIME types like "image/svg+xml" -> "svg", "image/png" -> "png"
        const mimeSubtype = imageFile.type.split("/")[1] || "png";
        const ext = mimeSubtype.split("+")[0];
        const imageName = `pasted-${timestamp}-${randomStr}.${ext}`;
        const imagePath = `images/${imageName}`;

        // Upload image
        const formData = new FormData();
        // Create a new File object with the correct filename
        const renamedFile = new File([imageFile], imageName, { type: imageFile.type });
        formData.append("files", renamedFile);
        formData.append("parentPath", "images");

        const response = await fetch(`/api/projects/${projectId}/files/upload`, {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          console.error("Failed to upload pasted image");
          toast.error(tRef.current("image.uploadFailed"));
          return;
        }

        // Insert different syntax based on mode
        let insertText: string;
        if (mode === "markdown") {
          insertText = `![image](${imagePath})`;
        } else {
          // LaTeX mode
          insertText = `\\includegraphics[width=0.8\\textwidth]{${imagePath}}`;
        }

        // Ensure editor is still mounted (component could unmount during async work)
        const currentView = editorViewRef.current;
        if (!currentView) {
          console.log("[Litewrite Paste] Editor unmounted during paste operation");
          return;
        }

        // Insert text at cursor position
        const selection = currentView.state.selection.main;
        currentView.dispatch({
          changes: { from: selection.from, to: selection.to, insert: insertText },
          selection: { anchor: selection.from + insertText.length },
        });

        console.log(`[Litewrite Paste] Image uploaded and inserted: ${imagePath}`);
      } catch (error) {
        console.error("Error handling pasted image:", error);
        toast.error(tRef.current("image.pasteFailed"));
      }
    };

    editorContainerRef.current?.addEventListener("paste", handlePaste);

    // Set project ID (used by image preview)
    if (projectId) {
      view.dispatch({
        effects: setProjectIdEffect(projectId),
      });
    }

    // Set current file path (used by inline diff)
    view.dispatch({
      effects: setCurrentFileEffect.of(fileId),
    });

    // ===== Lock Region Setup for Collaborative Editing (Line-Based) =====

    // Create Y.Map for storing lock information (shared between users)
    const locksMap = ydoc.getMap<PendingLockInfo>("pendingLocks");

    // Effective user ID
    const effectiveUserId = userId || `anonymous_${Math.random().toString(36).slice(2, 8)}`;

    // Set current user ID for lock filtering
    setCurrentUserId(view, effectiveUserId);

    // Set current file for lock filtering
    setLockFile(view, fileId);

    // Set current user info in edit store
    useEditStore.getState().setCurrentUserInfo(effectiveUserId, displayName, userColor);

    // Initialize edit store from server (load pending edits)
    useEditStore.getState().initializeFromServer(projectId);

    // Update own locks in editor whenever pending edits change
    const updateOwnLocksInEditor = () => {
      const locks = useEditStore.getState().getEditLocks(fileId, effectiveUserId);
      setOwnLocks(view, locks);
    };

    // Subscribe to edit store changes for own locks
    const unsubscribeEditStore = useEditStore.subscribe(() => {
      updateOwnLocksInEditor();
    });

    // Initial update of own locks
    updateOwnLocksInEditor();

    // Sync local locks to Y.Map
    useEditStore.getState().setSyncLocksCallback((locks: PendingLockInfo[]) => {
      // Clear old locks from this user
      const keysToDelete: string[] = [];
      locksMap.forEach((lock, key) => {
        if (lock.userId === effectiveUserId) {
          keysToDelete.push(key);
        }
      });

      ydoc.transact(() => {
        // Delete old locks
        for (const key of keysToDelete) {
          locksMap.delete(key);
        }

        // Add new locks
        for (const lock of locks) {
          locksMap.set(lock.id, lock);
        }
      });

      console.log("[Locks] Synced", locks.length, "locks to Y.Map");
    });

    // Listen for changes in Y.Map and update editor decorations (remote locks only)
    const handleLocksChange = () => {
      const locks: PendingLockInfo[] = [];
      locksMap.forEach((lock) => {
        // Only add locks for the current file (from OTHER users)
        if (lock.userId !== effectiveUserId) {
        if (lock.fileId === fileId || fileId.endsWith(lock.fileId) || lock.fileId.endsWith(fileId)) {
            locks.push(lock);
          }
        }
      });

      console.log("[Locks] Received", locks.length, "remote locks for file", fileId);
      setRemoteLocks(view, locks);
    };

    locksMap.observe(handleLocksChange);

    // Initial load of remote locks
    handleLocksChange();

    // ===== Position Tracking (Diff-Based Architecture) =====
    //
    // Compute line numbers locally via Yjs + RelativePosition (near zero latency).
    //
    // 1) Server stores blocks; each block has startRelPos/endRelPos (CRDT IDs)
    // 2) Frontend caches ydoc/ytext refs
    // 3) When Yjs changes, frontend computes new startLine/endLine from RelPos
    // 4) No server roundtrip is needed.

    // Set Yjs refs in lock extension (for lock positioning)
    setLockYjsRefs(view, ydoc, ytext);

    // Set Yjs refs in edit store (for local line number calculation)
    useEditStore.getState().setYjsRefs(ydoc, ytext, fileId);

    // Set Yjs refs in inline-diff extension (for decoration positioning)
    setInlineDiffYjsRefs(view, ydoc, ytext);

    console.log("[CollaborativeEditor] Initialized for file:", fileId);

    // Update line numbers locally when Yjs document changes (near zero latency)
    const handleYjsChange = () => {
      // Defer via requestAnimationFrame to avoid dispatching during CodeMirror updates
      requestAnimationFrame(() => {
        // Update line numbers in edit-store locally
        useEditStore.getState().updateLineNumbersFromRelPos();

        // Manually trigger inline-diff re-render with the latest edits.
        // This makes inline-diff recompute line numbers via Yjs + RelPos.
        const edits = useEditStore.getState().pendingEdits;
        view.dispatch({
          effects: setPendingEditsEffect.of(edits),
        });
      });
    };

    ytext.observe(handleYjsChange);

    // ===== Apply Callback for Edit Store (Line-Based) =====

    useEditStore.getState().setApplyCallback((filePath: string, blocks: EditBlock[]) => {
      // Only apply if this is the current file
      if (filePath !== fileId && !fileId.endsWith(filePath) && !filePath.endsWith(fileId)) {
        return false;
      }

      const doc = view.state.doc;

      // Sort blocks by startLine descending to apply from bottom to top
      const sortedBlocks = [...blocks].sort((a, b) => b.startLine - a.startLine);

      const changes: Array<{ from: number; to: number; insert: string }> = [];

      for (const block of sortedBlocks) {
        // Validate line numbers
        if (block.startLine < 1 || block.endLine < block.startLine) {
          console.warn(`[ApplyEdit] Invalid line range: ${block.startLine}-${block.endLine}`);
          return false;
        }

        // Clamp to document bounds
        const startLine = Math.min(block.startLine, doc.lines);
        const endLine = Math.min(block.endLine, doc.lines);

        // Convert to offsets
        const from = doc.line(startLine).from;
        const to = doc.line(endLine).to;

        changes.push({
          from,
          to,
          insert: block.updated,
        });
      }

      if (changes.length > 0) {
        view.dispatch({ changes });
        return true;
      }

      return false;
    });

    // Cleanup
    return () => {
      // Clear apply callback and sync locks callback
      useEditStore.getState().setApplyCallback(null);
      useEditStore.getState().setSyncLocksCallback(null);

      // Clear Yjs refs from edit store
      useEditStore.getState().clearYjsRefs();

      // Unsubscribe from edit store
      unsubscribeEditStore();

      // Unobserve ytext changes
      ytext.unobserve(handleYjsChange);

      // Unobserve locks map
      locksMap.unobserve(handleLocksChange);

      // Remove copy and paste event listeners
      editorContainerRef.current?.removeEventListener("copy", handleCopy);
      editorContainerRef.current?.removeEventListener("paste", handlePaste);

      provider.awareness.off("change", updateCollaboratorsAndLocks);
      provider.disconnect();
      provider.destroy();
      ydoc.destroy();
      view.destroy();
      editorViewRef.current = null;
      ydocRef.current = null;
      providerRef.current = null;
      setEditorReady(null);
    };
  }, [projectId, fileId, effectiveWsUrl, mode, userId, userName, userImage, enableTapCompletion]);

  // Version restore: force-reset current file Yjs content to initialContent
  // (syncs to server and overwrites old content).
  const lastRestoreTokenRef = useRef<number | undefined>(0);
  useEffect(() => {
    if (restoreToken === undefined) return;
    if (lastRestoreTokenRef.current === restoreToken) return;
    lastRestoreTokenRef.current = restoreToken;

    const ydoc = ydocRef.current;
    if (!ydoc) return;
    const ytext = ydoc.getText("content");

    // Replace entire content in one transaction to avoid multiple updates
    ydoc.transact(() => {
      if (ytext.length > 0) {
        ytext.delete(0, ytext.length);
      }
      if (initialContent) {
        ytext.insert(0, initialContent);
      }
    }, "version_restore");
  }, [restoreToken, initialContent]);

  // Editor styling
  const editorFontFamily = fontFamilyMap[settings.fontFamily] || fontFamilyMap.jetbrains;

  // Update editor styles when font settings change
  useEffect(() => {
    if (editorContainerRef.current) {
      const cmContent = editorContainerRef.current.querySelector('.cm-content') as HTMLElement;
      const cmEditor = editorContainerRef.current.querySelector('.cm-editor') as HTMLElement;
      if (cmContent) {
        cmContent.style.fontFamily = `${editorFontFamily}, "Fira Code", monospace`;
      }
      if (cmEditor) {
        cmEditor.style.fontSize = `${settings.fontSize}px`;
      }
    }
  }, [settings.fontSize, editorFontFamily]);

  return (
    <div className="relative flex h-full flex-col">
      {/* Search panel */}
      <SearchPanel
        editorView={editorReady}
        isOpen={searchOpen}
        showReplace={showReplace}
        onClose={() => {
          setSearchOpen(false);
          editorReady?.focus();
        }}
        onToggleReplace={() => setShowReplace(prev => !prev)}
      />

      {/* Editor */}
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={editorContainerRef}
          className="h-full w-full bg-background"
        />
        {/* Vibe Lock Overlay - prevent editor interaction */}
        {isEffectivelyLocked && (
          <div className="absolute inset-0 bg-transparent cursor-not-allowed z-10" />
        )}
      </div>

      {/* Vibe Writing Banner */}
      <div
        className={`
          absolute bottom-0 left-0 right-0
          flex items-center gap-2 px-4 py-2
          bg-gradient-to-r from-violet-500/90 to-purple-600/90
          text-white text-sm font-medium
          backdrop-blur-sm
          transition-all duration-300 ease-out
          ${isEffectivelyLocked
            ? "translate-y-0 opacity-100"
            : "translate-y-full opacity-0 pointer-events-none"
          }
        `}
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>
          {lockedByOther
            ? `${effectiveVibeLock?.userName || "Someone"} is vibe writing...`
            : "AI is processing this file..."
          }
        </span>
      </div>
    </div>
  );
}
