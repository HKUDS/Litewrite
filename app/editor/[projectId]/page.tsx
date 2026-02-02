"use client";

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "@/lib/i18n";
import { EditorSidebar } from "@/components/editor/editor-sidebar";
import { LatexEditor } from "@/components/editor/latex-editor";
import { PdfViewer } from "@/components/pdf-viewer/pdf-viewer";
import { MarkdownViewer } from "@/components/markdown-viewer/markdown-viewer";
import { FilePreview } from "@/components/file-preview/file-preview";
import { EditorHeader } from "@/components/layout/editor-header";
import { ResizablePanel } from "@/components/layout/resizable-panel";
import { HistoryView } from "@/components/editor/history-view";
import { AiChat, type ChatMode } from "@/components/editor/ai-chat";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/use-toast";
import { useAutoCompile } from "@/lib/hooks/use-auto-compile";
import { useProjectCollaborators } from "@/lib/hooks/use-project-collaborators";
import { useUserSettings } from "@/lib/hooks/use-user-settings";
import { getApiErrorMessage } from "@/lib/api-error-handler";
import { useEditStore } from "@/stores/edit-store";
import { Loader2 } from "lucide-react";
import { AnimatedLogo } from "@/components/ui/animated-logo";
import type { EditorView } from "@codemirror/view";
import type { ProjectFile, ProjectMeta } from "@/types";
import type { EditorMode, CollaboratorInfo } from "@/components/editor/collaborative-editor";

interface EditorPageProps {
  params: { projectId: string };
}

export default function EditorPage({ params }: EditorPageProps) {
  const { projectId } = params;
  const router = useRouter();
  const { data: session } = useSession();
  const { t: tRoot } = useTranslations();
  const { t, locale } = useTranslations("editor");
  const { t: tDialog } = useTranslations("fileDialog");
  const { t: tApiFile } = useTranslations("apiErrors.file");

  // Project metadata
  const [projectMeta, setProjectMeta] = useState<ProjectMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // State
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [content, setContent] = useState<string>("");
  // Always read the latest content in async callbacks (avoid stale closures)
  const contentRef = useRef<string>("");
  // Renaming the currently open file rebuilds the collaborative editor and may briefly show a blank state.
  // This flag tells the editor to prefill with current content on connect to avoid flicker.
  const [prefillOnConnectFileId, setPrefillOnConnectFileId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [pdfPanelOpen, setPdfPanelOpen] = useState(true);
  const [pdfPanelWidth, setPdfPanelWidth] = useState(() =>
    typeof window !== 'undefined' ? (window.innerWidth - 280) / 2 : 500
  );
  const [fileCollaborators, setFileCollaborators] = useState<CollaboratorInfo[]>([]);
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [restoreToken, setRestoreToken] = useState(0); // Force-reset collaborative editor content (version restore)
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiPanelWidth, setAiPanelWidth] = useState(400);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [activeSidebarTab, setActiveSidebarTab] = useState<"files" | "chat" | "ai-draw">("files");
  const [aiChatMode, setAiChatModeInternal] = useState<ChatMode>("ask");
  const [isAnyPanelResizing, setIsAnyPanelResizing] = useState(false); // Whether any panel is resizing
  const [isToggling, setIsToggling] = useState(false); // Whether a panel is toggling open/collapsed

  // Trigger a short overlay during toggle operations.
  // Use a double requestAnimationFrame to minimize latency: show overlay -> next frame remove -> rerender.
  const triggerToggleOverlay = useCallback(() => {
    setIsToggling(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setIsToggling(false);
      });
    });
  }, []);

  // Whether we should show the overlay
  const shouldShowOverlay = isAnyPanelResizing || isToggling;

  // Handle mode changes
  const handleAiChatModeChange = useCallback((newMode: ChatMode) => {
    setAiChatModeInternal(newMode);
  }, []);

  // Project-level collaborators (top toolbar: show everyone connected to the project)
  const { collaborators: projectCollaborators } = useProjectCollaborators({
    projectId,
    userId: session?.user?.id,
    userName: session?.user?.name || session?.user?.email || undefined,
    userImage: session?.user?.image || undefined,
  });

  // User settings
  const { settings } = useUserSettings();

  // SyncTeX jump target (reverse sync: PDF -> editor)
  const [syncTexTarget, setSyncTexTarget] = useState<{
    file: string;
    line: number;
    clickedWord?: string;
    contextBefore?: string;
    contextAfter?: string;
  } | null>(null);

  // Jump target line (used by pending-edits navigation)
  const [editTargetLine, setEditTargetLine] = useState<number | undefined>();
  // Pending jump target (used to delay jump until after a file switch)
  const pendingSyncTexTargetRef = useRef<{
    file: string;
    line: number;
    clickedWord?: string;
    contextBefore?: string;
    contextAfter?: string;
  } | null>(null);

  // SyncTeX jump target (forward sync: editor -> PDF)
  const [pdfSyncTexTarget, setPdfSyncTexTarget] = useState<{
    page: number;
    x: number;
    y: number;
    h?: number;
    v?: number;
    width?: number;
    height?: number;
  } | null>(null);

  // Current editor cursor line (outline sync)
  const [currentLine, setCurrentLine] = useState<number>(1);

  // Refresh file list
  const refreshFiles = useCallback(async () => {
    try {
      const filesResponse = await fetch(`/api/projects/${projectId}/files`);
      if (filesResponse.ok) {
        const filesData = await filesResponse.json();
        if (filesData.files && filesData.files.length > 0) {
          setFiles(filesData.files);
        }
      }
    } catch (error) {
      console.error("Error refreshing files:", error);
    }
  }, [projectId]);

  // Load project data
  useEffect(() => {
    const loadProject = async () => {
      try {
        setIsLoading(true);
        setLoadError("");

        // Fetch project metadata
        const metaResponse = await fetch(`/api/projects/${projectId}`);
        if (!metaResponse.ok) {
          if (metaResponse.status === 404) {
            throw new Error(t("projectNotFound"));
          }
          throw new Error(t("loadProjectFailed"));
        }
        const metaData = await metaResponse.json();
        setProjectMeta(metaData.project);

        // Fetch project files
        const filesResponse = await fetch(`/api/projects/${projectId}/files`);
        if (filesResponse.ok) {
          const filesData = await filesResponse.json();
          if (filesData.files && filesData.files.length > 0) {
            setFiles(filesData.files);

            // Find and select main file
            const mainFile = findFileByName(filesData.files, metaData.project.mainFile || "main.tex");
            if (mainFile) {
              setSelectedFile(mainFile.id);
              setContent(mainFile.content || "");
            } else if (filesData.files[0]) {
              setSelectedFile(filesData.files[0].id);
              setContent(filesData.files[0].content || "");
            }
          } else {
            // If no files exist, create a default structure
            const defaultFiles = createDefaultFiles(metaData.project.name);
            setFiles(defaultFiles);
            setSelectedFile(defaultFiles[0].id);
            setContent(defaultFiles[0].content || "");
          }
        }
      } catch (err) {
        console.error("Error loading project:", err);
        setLoadError(err instanceof Error ? err.message : t("loadProjectFailed"));
      } finally {
        setIsLoading(false);
      }
    };

    loadProject();
  }, [projectId]);

  // Setup navigate-to-file callback for edit store (cross-file edit navigation)
  useEffect(() => {
    const setNavigateCallback = useEditStore.getState().setNavigateToFileCallback;

    setNavigateCallback((filePath: string, line?: number) => {
      // Find file by path (support both full path and just filename)
      const findByPath = (fileList: ProjectFile[]): ProjectFile | null => {
        for (const file of fileList) {
          // Match by exact path, filename, or if file.id ends with the path
          if (
            file.id === filePath ||
            file.name === filePath ||
            file.id.endsWith(filePath) ||
            filePath.endsWith(file.name)
          ) {
            return file;
          }
          if (file.children) {
            const found = findByPath(file.children);
            if (found) return found;
          }
        }
        return null;
      };

      const targetFile = findByPath(files);
      if (targetFile) {
        setSelectedFile(targetFile.id);
        setContent(targetFile.content || "");
        // Set editor jump target line
        setEditTargetLine(line);
      }
    });

    return () => {
      setNavigateCallback(null);
    };
  }, [files]);

  // Helper: find file by name (supports path matching)
  const findFileByName = (fileList: ProjectFile[], name: string): ProjectFile | null => {
    // Extract filename (handle paths)
    const normalizedName = name.replace(/^\.\//, ''); // Remove leading ./
    const baseName = normalizedName.split('/').pop() || normalizedName; // Get filename

    for (const file of fileList) {
      if (file.type === "file") {
        // Match full name or just filename
        if (file.name === name || file.name === normalizedName || file.name === baseName) {
          return file;
        }
      }
      if (file.children) {
        const found = findFileByName(file.children, name);
        if (found) return found;
      }
    }
    return null;
  };

  // Create default file structure
  // NOTE: id must match API return format (use filename) so the Yjs room name is correct.
  const createDefaultFiles = (projectName: string): ProjectFile[] => {
    // Pick different templates based on locale
    const isChineseLocale = locale === "zh";

    const chineseTemplate = `\\documentclass{article}
\\usepackage{ctex}
\\usepackage{amsmath}
\\usepackage{graphicx}

\\title{${projectName}}
\\author{Author}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}

Start writing here...

\\end{document}`;

    const englishTemplate = `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{graphicx}

\\title{${projectName}}
\\author{Author}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}

Start writing here...

\\end{document}`;

    return [
      {
        id: "main.tex",
        name: "main.tex",
        type: "file",
        content: isChineseLocale ? chineseTemplate : englishTemplate,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
  };

  // Compile hook (manual trigger: button click or Ctrl+S)
  // Auto-save history versions after successful compile (based on user settings)
  const { compileStatus, compileResult, compile, compileProgress, compileStage } = useAutoCompile({
    projectId,
    autoSaveVersion: settings.autoSaveVersion,
  });

  // Get current file
  const findFile = useCallback(
    (id: string, fileList: ProjectFile[] = files): ProjectFile | undefined => {
      for (const file of fileList) {
        if (file.id === id) return file;
        if (file.children) {
          const found = findFile(id, file.children);
          if (found) return found;
        }
      }
      return undefined;
    },
    [files]
  );

  // Handle file selection
  const handleFileSelect = useCallback(
    (fileId: string) => {
      const file = findFile(fileId);
      if (file && file.type === "file") {
        setSelectedFile(fileId);
        setContent(file.content || "");
        // Reset current line to avoid highlighting wrong outline section
        setCurrentLine(1);
        // Clear edit jump target to avoid new file scrolling to an old position
        setEditTargetLine(undefined);
      }
    },
    [findFile]
  );

  // Save file to server (debounced)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const saveFileToServer = useCallback(async (filePath: string, fileContent: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/files`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath, content: fileContent }),
      });
      if (!response.ok) {
        console.error("Failed to save file:", filePath);
      }
    } catch (error) {
      console.error("Error saving file:", error);
    }
  }, [projectId]);

  // Immediately save all changes and trigger compile
  const saveAndCompile = useCallback(async () => {
    // Get current filename
    const currentFile = findFile(selectedFile);
    const filePath = currentFile?.id;

    // If there is content to save, save first
    if (filePath && content) {
      // Clear debounced save timer
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      // Save immediately
      await saveFileToServer(filePath, content);
    }

    // Trigger compile
    compile();
  }, [selectedFile, content, findFile, saveFileToServer, compile]);

  // Ctrl+S / Cmd+S to save and compile
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault(); // Prevent browser default save behavior
        saveAndCompile();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [saveAndCompile]);

  // Handle content changes
  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent);

      // Get current filename
      const currentFile = findFile(selectedFile);
      const filePath = currentFile?.id;

      // Update file content in local state
      const updateFileContent = (
        fileList: ProjectFile[]
      ): ProjectFile[] => {
        return fileList.map((file) => {
          if (file.id === selectedFile) {
            return { ...file, content: newContent, updatedAt: new Date() };
          }
          if (file.children) {
            return { ...file, children: updateFileContent(file.children) };
          }
          return file;
        });
      };
      setFiles(updateFileContent(files));

      // Debounced save to server
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (filePath) {
        const savePath = filePath; // Capture current path to avoid selectedFile changing during async save
        saveTimeoutRef.current = setTimeout(() => {
          saveFileToServer(savePath, newContent);
        }, 1000); // Save after 1s
      }
    },
    [selectedFile, files, findFile, saveFileToServer]
  );

  // Keep contentRef in sync with content (read latest value inside async callbacks)
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Manual compile handler
  const handleCompile = useCallback(() => {
    compile();
  }, [compile]);

  // Handle SyncTeX jumps
  const handleSyncTexJump = useCallback((info: {
    file: string;
    line: number;
    clickedWord?: string;
    contextBefore?: string;
    contextAfter?: string;
  }) => {
    const { file: targetFile, line, clickedWord, contextBefore, contextAfter } = info;
    const wordInfo = clickedWord ? '"' + clickedWord + '"' : "(none)";
    console.log("[SyncTeX] Jump to " + targetFile + ":" + line + ", word: " + wordInfo);
    if (contextBefore || contextAfter) {
      console.log("[SyncTeX] Context: \"" + (contextBefore || "") + "\" [word] \"" + (contextAfter || "") + "\"");
    }

    // Find target file
    const file = findFileByName(files, targetFile);
    if (file) {
      const jumpTarget = { file: targetFile, line, clickedWord, contextBefore, contextAfter };
      // Switch file if needed
      if (file.id !== selectedFile) {
        setSelectedFile(file.id);
        setContent(file.content || "");
        // Store pending target; jump after editor is ready
        pendingSyncTexTargetRef.current = jumpTarget;
      } else {
        // Same file: jump directly
        setSyncTexTarget(jumpTarget);
      }
    } else {
      console.warn("[SyncTeX] File not found: " + targetFile);
    }
  }, [files, selectedFile]);

  // Editor ready callback - handle pending jump target
  const handleEditorReady = useCallback((view: EditorView | null) => {
    // After editor is ready, perform pending jump if any
    if (view && pendingSyncTexTargetRef.current) {
      console.log("[SyncTeX] Editor ready, jumping to pending target:", pendingSyncTexTargetRef.current);
      setSyncTexTarget(pendingSyncTexTargetRef.current);
      pendingSyncTexTargetRef.current = null;
    }
    // Rename-triggered prefill is one-shot: clear flag after new editor instance is ready
    if (view && prefillOnConnectFileId && prefillOnConnectFileId === selectedFile) {
      setPrefillOnConnectFileId(null);
    }
  }, [prefillOnConnectFileId, selectedFile]);

  // SyncTeX jump completion handler
  const handleTargetLineReached = useCallback(() => {
    setSyncTexTarget(null);
  }, []);

  // Forward sync: editor -> PDF (Ctrl+Click line number)
  const handleForwardSync = useCallback(async (line: number) => {
    if (settings.pdfViewer !== "litewrite") {
      console.log("[SyncTeX Forward] Only available in Litewrite mode");
      return;
    }

    // Get current filename
    const currentFile = selectedFile ? files.find(f => f.id === selectedFile) : null;
    if (!currentFile) return;

    const filename = currentFile.name;
    console.log("[SyncTeX Forward] " + filename + ":" + line);

    try {
      const response = await fetch(`/api/projects/${projectId}/synctex`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction: "forward",
          file: filename,
          line: line,
          column: 0,
        }),
      });

      const result = await response.json();

      if (result.success && result.page) {
        console.log("[SyncTeX Forward] Found: page " + result.page, result);
        setPdfSyncTexTarget({
          page: result.page,
          x: result.x || 0,
          y: result.y || 0,
          h: result.h,
          v: result.v,
          width: result.width || result.W,
          height: result.height || result.H,
        });
        // Clear target after jump
        setTimeout(() => setPdfSyncTexTarget(null), 100);
      } else {
        console.log("[SyncTeX Forward] Not found:", result.error);
      }
    } catch (error) {
      console.error("[SyncTeX Forward] Error:", error);
    }
  }, [projectId, selectedFile, files, settings.pdfViewer]);

  // File operations
  const handleCreateFile = useCallback(async (parentId: string | null, name: string, type: "file" | "folder"): Promise<string | void> => {
    try {
      // parentId is the parent path (use '/' as separator)
      const parentPath = parentId || "";

      // Call API to create the actual file/folder
      const response = await fetch(`/api/projects/${projectId}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          type,
          parentPath,
          content: type === "file" ? "" : undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(getApiErrorMessage(data, tRoot, "apiErrors.file.createFailed"));
      }

      // Compute new file id: parentPath + filename (use '/' as separator)
      const newFileId = parentId ? `${parentId}/${name}` : name;

      // Update local state
      const newFile: ProjectFile = {
        id: newFileId,
        name,
        type,
        parentId: parentId || undefined,
        content: type === "file" ? "" : undefined,
        children: type === "folder" ? [] : undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (parentId) {
        const addToParent = (fileList: ProjectFile[]): ProjectFile[] => {
          return fileList.map((file) => {
            if (file.id === parentId) {
              // If parent folder found, append new file into children.
              // If children doesn't exist (empty folder), initialize with an empty array.
              return { ...file, children: [...(file.children || []), newFile] };
            }
            if (file.children) {
              return { ...file, children: addToParent(file.children) };
            }
            return file;
          });
        };
        setFiles(addToParent(files));
      } else {
        setFiles([...files, newFile]);
      }

      // If a file was created, auto-select it and load the editor
      if (type === "file") {
        setSelectedFile(newFileId);
        setContent(""); // New file starts empty
      }

      return newFileId;
    } catch (error) {
      console.error("Error creating file:", error);
      // Re-throw so caller can handle (e.g. show error toast)
      throw error;
    }
  }, [files, projectId]);

  const handleDeleteFile = useCallback(async (fileId: string) => {
    // Save original state for rollback on failure
    const originalFiles = files;
    const originalSelectedFile = selectedFile;
    const originalContent = content;

    try {
      // File id is the path (use '/' as separator)
      const filePath = fileId;

      // Optimistic update: update local state first
      const removeFile = (fileList: ProjectFile[]): ProjectFile[] => {
        return fileList
          .filter((file) => file.id !== fileId)
          .map((file) => {
            if (file.children) {
              return { ...file, children: removeFile(file.children) };
            }
            return file;
          });
      };
      const updatedFiles = removeFile(files);
      setFiles(updatedFiles);

      // If the deleted file is currently selected, switch to another file
      let newSelectedFile = selectedFile;
      let newContent = content;
      if (selectedFile === fileId) {
        // Recursively find any file (including nested files)
        const findFirstFile = (fileList: ProjectFile[]): ProjectFile | null => {
          for (const file of fileList) {
            if (file.type === "file") return file;
            if (file.children) {
              const found = findFirstFile(file.children);
              if (found) return found;
            }
          }
          return null;
        };
        const firstFile = findFirstFile(updatedFiles);
        if (firstFile) {
          newSelectedFile = firstFile.id;
          newContent = firstFile.content || "";
          setSelectedFile(newSelectedFile);
          setContent(newContent);
        } else {
          // No other files left
          newSelectedFile = "";
          newContent = "";
          setSelectedFile("");
          setContent("");
        }
      }

      // Call backend API to delete file
      const response = await fetch(`/api/projects/${projectId}/files?path=${encodeURIComponent(filePath)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        // Roll back local state if request fails
        setFiles(originalFiles);
        setSelectedFile(originalSelectedFile);
        setContent(originalContent);

        const data = await response.json().catch(() => null);
        console.error("Delete failed:", getApiErrorMessage(data, tRoot, "apiErrors.file.deleteFailed"));
        return;
      }

      // Refresh file list after success to fully sync with server
      refreshFiles();
    } catch (error) {
      // Roll back state on exception as well
      setFiles(originalFiles);
      setSelectedFile(originalSelectedFile);
      setContent(originalContent);
      console.error("Error deleting file:", error);
    }
  }, [files, selectedFile, content, projectId, refreshFiles]);

  const handleRenameFile = useCallback(async (fileId: string, newName: string) => {
    // Save original state for rollback on failure
    const originalFiles = files;
    const originalSelectedFile = selectedFile;

    try {
      // File id is the path
      const sourcePath = fileId;
      const oldFileName = sourcePath.split("/").pop() || sourcePath;
      // No-op if name didn't change (avoid backend treating it as a conflict)
      if (newName === oldFileName) {
        return;
      }

      // Compute new path: parent dir of original path + new filename
      const pathParts = sourcePath.split("/");
      pathParts.pop(); // Remove old filename
      const targetPath = pathParts.length > 0 ? pathParts.join("/") : "";
      const newPath = targetPath ? `${targetPath}/${newName}` : newName;

      // If editing current file (or a file under a folder being renamed), cancel any pending debounced save.
      // Otherwise the latest content may be saved to the old path and appear "lost/forked".
      const isAffectingOpenFile = selectedFile === fileId || selectedFile.startsWith(fileId + "/");
      if (isAffectingOpenFile && saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }

      // Optimistic update: update local state (file tree + selection) to avoid UI flicker
      const updateFileName = (fileList: ProjectFile[]): ProjectFile[] => {
        return fileList.map((file) => {
          // Recurse into children first to avoid stale paths in subtree
          const updatedChildren = file.children ? updateFileName(file.children) : undefined;

          if (file.id === sourcePath) {
            // Update file/folder name and id (if folder, also update its children)
            return file.children
              ? { ...file, id: newPath, name: newName, children: updatedChildren }
              : { ...file, id: newPath, name: newName };
          }
          // If current file path starts with sourcePath + '/', it is inside the renamed folder.
          // NOTE: ensure full path prefix matching to avoid partial matches.
          if (file.id.startsWith(sourcePath + "/")) {
            // Update child path: replace prefix
            const relativePath = file.id.slice(sourcePath.length); // Get relative path suffix
            const newFileId = newPath + relativePath;
            // If the child is also a folder, keep updating its children
            return file.children ? { ...file, id: newFileId, children: updatedChildren } : { ...file, id: newFileId };
          }
          if (file.children) {
            return { ...file, children: updatedChildren };
          }
          return file;
        });
      };
      setFiles(updateFileName(files));

      // Call backend API to rename (PATCH implements move/rename).
      // NOTE: selectedFile must only be updated after API completes; otherwise CollaborativeEditor may
      // join the new WebSocket room before backend clears Yjs data at the target path, causing merges/corruption.
      const response = await fetch(`/api/projects/${projectId}/files`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath, targetPath, newName }),
      });

      if (!response.ok) {
        // Roll back local state if request fails
        setFiles(originalFiles);
        // Clear save timeout that may have been scheduled during await
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }
        // Ensure prefillOnConnectFileId stays consistent (clear for safety)
        setPrefillOnConnectFileId(null);

        if (response.status === 409) {
          toast({
            title: tDialog("fileExistsError"),
            description: tApiFile("sameNameExists"),
            variant: "destructive",
          });
          return;
        }
        const data = await response.json().catch(() => ({}));
        console.error("Rename failed:", (data as { error?: string }).error);
        return;
      }

      // Update selectedFile only after API success, ensuring backend has cleared legacy Yjs data at target path.
      // This prevents CollaborativeEditor from merging into stale content when connecting to the new room.
      if (isAffectingOpenFile) {
        if (originalSelectedFile === fileId) {
          setPrefillOnConnectFileId(newPath);
          setSelectedFile(newPath);
        } else if (originalSelectedFile.startsWith(fileId + "/")) {
          const relativePath = originalSelectedFile.slice(fileId.length);
          const nextSelected = newPath + relativePath;
          setPrefillOnConnectFileId(nextSelected);
          setSelectedFile(nextSelected);
        }
      }

      // UX: do not force refreshFiles after rename success (can re-fetch content and blank the editor).
      // We already did an optimistic update; later operations can trigger refreshFiles if needed.

      // If rename affects the open file, persist content to the new path (user may rename and stop typing).
      // NOTE: use contentRef.current to read the latest content and avoid stale closures.
      if (isAffectingOpenFile) {
        const newOpenFilePath =
          originalSelectedFile === fileId ? newPath : newPath + originalSelectedFile.slice(fileId.length);
        await saveFileToServer(newOpenFilePath, contentRef.current);
      }
    } catch (error) {
      // Roll back state on exception as well
      setFiles(originalFiles);
      setSelectedFile(originalSelectedFile);
      // Clear save timeout that may have been scheduled during await
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      // Ensure prefillOnConnectFileId stays consistent
      setPrefillOnConnectFileId(null);
      console.error("Error renaming file:", error);
    }
  }, [projectId, selectedFile, tDialog, tApiFile, files, saveFileToServer]);

  // Move file
  const handleMoveFile = useCallback(async (sourceId: string, targetFolderId: string | null) => {
    // Save original state for rollback on failure
    const originalFiles = files;
    const originalSelectedFile = selectedFile;

    try {
      // File id is the path
      const sourcePath = sourceId;
      const targetPath = targetFolderId || "";

      // Compute new path: target dir + original filename
      const fileName = sourcePath.split("/").pop() || "";
      const newPath = targetPath ? `${targetPath}/${fileName}` : fileName;

      // Optimistic update: update local state first (move node and rewrite subtree id/parentId)
      const isInvalidMoveTarget =
        !!targetFolderId && (targetFolderId === sourcePath || targetFolderId.startsWith(sourcePath + "/"));

      const removeFromTree = (
        fileList: ProjectFile[],
        id: string,
      ): { files: ProjectFile[]; removed?: ProjectFile } => {
        let removed: ProjectFile | undefined;

        const nextFiles = fileList
          .filter((file) => {
            if (file.id === id) {
              removed = file;
              return false;
            }
            return true;
          })
          .map((file) => {
            if (!file.children) return file;
            const result = removeFromTree(file.children, id);
            if (result.removed) removed = result.removed;
            return { ...file, children: result.files };
          });

        return { files: nextFiles, removed };
      };

      const insertIntoTree = (fileList: ProjectFile[], parentId: string | null, node: ProjectFile): ProjectFile[] => {
        if (!parentId) {
          return [...fileList, node];
        }
        return fileList.map((file) => {
          if (file.id === parentId) {
            return { ...file, children: [...(file.children || []), node] };
          }
          if (file.children) {
            return { ...file, children: insertIntoTree(file.children, parentId, node) };
          }
          return file;
        });
      };

      const rewriteSubtreePaths = (node: ProjectFile): ProjectFile => {
        const rewritePath = (path: string) => {
          if (path === sourcePath) return newPath;
          if (path.startsWith(sourcePath + "/")) return newPath + path.slice(sourcePath.length);
          return path;
        };

        const rewrittenId = rewritePath(node.id);
        const rewrittenParentId =
          node.id === sourcePath ? (targetFolderId || undefined) : node.parentId ? rewritePath(node.parentId) : undefined;

        const rewrittenChildren = node.children ? node.children.map(rewriteSubtreePaths) : undefined;

        return {
          ...node,
          id: rewrittenId,
          parentId: rewrittenParentId,
          children: rewrittenChildren,
        };
      };

      let didOptimisticMove = false;
      if (!isInvalidMoveTarget) {
        const { files: filesAfterRemoval, removed } = removeFromTree(files, sourcePath);
        if (removed) {
          const movedNode = rewriteSubtreePaths(removed);
          setFiles(insertIntoTree(filesAfterRemoval, targetFolderId, movedNode));
          didOptimisticMove = true;
        }
      }

      // If moving the selected file (or a folder containing it), update selectedFile
      if (didOptimisticMove) {
        if (selectedFile === sourceId) {
          setSelectedFile(newPath);
        } else if (selectedFile.startsWith(sourceId + "/")) {
          const relativePath = selectedFile.slice(sourceId.length);
          setSelectedFile(newPath + relativePath);
        }
      }

      const response = await fetch(`/api/projects/${projectId}/files`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath, targetPath }),
      });

      if (response.ok) {
        // Refresh file list after successful move
        refreshFiles();
      } else {
        // Roll back local state if request fails
        setFiles(originalFiles);
        setSelectedFile(originalSelectedFile);

        if (response.status === 409) {
          toast({
            title: tDialog("fileExistsError"),
            description: tApiFile("sameNameExists"),
            variant: "destructive",
          });
          return;
        }
        const data = await response.json().catch(() => ({}));
        console.error("Move failed:", (data as { error?: string }).error);
      }
    } catch (error) {
      // Roll back state on exception as well
      setFiles(originalFiles);
      setSelectedFile(originalSelectedFile);
      console.error("Move error:", error);
    }
  }, [projectId, refreshFiles, selectedFile, tDialog, tApiFile, files]);

  // Get editor mode for current file
  const currentEditorMode: EditorMode = useMemo(() => {
    const currentFile = findFile(selectedFile);
    if (!currentFile) return "latex";

    const extension = currentFile.name.split(".").pop()?.toLowerCase();
    if (extension === "md" || extension === "markdown") {
      return "markdown";
    }
    return "latex";
  }, [selectedFile, findFile]);

  // Whether current file is binary (should preview instead of edit)
  const isBinaryFile = useMemo(() => {
    const currentFile = findFile(selectedFile);
    if (!currentFile) return false;

    const extension = currentFile.name.split(".").pop()?.toLowerCase() || "";
    const binaryExtensions = ["pdf", "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "eps"];
    return binaryExtensions.includes(extension);
  }, [selectedFile, findFile]);

  // Get current filename
  const currentFileName = useMemo(() => {
    const currentFile = findFile(selectedFile);
    return currentFile?.name || "";
  }, [selectedFile, findFile]);

  // Handle file-level collaborators changes (people editing the same file)
  const handleCollaboratorsChange = useCallback((newCollaborators: CollaboratorInfo[]) => {
    setFileCollaborators(newCollaborators);
  }, []);

  // Whether the current file is Markdown
  const isMarkdownFile = currentEditorMode === "markdown";

  // Dynamically compute max panel widths (so handles can meet and fully cover editor)
  const HANDLE_WIDTH = 7;
  const COLLAPSED_SIDEBAR_WIDTH = 42;

  // Max sidebar width: window - own handle - PDF panel width - AI panel width
  const sidebarMaxWidth = useMemo(() => {
    if (typeof window === 'undefined') return 500;
    const pdfWidth = pdfPanelOpen ? pdfPanelWidth + HANDLE_WIDTH : HANDLE_WIDTH;
    const aiWidth = aiPanelOpen ? aiPanelWidth + HANDLE_WIDTH : 0;
    return window.innerWidth - HANDLE_WIDTH - pdfWidth - aiWidth;
  }, [pdfPanelOpen, pdfPanelWidth, aiPanelOpen, aiPanelWidth]);

  // Max PDF panel width: window - sidebar width - own handle - AI panel width
  const pdfMaxWidth = useMemo(() => {
    if (typeof window === 'undefined') return 1200;
    const sidebarTotalWidth = sidebarOpen
      ? sidebarWidth + HANDLE_WIDTH
      : COLLAPSED_SIDEBAR_WIDTH + HANDLE_WIDTH;
    const aiWidth = aiPanelOpen ? aiPanelWidth + HANDLE_WIDTH : 0;
    return window.innerWidth - sidebarTotalWidth - HANDLE_WIDTH - aiWidth;
  }, [sidebarOpen, sidebarWidth, aiPanelOpen, aiPanelWidth]);

  // Navigate back to dashboard
  const handleGoHome = useCallback(() => {
    router.push("/dashboard");
  }, [router]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-background">
        <AnimatedLogo
          width={360}
          height={189}
          duration={1.5}
          pauseDuration={500}
        />
        <div className="mt-8 flex gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-litewrite-cyan animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-litewrite-cyan animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-litewrite-teal animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    );
  }

  // Error state
  if (loadError) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="rounded-lg bg-destructive/10 p-6">
            <p className="text-destructive mb-4">{loadError}</p>
            <button
              onClick={handleGoHome}
              className="text-primary hover:underline"
            >
              {t("backToHome")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="editor-page-root flex h-screen flex-col bg-background">
        {/* Top toolbar */}
        <EditorHeader
          projectId={projectId}
          projectName={projectMeta?.name || t("untitledProject")}
          compileStatus={compileStatus}
          onCompile={handleCompile}
          onToggleSidebar={() => {
            if (!sidebarOpen) {
              // AI Draw tab has minWidth 800, so use that when expanding
              setSidebarWidth(activeSidebarTab === "ai-draw" ? 800 : 280);
            }
            setSidebarOpen(!sidebarOpen);
          }}
          onTogglePdfPanel={() => {
            if (!pdfPanelOpen) {
              setPdfPanelWidth((window.innerWidth - 280) / 2);
            }
            setPdfPanelOpen(!pdfPanelOpen);
          }}
          sidebarOpen={sidebarOpen}
          pdfPanelOpen={pdfPanelOpen}
          onGoHome={handleGoHome}
          collaborators={projectCollaborators}
          onToggleHistory={() => setHistoryPanelOpen(!historyPanelOpen)}
          onToggleAiPanel={() => {
            if (!aiPanelOpen) {
              setAiPanelWidth(400);
            }
            setAiPanelOpen(!aiPanelOpen);
          }}
          aiPanelOpen={aiPanelOpen}
          pdfUrl={compileResult?.pdfUrl}
        />

        {/* Main content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar (file tree + chat + AI Draw) */}
          <ResizablePanel
            isOpen={sidebarOpen}
            defaultWidth={sidebarWidth}
            minWidth={activeSidebarTab === "ai-draw" ? 800 : 200}
            maxWidth={sidebarMaxWidth}
            side="left"
            onWidthChange={setSidebarWidth}
            onResizingChange={setIsAnyPanelResizing}
            onToggle={() => {
              triggerToggleOverlay();
              if (!sidebarOpen) {
                // When expanding from collapsed state, restore previous width (stored in sidebarWidth).
                // If current tab is AI Draw, ensure width is at least 800.
                if (activeSidebarTab === "ai-draw" && sidebarWidth < 800) {
                  setSidebarWidth(800);
                }
              }
              setSidebarOpen(!sidebarOpen);
            }}
          >
            <EditorSidebar
              projectId={projectId}
              files={files}
              selectedFile={selectedFile}
              onFileSelect={handleFileSelect}
              onCreateFile={handleCreateFile}
              onDeleteFile={handleDeleteFile}
              onRenameFile={handleRenameFile}
              onMoveFile={handleMoveFile}
              onFilesUploaded={refreshFiles}
              onTabChange={(tab) => {
                setActiveSidebarTab(tab);
                // AI Draw tab has minWidth 800, so ensure width is at least 800
                // Other tabs keep current width
                if (tab === "ai-draw" && sidebarWidth < 800) {
                  setSidebarWidth(800);
                }
              }}
              onToggleOpen={() => {
                triggerToggleOverlay();
                if (!sidebarOpen) {
                  // When expanding from collapsed state, restore previous width (stored in sidebarWidth).
                  // If current tab is AI Draw, ensure width is at least 800.
                  if (activeSidebarTab === "ai-draw" && sidebarWidth < 800) {
                    setSidebarWidth(800);
                  }
                }
                setSidebarOpen(!sidebarOpen);
              }}
              isOpen={sidebarOpen}
              content={content}
              editorMode={currentEditorMode}
              onOutlineNavigate={(line) => {
                // Reuse SyncTeX jump mechanism for outline navigation
                setSyncTexTarget({ file: currentFileName, line });
              }}
              currentLine={currentLine}
            />
          </ResizablePanel>

          {/* Editor area */}
          <div className="relative flex-1 overflow-hidden border-l border-r border-litewrite-cyan/10">
            {isBinaryFile ? (
              <FilePreview
                projectId={projectId}
                filePath={selectedFile}
                fileName={currentFileName}
              />
            ) : (
              <LatexEditor
                content={content}
                onChange={handleContentChange}
                projectId={projectId}
                fileId={selectedFile}
                fileName={currentFileName}
                mode={currentEditorMode}
                restoreToken={restoreToken}
                prefillOnConnect={prefillOnConnectFileId === selectedFile}
                onCollaboratorsChange={handleCollaboratorsChange}
                enableTapCompletion={true}
                tapDebounceMs={1000}
                targetLine={syncTexTarget?.line || editTargetLine}
                targetToLineEnd={!syncTexTarget && !!editTargetLine}
                targetWord={syncTexTarget?.clickedWord}
                targetContextBefore={syncTexTarget?.contextBefore}
                targetContextAfter={syncTexTarget?.contextAfter}
                onTargetLineReached={() => {
                  handleTargetLineReached();
                  setEditTargetLine(undefined);
                }}
                onForwardSync={handleForwardSync}
                onEditorReady={handleEditorReady}
                onCursorLineChange={setCurrentLine}
                files={files}
              />
            )}
            {/* Overlay while resizing/toggling panels */}
            {shouldShowOverlay && (
              <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-10 flex items-center justify-center">
                <div className="text-muted-foreground text-sm">{isToggling ? t("togglingPanel") : t("resizingPanel")}</div>
              </div>
            )}
          </div>

          {/* Preview area: show PDF or Markdown based on file type */}
          <ResizablePanel
            isOpen={pdfPanelOpen}
            defaultWidth={pdfPanelWidth}
            minWidth={200}
            maxWidth={pdfMaxWidth}
            side="right"
            onWidthChange={setPdfPanelWidth}
            onResizingChange={setIsAnyPanelResizing}
            onToggle={() => {
              triggerToggleOverlay();
              setPdfPanelOpen(!pdfPanelOpen);
            }}
            showContentOverlay={shouldShowOverlay}
            overlayText={isToggling ? t("togglingPanel") : t("resizingPanel")}
          >
            {isMarkdownFile ? (
              <MarkdownViewer
                content={content}
                projectId={projectId}
                onLineClick={(line) => {
                  // Reuse SyncTeX jump mechanism for Markdown double-click navigation
                  setSyncTexTarget({ file: currentFileName, line });
                }}
              />
            ) : (
              <PdfViewer
                key={`pdf-viewer-${settings.pdfViewer}`}
                compileStatus={compileStatus}
                compileResult={compileResult}
                onCompile={handleCompile}
                projectId={projectId}
                pdfViewer={settings.pdfViewer as "browser" | "litewrite"}
                onSyncTexJump={handleSyncTexJump}
                syncTexTarget={pdfSyncTexTarget}
                onToggle={() => setPdfPanelOpen(false)}
                compileProgress={compileProgress}
                compileStage={compileStage}
              />
            )}
          </ResizablePanel>

          {/* AI chat panel - alongside PDF preview */}
          <ResizablePanel
            isOpen={aiPanelOpen}
            defaultWidth={aiPanelWidth}
            minWidth={280}
            maxWidth={600}
            side="right"
            hideWhenClosed
            onWidthChange={setAiPanelWidth}
            onResizingChange={setIsAnyPanelResizing}
            onToggle={() => {
              triggerToggleOverlay();
              setAiPanelOpen(!aiPanelOpen);
            }}
          >
            <AiChat
              projectId={projectId}
              mode={aiChatMode}
              onModeChange={handleAiChatModeChange}
            />
          </ResizablePanel>
        </div>

      </div>

      {/* Fullscreen history view */}
      {historyPanelOpen && (
        <HistoryView
          projectId={projectId}
          projectName={projectMeta?.name || t("untitledProject")}
          onClose={() => setHistoryPanelOpen(false)}
          onRestore={async () => {
            // Refresh file list and reload current file content after restore
            try {
              const filesResponse = await fetch(`/api/projects/${projectId}/files`);
              if (filesResponse.ok) {
                const filesData = await filesResponse.json();
                if (filesData.files && filesData.files.length > 0) {
                  setFiles(filesData.files);
                  // Reload content of currently selected file
                  const currentFile = filesData.files.find((f: ProjectFile) => f.id === selectedFile);
                  if (currentFile && currentFile.content !== undefined) {
                    setContent(currentFile.content);
                  } else {
                    // If previously selected file doesn't exist in restored version, select the first available file
                    const firstFile = filesData.files.find((f: ProjectFile) => f.type === "file");
                    if (firstFile) {
                      setSelectedFile(firstFile.id);
                      setContent(firstFile.content || "");
                    } else {
                      // If no file is available, clear selection and content
                      setSelectedFile("");
                      setContent("");
                    }
                  }
                  // Force-reset collaborative editor Yjs content (otherwise old content may rehydrate via WS/Redis).
                  // Must be called after content updates, otherwise it may overwrite the restored version with stale content.
                  setRestoreToken((x) => x + 1);
                }
              }
            } catch (error) {
              console.error("Error refreshing files after restore:", error);
            }
          }}
        />
      )}
    </TooltipProvider>
  );
}
