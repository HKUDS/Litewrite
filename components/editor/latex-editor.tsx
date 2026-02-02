"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { EditorView } from "@codemirror/view";
import { EditorToolbar } from "./editor-toolbar";
import { MarkdownToolbar } from "./markdown-toolbar";
import { EditCommandBar } from "./edit-command-bar";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { EditorMode, CollaboratorInfo } from "./collaborative-editor";
import type { ProjectFile } from "@/types";
import type { BibEntry } from "@/lib/bibtex-parser";
import { extractBibEntries } from "@/lib/bibtex-parser";
import { ReferenceSearchPanel } from "./reference-search-panel";
import { useUserSettings } from "@/lib/hooks/use-user-settings";
import { useTranslations } from "@/lib/i18n";

// Font family mapping
const fontFamilyMap: Record<string, string> = {
  jetbrains: '"JetBrains Mono"',
  fira: '"Fira Code"',
  "sf-mono": '"SF Mono"',
  consolas: 'Consolas',
  monaco: 'Monaco',
  "source-code": '"Source Code Pro"',
};

interface LatexEditorProps {
  content: string;
  onChange: (content: string) => void;
  projectId: string;
  fileId: string;
  fileName?: string;  // Actual file name (for display when copying)
  mode?: EditorMode;
  // Version restore: used to force collaborative editor to reset to current content
  restoreToken?: number;
  onCollaboratorsChange?: (collaborators: CollaboratorInfo[]) => void;
  // When fileId changes due to switching/renaming, whether to prefill the editor with initialContent
  // before connecting to the collaboration room. This avoids a brief UI empty "flash".
  prefillOnConnect?: boolean;
  // TAP completion
  enableTapCompletion?: boolean;
  tapDebounceMs?: number;
  // SyncTeX jump target (backward sync)
  targetLine?: number;
  targetToLineEnd?: boolean;         // Whether to jump to end of line
  targetWord?: string;               // Word selected by double-click
  targetContextBefore?: string;      // Context before the word
  targetContextAfter?: string;       // Context after the word
  onTargetLineReached?: () => void;
  // SyncTeX forward sync (editor → PDF)
  onForwardSync?: (line: number) => void;
  // Editor ready callback
  onEditorReady?: (view: EditorView | null) => void;
  // Cursor line change callback (used for outline sync)
  onCursorLineChange?: (line: number) => void;
  // Project files (for reference search)
  files?: ProjectFile[];
}

// Collaborative editor component type
type EditorComponentType = React.ComponentType<{
  initialContent?: string;
  restoreToken?: number;
  onContentChange?: (content: string) => void;
  onCollaboratorsChange?: (collaborators: CollaboratorInfo[]) => void;
  projectId: string;
  fileId: string;
  fileName?: string;
  mode?: EditorMode;
  prefillOnConnect?: boolean;
  userId?: string;
  userName?: string;
  userImage?: string;
  enableTapCompletion?: boolean;
  tapDebounceMs?: number;
  targetLine?: number;
  targetToLineEnd?: boolean;
  targetWord?: string;
  targetContextBefore?: string;
  targetContextAfter?: string;
  onTargetLineReached?: () => void;
  onForwardSync?: (line: number) => void;
  onEditorReady?: (view: EditorView | null) => void;
  onCursorLineChange?: (line: number) => void;
  // Citation autocomplete
  referenceEntries?: BibEntry[];
  onOpenReferenceSearch?: () => void;
  // Connection status callback
  onConnectionStatusChange?: (status: { isConnected: boolean; isTapLoading: boolean; tapError: string | null }) => void;
}>;

export function LatexEditor({
  content,
  onChange,
  projectId,
  fileId,
  fileName,
  mode = "latex",
  restoreToken,
  onCollaboratorsChange,
  prefillOnConnect = false,
  enableTapCompletion = false,
  tapDebounceMs = 1000,
  targetLine,
  targetToLineEnd,
  targetWord,
  targetContextBefore,
  targetContextAfter,
  onTargetLineReached,
  onForwardSync,
  onEditorReady,
  onCursorLineChange,
  files = [],
}: LatexEditorProps) {
  const { t } = useTranslations("editor");
  const [isLoading, setIsLoading] = useState(true);
  const [EditorComponent, setEditorComponent] = useState<EditorComponentType | null>(null);
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const [referenceSearchOpen, setReferenceSearchOpen] = useState(false);
  const { data: session } = useSession();

  // User settings
  const { settings } = useUserSettings();

  // Editor style variables
  const editorStyleVars = useMemo(() => ({
    "--editor-font-size": `${settings.fontSize}px`,
    "--editor-font-family": fontFamilyMap[settings.fontFamily] || fontFamilyMap.jetbrains,
  } as React.CSSProperties), [settings.fontSize, settings.fontFamily]);

  // Connection status
  const [connectionStatus, setConnectionStatus] = useState({
    isConnected: false,
    isTapLoading: false,
    tapError: null as string | null,
  });

  // Extract all citation entries from project files (for autocomplete)
  const referenceEntries = useMemo(() => {
    return extractBibEntries(files);
  }, [files]);

  // EditorView ready callback - set internal state and notify externally
  const handleEditorReady = useCallback((view: EditorView | null) => {
    setEditorView(view);
    // Notify parent when editor is ready
    if (view) {
      onEditorReady?.(view);
    }
  }, [onEditorReady]);

  // Handle reference selection - insert into editor
  const handleReferenceSelect = useCallback((key: string) => {
    // Close the dialog first
    setReferenceSearchOpen(false);

    // Delay insertion to ensure the dialog is fully closed
    setTimeout(() => {
      if (editorView) {
        const { from, to } = editorView.state.selection.main;

        // Check whether we're inside \cite{}.
        // Use content from the line start to cursor position (instead of a fixed 20-char lookback)
        // so we can handle citation keys of any length.
        const line = editorView.state.doc.lineAt(from);
        const beforeCursor = editorView.state.doc.sliceString(line.from, from);
        const doc = editorView.state.doc.toString();
        const afterCursor = doc.slice(to, Math.min(doc.length, to + 10));

        // Match \cite{, \citep{, \citet{ and other citation commands
        const citeMatch = beforeCursor.match(/\\cite[a-z]*\{([^}]*)$/);
        const closingBrace = afterCursor.indexOf("}");

        let insertText: string;
        let insertFrom = from;
        let insertTo = to;

        if (citeMatch && closingBrace >= 0) {
          // Inside \cite{}
          const existingContent = citeMatch[1]; // Content between \cite{ and cursor
          const lastCommaIndex = existingContent.lastIndexOf(',');

          // Find text after cursor until next comma or closing brace
          // This handles the case when cursor is in the middle of a key
          const afterMatch = afterCursor.match(/^([^,}]*)/);
          const textAfterCursor = afterMatch ? afterMatch[1] : '';
          insertTo = to + textAfterCursor.length;

          if (lastCommaIndex >= 0) {
            // There are complete keys before the last comma
            // Replace the partial text after the last comma with the new key
            const textAfterComma = existingContent.substring(lastCommaIndex + 1);
            insertFrom = from - textAfterComma.length;
            insertText = ` ${key}`;
          } else {
            // No comma - replace all content (partial key) with the new key
            insertFrom = from - existingContent.length;
            insertText = key;
          }
        } else {
          // Not inside \cite{} - insert a full \cite{key}
          insertText = `\\cite{${key}}`;
        }

        editorView.dispatch({
          changes: { from: insertFrom, to: insertTo, insert: insertText },
          selection: { anchor: insertFrom + insertText.length },
        });

        // Ensure the editor regains focus
        editorView.focus();
      }
    }, 50);
  }, [editorView]);

  // Listen for a keyboard shortcut to open reference search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + Shift + Space opens reference search
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "Space") {
        e.preventDefault();
        setReferenceSearchOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    // Dynamically import the editor (avoid SSR issues)
    import("./collaborative-editor").then((module) => {
      setEditorComponent(() => module.CollaborativeEditor as EditorComponentType);
      setIsLoading(false);
    });
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>{t("loadingEditor")}</span>
        </div>
      </div>
    );
  }

  if (EditorComponent) {
    // Show different toolbars depending on the mode
    const showLatexToolbar = mode === "latex";
    const showMarkdownToolbar = mode === "markdown";

    return (
      <TooltipProvider>
        <div className="relative flex h-full flex-col">
          {showLatexToolbar && <EditorToolbar editorView={editorView} isConnected={connectionStatus.isConnected} onOpenReferenceSearch={() => setReferenceSearchOpen(true)} />}
          {showMarkdownToolbar && <MarkdownToolbar editorView={editorView} />}
          <div className="relative flex-1 overflow-hidden">
            <EditorComponent
              projectId={projectId}
              fileId={fileId}
              fileName={fileName}
              initialContent={content}
              restoreToken={restoreToken}
              onContentChange={onChange}
              onCollaboratorsChange={onCollaboratorsChange}
              mode={mode}
              prefillOnConnect={prefillOnConnect}
              userId={session?.user?.id}
              userName={session?.user?.name || session?.user?.email || undefined}
              userImage={session?.user?.image || undefined}
              enableTapCompletion={enableTapCompletion}
              tapDebounceMs={tapDebounceMs}
              targetLine={targetLine}
              targetToLineEnd={targetToLineEnd}
              targetWord={targetWord}
              targetContextBefore={targetContextBefore}
              targetContextAfter={targetContextAfter}
              onTargetLineReached={onTargetLineReached}
              onForwardSync={onForwardSync}
              onEditorReady={handleEditorReady}
              onCursorLineChange={onCursorLineChange}
              referenceEntries={referenceEntries}
              onOpenReferenceSearch={() => setReferenceSearchOpen(true)}
              onConnectionStatusChange={setConnectionStatus}
            />
            {/* Edit Command Bar - positioned inside editor */}
            <EditCommandBar />
          </div>
          {/* Reference search panel */}
          <ReferenceSearchPanel
            isOpen={referenceSearchOpen}
            onClose={() => {
              setReferenceSearchOpen(false);
              // Restore editor focus after closing
              setTimeout(() => editorView?.focus(), 50);
            }}
            onSelect={handleReferenceSelect}
            files={files}
          />
        </div>
      </TooltipProvider>
    );
  }

  return null;
}
