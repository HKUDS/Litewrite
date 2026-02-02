"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { flushSync } from "react-dom";
import {
  File,
  FileText,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Trash2,
  Edit2,
  FilePlus,
  FolderPlus,
  Upload,
  Loader2,
  Download,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/components/ui/use-toast";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/lib/i18n";
import type { ProjectFile } from "@/types";

interface FileTreeProps {
  files: ProjectFile[];
  selectedFile: string;
  projectId: string;
  onFileSelect: (fileId: string) => void;
  // Return the new file ID for auto-selection
  onCreateFile: (parentId: string | null, name: string, type: "file" | "folder") => Promise<string | void> | string | void;
  onDeleteFile: (fileId: string) => void;
  onRenameFile: (fileId: string, newName: string) => void;
  onMoveFile?: (sourceId: string, targetFolderId: string | null) => void;
  onFilesUploaded?: () => void;
}

export function FileTree({
  files,
  selectedFile,
  projectId,
  onFileSelect,
  onCreateFile,
  onDeleteFile,
  onRenameFile,
  onMoveFile,
  onFilesUploaded,
}: FileTreeProps) {
  const { t } = useTranslations("editor.fileTree");
  const { t: tDialog } = useTranslations("fileDialog");
  const { t: tCommon } = useTranslations("common");
  const { t: tApiFile } = useTranslations("apiErrors.file");

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(["2"]));
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inlineInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Inline create state
  const [inlineCreateMode, setInlineCreateMode] = useState<"file" | "folder" | null>(null);
  const [inlineCreateParentId, setInlineCreateParentId] = useState<string | null>(null);
  const [inlineCreateValue, setInlineCreateValue] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const isCreatingRef = useRef(false); // Prevent concurrent execution

  // Inline rename state
  const [renameFileId, setRenameFileId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameReadyRef = useRef(false); // Whether input is ready (can handle blur)

  // Drag & drop state
  const [draggedFileId, setDraggedFileId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [isDraggingOverRoot, setIsDraggingOverRoot] = useState(false);
  const [isExternalDragOver, setIsExternalDragOver] = useState(false); // External file drag state

  useEffect(() => {
    // Focus guard: prevent focus changes being interrupted
    const focusTimeout = setTimeout(() => {
      if (
        inlineCreateMode &&
        inlineInputRef.current &&
        document.activeElement !== inlineInputRef.current
      ) {
        inlineInputRef.current.focus();
      }
    }, 50); // 50ms to ensure render completes
    return () => clearTimeout(focusTimeout);
  }, [inlineCreateMode, inlineCreateParentId, inlineCreateValue]);

  // Global focus guard
  useEffect(() => {
    const handleFocusChange = (e: FocusEvent) => {
      if (isCreatingRef.current && document.activeElement !== inlineInputRef.current) {
        e.preventDefault();
        e.stopPropagation();
        inlineInputRef.current?.focus();
      }
    };
    document.addEventListener("focus", handleFocusChange, true);
    return () => document.removeEventListener("focus", handleFocusChange, true);
  }, []);

  // Trigger file picker dialog
  const triggerFileInput = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Handle file upload
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      for (let i = 0; i < selectedFiles.length; i++) {
        formData.append("files", selectedFiles[i]);
      }

      const response = await fetch(`/api/projects/${projectId}/files/upload`, {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        onFilesUploaded?.();
      } else {
        const data = await response.json();
        console.error("Upload failed:", data.error);
      }
    } catch (error) {
      console.error("Upload error:", error);
    } finally {
      setIsUploading(false);
      // Clear input to allow uploading the same file again
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [projectId, onFilesUploaded]);

  // Recursively find a file
  const findFileById = useCallback((fileList: ProjectFile[], fileId: string): ProjectFile | null => {
    for (const file of fileList) {
      if (file.id === fileId) return file;
      if (file.children) {
        const found = findFileById(file.children, fileId);
        if (found) return found;
      }
    }
    return null;
  }, []);

  // Handle file download
  const handleDownload = useCallback(async (file: ProjectFile) => {
    if (file.type === "folder") return;

    try {
      // If content is already present (text file), download directly
      if (file.content !== undefined) {
        const blob = new Blob([file.content], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else {
        // For binary files (images, etc.), fetch from server.
        // file.id is the path
        const filePath = file.id;
        const response = await fetch(`/api/projects/${projectId}/assets/${filePath}`);
        if (response.ok) {
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = file.name;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        } else {
          console.error("Failed to download file");
        }
      }
    } catch (error) {
      console.error("Download error:", error);
    }
  }, [projectId]);

  // Get parent ID of a file
  const getParentId = useCallback((fileId: string): string | null => {
    const parts = fileId.split("/");
    if (parts.length <= 1) return null;
    parts.pop();
    return parts.join("/");
  }, []);

  // Check whether a file can be dropped onto target (avoid cycles/no-op moves)
  const canDropFile = useCallback((draggedId: string, targetId: string | null): boolean => {
    // Can't drop onto itself
    if (draggedId === targetId) return false;

    // Can't drop into its own subfolder
    if (targetId && targetId.startsWith(draggedId + "/")) return false;

    // Can't drop into original parent (no actual move)
    const currentParent = getParentId(draggedId);
    if (currentParent === targetId) return false;
    if (currentParent === null && targetId === null) return false;

    return true;
  }, [getParentId]);

  // Drag start
  const handleDragStart = useCallback((e: React.DragEvent, file: ProjectFile) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", file.id);
    setDraggedFileId(file.id);
  }, []);

  // Drag end
  const handleDragEnd = useCallback(() => {
    setDraggedFileId(null);
    setDropTargetId(null);
    setIsDraggingOverRoot(false);
    setIsExternalDragOver(false);
  }, []);

  // Drag enter target
  const handleDragEnter = useCallback((e: React.DragEvent, targetId: string | null) => {
    e.preventDefault();
    e.stopPropagation();

    // Detect external file drag-in
    const hasFiles = e.dataTransfer.types.includes("Files");
    if (hasFiles && !draggedFileId) {
      setIsExternalDragOver(true);
      if (targetId === null) {
        setIsDraggingOverRoot(true);
        setDropTargetId(null);
      } else {
        setDropTargetId(targetId);
        setIsDraggingOverRoot(false);
      }
      return;
    }

    if (draggedFileId && canDropFile(draggedFileId, targetId)) {
      if (targetId === null) {
        setIsDraggingOverRoot(true);
        setDropTargetId(null);
      } else {
        setDropTargetId(targetId);
        setIsDraggingOverRoot(false);
      }
    }
  }, [draggedFileId, canDropFile]);

  // Drag leave target
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Check whether we truly left the element (not entering a child)
    const relatedTarget = e.relatedTarget as Node;
    const currentTarget = e.currentTarget as Node;
    if (!currentTarget.contains(relatedTarget)) {
      setDropTargetId(null);
      setIsDraggingOverRoot(false);
      setIsExternalDragOver(false);
    }
  }, []);

  // Drag over target
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  // Handle external file upload
  const handleExternalFilesUpload = useCallback(async (files: FileList, targetFolderId: string | null) => {
    if (files.length === 0) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append("files", files[i]);
      }
      // If there is a target folder, include parentPath
      if (targetFolderId) {
        formData.append("parentPath", targetFolderId);
      }

      const response = await fetch(`/api/projects/${projectId}/files/upload`, {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        toast({
          title: t("uploadSuccess"),
          description: t("filesUploaded", { count: files.length }),
        });
        onFilesUploaded?.();
      } else {
        if (response.status === 409) {
          toast({
            title: tDialog("fileExistsError"),
            description: tApiFile("sameNameExists"),
            variant: "destructive",
          });
          return;
        }
        const data = await response.json().catch(() => ({}));
        toast({
          title: t("uploadError"),
          description: (data as { error?: string }).error || t("unknownError"),
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Upload error:", error);
      toast({
        title: t("uploadError"),
        description: t("networkError"),
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  }, [projectId, onFilesUploaded, t, tDialog, tApiFile]);

  // Drop handler
  const handleDrop = useCallback((e: React.DragEvent, targetFolderId: string | null) => {
    e.preventDefault();
    e.stopPropagation();

    // Handle external file drop
    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles && droppedFiles.length > 0) {
      handleExternalFilesUpload(droppedFiles, targetFolderId);
      setDraggedFileId(null);
      setDropTargetId(null);
      setIsDraggingOverRoot(false);
      setIsExternalDragOver(false);
      return;
    }

    // Internal file move
    const sourceId = e.dataTransfer.getData("text/plain");
    if (sourceId && canDropFile(sourceId, targetFolderId)) {
      onMoveFile?.(sourceId, targetFolderId);
    }

    setDraggedFileId(null);
    setDropTargetId(null);
    setIsDraggingOverRoot(false);
    setIsExternalDragOver(false);
  }, [canDropFile, onMoveFile, handleExternalFilesUpload]);

  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  // Sort files: folders first, then alphabetical by name
  const sortFiles = useCallback((fileList: ProjectFile[]): ProjectFile[] => {
    return [...fileList].sort((a, b) => {
      // Folders first
      if (a.type === "folder" && b.type !== "folder") return -1;
      if (a.type !== "folder" && b.type === "folder") return 1;
      // Same type: sort by name (case-insensitive)
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  }, []);

  // Start inline create (file/folder)
  const startInlineCreate = useCallback((parentId: string | null, type: "file" | "folder") => {
    // If creating inside a folder, expand it first
    if (parentId) {
      setExpandedFolders(prev => {
        const next = new Set(prev);
        next.add(parentId);
        return next;
      });
    }
    setInlineCreateParentId(parentId);
    setInlineCreateMode(type);
    setInlineCreateValue("");
  }, []);

  // Cancel inline create
  const cancelInlineCreate = useCallback(() => {
    isCreatingRef.current = false;
    setInlineCreateMode(null);
    setInlineCreateParentId(null);
    setInlineCreateValue("");
  }, []);

  // Confirm inline create
  const handleInlineCreate = useCallback(async () => {
    // Prevent concurrent execution (Enter and blur may fire together)
    if (isCreatingRef.current) {
      return;
    }

    const name = inlineCreateValue.trim();
    if (!name || !inlineCreateMode) {
      cancelInlineCreate();
      return;
    }

    isCreatingRef.current = true;
    setIsCreating(true);
    try {
      const result = await onCreateFile(inlineCreateParentId, name, inlineCreateMode);
      // If a file was created and an ID was returned, auto-select it
      if (inlineCreateMode === "file" && result) {
        onFileSelect(result);
      }
    } catch (error) {
      // Handle name conflict errors
      const errorMessage = error instanceof Error ? error.message : "";
      if (errorMessage === "FILE_EXISTS" || errorMessage === "FILE_EXISTS_WITH_SAME_NAME") {
        toast({
          title: tDialog("fileExistsError"),
          description: tDialog("fileExistsErrorDescription"),
          variant: "destructive",
        });
      } else if (errorMessage === "FOLDER_EXISTS" || errorMessage === "FOLDER_EXISTS_WITH_SAME_NAME") {
        toast({
          title: tDialog("folderExistsError"),
          description: tDialog("folderExistsErrorDescription"),
          variant: "destructive",
        });
      } else {
        toast({
          title: tDialog("createError"),
          description: tDialog("createErrorDescription"),
          variant: "destructive",
        });
      }
    } finally {
      isCreatingRef.current = false;
      setIsCreating(false);
      cancelInlineCreate();
    }
  }, [inlineCreateValue, inlineCreateMode, inlineCreateParentId, onCreateFile, onFileSelect, cancelInlineCreate, tDialog]);

  // Inline input key handler
  const handleInlineKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleInlineCreate();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelInlineCreate();
    }
  }, [handleInlineCreate, cancelInlineCreate]);

  // Inline input blur handler
  // Use a delay to avoid conflicts with click events from DropdownMenu, etc.
  const handleInlineBlur = useCallback((e: React.FocusEvent) => {
    // Check whether user clicked a menu button/menu item
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    if (relatedTarget) {
      // If focus moved to a menu-related element, cancel instead of submitting
      const isMenuElement = relatedTarget.closest('[role="menu"]') ||
                           relatedTarget.closest('[data-radix-collection-item]') ||
                           relatedTarget.closest('button');
      if (isMenuElement) {
        cancelInlineCreate();
        return;
      }
    }

    // Delay to give other click handlers time to run
    setTimeout(() => {
      handleInlineCreate();
    }, 100);
  }, [handleInlineCreate, cancelInlineCreate]);

  // Start inline rename
  const startInlineRename = useCallback((fileId: string, currentName: string) => {
    renameReadyRef.current = false; // Reset ready flag
    setRenameFileId(fileId);
    setRenameValue(currentName);
    // Delay focus to ensure input is rendered and DropdownMenu is fully closed
    setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
      // Set ready flag after focus to avoid early blur
      setTimeout(() => {
        renameReadyRef.current = true;
      }, 50);
    }, 100);
  }, []);

  // Do not set ready flag on focus (handled in startInlineRename)
  const handleRenameFocus = useCallback(() => {
    // Handled by nested setTimeout in startInlineRename
  }, []);

  // Cancel inline rename
  const cancelInlineRename = useCallback(() => {
    renameReadyRef.current = false;
    setRenameFileId(null);
    setRenameValue("");
  }, []);

  // Confirm inline rename
  const handleInlineRename = useCallback(() => {
    const newName = renameValue.trim();
    if (!newName || !renameFileId) {
      cancelInlineRename();
      return;
    }
    // If name didn't change, don't send rename request (avoid meaningless 409 conflict toast)
    const currentFile = findFileById(files, renameFileId);
    if (currentFile && currentFile.name === newName) {
      cancelInlineRename();
      return;
    }
    onRenameFile(renameFileId, newName);
    cancelInlineRename();
  }, [renameValue, renameFileId, onRenameFile, cancelInlineRename, files, findFileById]);

  // Blur handler - only run after input becomes ready
  const handleRenameBlur = useCallback(() => {
    // If input isn't ready yet (just opened), ignore blur
    if (!renameReadyRef.current) return;
    handleInlineRename();
  }, [handleInlineRename]);

  // Rename input key handler
  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleInlineRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelInlineRename();
    }
  }, [handleInlineRename, cancelInlineRename]);

  const getFileIcon = (file: ProjectFile, isExpanded: boolean) => {
    if (file.type === "folder") {
      return isExpanded ? (
        <FolderOpen className="h-4 w-4 text-amber-500" />
      ) : (
        <Folder className="h-4 w-4 text-amber-500" />
      );
    }

    // Choose icon and color based on file extension
    const ext = file.name.split(".").pop()?.toLowerCase();

    // Markdown uses FileText icon
    if (ext === "md" || ext === "markdown") {
      return <FileText className="h-4 w-4 text-sky-500" />;
    }

    // LaTeX and other file types
    let iconClass = "text-muted-foreground";
    if (ext === "tex") iconClass = "text-emerald-500";
    else if (ext === "bib") iconClass = "text-blue-500";
    else if (ext === "sty" || ext === "cls") iconClass = "text-purple-500";
    else if (ext === "pdf") iconClass = "text-red-500";
    else if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "gif") iconClass = "text-pink-500";

    return <File className={cn("h-4 w-4", iconClass)} />;
  };

  // Virtual folder: represents the object-storage conflict case of \"same-name file\" + \"child entries under the same path\".
  // Backend returns a folder node with an id like \"__lw_vfolder__:<realPath>\".
  // This node is for visualization only and must not be used as a target for create/move/delete operations.
  const isVirtualFolder = useCallback((id: string) => id.startsWith("__lw_vfolder__:"), []);

  const renderFile = (file: ProjectFile, depth: number = 0) => {
    const isExpanded = expandedFolders.has(file.id);
    const isSelected = selectedFile === file.id;
    const isDragging = draggedFileId === file.id;
    const isDropTarget = dropTargetId === file.id && file.type === "folder";
    const isVirtual = file.type === "folder" && isVirtualFolder(file.id);

    return (
      <div
        key={file.id}
        onDragEnter={
          file.type === "folder" && !isVirtual ? (e) => handleDragEnter(e, file.id) : undefined
        }
        onDragLeave={file.type === "folder" && !isVirtual ? handleDragLeave : undefined}
        onDragOver={file.type === "folder" && !isVirtual ? handleDragOver : undefined}
        onDrop={
          file.type === "folder" && !isVirtual ? (e) => handleDrop(e, file.id) : undefined
        }
      >
        <ContextMenu>
          <ContextMenuTrigger>
            <div
              className={cn(
                "file-tree-item group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors duration-150",
                isSelected && "bg-primary/10 text-primary",
                !isSelected && "hover:bg-muted/50",
                isDragging && "opacity-50",
                isDropTarget && "bg-primary/20 ring-2 ring-primary ring-inset",
                isExternalDragOver && isDropTarget && "bg-green-500/20 ring-2 ring-green-500 ring-inset"
              )}
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
              draggable={!isVirtual}
              onDragStart={!isVirtual ? (e) => handleDragStart(e, file) : undefined}
              onDragEnd={!isVirtual ? handleDragEnd : undefined}
              onClick={() => {
                if (file.type === "folder") {
                  toggleFolder(file.id);
                } else {
                  onFileSelect(file.id);
                }
              }}
            >
              {/* Expand/collapse arrow (folders only) */}
              {file.type === "folder" ? (
                isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )
              ) : (
                <span className="w-3.5 shrink-0" />
              )}
              {getFileIcon(file, isExpanded)}

              {/* Filename or rename input */}
              {renameFileId === file.id ? (
                <Input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={handleRenameKeyDown}
                  onFocus={handleRenameFocus}
                  onBlur={handleRenameBlur}
                  onClick={(e) => e.stopPropagation()}
                  className="h-6 flex-1 px-1 py-0 text-sm"
                />
              ) : (
                <span className="flex-1 truncate">{file.name}</span>
              )}

              {/* Action buttons shown on hover */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      // If inline create mode is active, cancel it first, prevent this click,
                      // and let the next click open the menu after layout stabilizes.
                      if (inlineCreateMode) {
                        e.preventDefault(); // Prevent subsequent click event
                        flushSync(() => {
                          cancelInlineCreate();
                        });
                        return;
                      }
                    }}
                  >
                    <MoreHorizontal className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {file.type === "folder" && !isVirtual && (
                    <>
                      <DropdownMenuItem onClick={(e) => {e.stopPropagation(); startInlineCreate(file.id, "file");} }>
                        <FilePlus className="mr-2 h-4 w-4" />
                        {t("newFile")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={(e) => {e.stopPropagation(); startInlineCreate(file.id, "folder");}}>
                        <FolderPlus className="mr-2 h-4 w-4" />
                        {t("newFolder")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  {file.type === "file" && (
                    <DropdownMenuItem onClick={(e) => {e.stopPropagation(); handleDownload(file);}}>
                      <Download className="mr-2 h-4 w-4" />
                      {tCommon("download")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    disabled={isVirtual}
                    onClick={(e) => {e.stopPropagation(); if (!isVirtual) startInlineRename(file.id, file.name);}}
                  >
                    <Edit2 className="mr-2 h-4 w-4" />
                    {tCommon("rename")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive"
                    disabled={isVirtual}
                    onClick={(e) => {e.stopPropagation(); if (!isVirtual) onDeleteFile(file.id);}}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {tCommon("delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </ContextMenuTrigger>

          <ContextMenuContent>
            {file.type === "folder" && !isVirtual && (
              <>
                <ContextMenuItem onClick={(e) => {e.stopPropagation(); startInlineCreate(file.id, "file")}}>
                  <FilePlus className="mr-2 h-4 w-4" />
                  {t("newFile")}
                </ContextMenuItem>
                <ContextMenuItem onClick={(e) => {e.stopPropagation(); startInlineCreate(file.id, "folder");}}>
                  <FolderPlus className="mr-2 h-4 w-4" />
                  {t("newFolder")}
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            {file.type === "file" && (
              <ContextMenuItem onClick={(e) => {e.stopPropagation(); handleDownload(file);}}>
                <Download className="mr-2 h-4 w-4" />
                {tCommon("download")}
              </ContextMenuItem>
            )}
            <ContextMenuItem
              disabled={isVirtual}
              onClick={(e) => {e.stopPropagation(); if (!isVirtual) startInlineRename(file.id, file.name);}}
            >
              <Edit2 className="mr-2 h-4 w-4" />
              {tCommon("rename")}
            </ContextMenuItem>
            <ContextMenuItem
              className="text-destructive"
              disabled={isVirtual}
              onClick={(e) => {e.stopPropagation(); if (!isVirtual) onDeleteFile(file.id);}}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {tCommon("delete")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        {/* Children */}
        {file.type === "folder" && isExpanded && (
          <div className="animate-fade-in">
            {/* New folder appears at the top */}
            {inlineCreateMode === "folder" && inlineCreateParentId === file.id && (
              <div
                className="flex items-center gap-1.5 px-2 py-1.5"
                style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
              >
                <span className="w-3.5 shrink-0" />
                <Folder className="h-4 w-4 text-amber-500" />
                <Input
                  ref={inlineInputRef}
                  value={inlineCreateValue}
                  onChange={(e) => setInlineCreateValue(e.target.value)}
                  onKeyDown={handleInlineKeyDown}
                  onBlur={handleInlineBlur}
                  placeholder={tDialog("folderNamePlaceholder")}
                  className="h-6 flex-1 px-1 py-0 text-sm"
                  disabled={isCreating}
                  autoFocus={inlineCreateMode === "folder" && inlineCreateParentId === file.id}
                />
              </div>
            )}
            {/* Render child folders */}
            {file.children && sortFiles(file.children).filter(c => c.type === "folder").map((child) => renderFile(child, depth + 1))}
            {/* New file appears after folders and before files */}
            {inlineCreateMode === "file" && inlineCreateParentId === file.id && (
              <div
                className="flex items-center gap-1.5 px-2 py-1.5"
                style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
              >
                <span className="w-3.5 shrink-0" />
                <File className="h-4 w-4 text-muted-foreground" />
                <Input
                  ref={inlineInputRef}
                  value={inlineCreateValue}
                  onChange={(e) => setInlineCreateValue(e.target.value)}
                  onKeyDown={handleInlineKeyDown}
                  onBlur={handleInlineBlur}
                  placeholder={tDialog("fileNamePlaceholder")}
                  className="h-6 flex-1 px-1 py-0 text-sm"
                  disabled={isCreating}
                />
              </div>
            )}
            {/* Render files */}
            {file.children && sortFiles(file.children).filter(c => c.type !== "folder").map((child) => renderFile(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // Render root-level inline input row
  // New folder: at the top; new file: after all folders and before files
  const renderRootInlineInput = (position: "top" | "middle") => {
    if (!inlineCreateMode || inlineCreateParentId !== null) return null;

    // 'top' renders folder creation only; 'middle' renders file creation only
    if (position === "top" && inlineCreateMode !== "folder") return null;
    if (position === "middle" && inlineCreateMode !== "file") return null;

    return (
      <div className="flex items-center gap-1.5 px-2 py-1.5" style={{ paddingLeft: "8px" }}>
        <span className="w-3.5 shrink-0" />
        {inlineCreateMode === "folder" ? (
          <Folder className="h-4 w-4 text-amber-500" />
        ) : (
          <File className="h-4 w-4 text-muted-foreground" />
        )}
        <Input
          ref={inlineInputRef}
          value={inlineCreateValue}
          onChange={(e) => setInlineCreateValue(e.target.value)}
          onKeyDown={handleInlineKeyDown}
          onBlur={handleInlineBlur}
          placeholder={inlineCreateMode === "folder" ? tDialog("folderNamePlaceholder") : tDialog("fileNamePlaceholder")}
          className="h-6 flex-1 px-1 py-0 text-sm"
          disabled={isCreating}
        />
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      {/* Hidden file upload input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        aria-label={t("uploadFile")}
        onChange={handleFileUpload}
      />

      {/* Header */}
      <div className="flex items-center justify-between bg-muted/50 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground" style={{ whiteSpace: "nowrap" }}>
            {t("title")}
          </span>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={triggerFileInput}
            disabled={isUploading}
            title={t("uploadFile")}
          >
            {isUploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={() => startInlineCreate(null, "file")}
          >
            <FilePlus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={() => startInlineCreate(null, "folder")}
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* File list - supports context menu on blank area */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <ScrollArea
            className={cn(
              "flex-1 px-2 py-2 transition-colors",
              isDraggingOverRoot && !isExternalDragOver && "bg-primary/10",
              isDraggingOverRoot && isExternalDragOver && "bg-green-500/10 ring-2 ring-green-500 ring-inset"
            )}
            onDragEnter={(e) => handleDragEnter(e, null)}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, null)}
          >
            {/* New folder appears at the top */}
            {renderRootInlineInput("top")}
            {/* Render all folders */}
            {sortFiles(files).filter(f => f.type === "folder").map((file) => renderFile(file))}
            {/* New file appears after folders and before files */}
            {renderRootInlineInput("middle")}
            {/* Render all non-folder files */}
            {sortFiles(files).filter(f => f.type !== "folder").map((file) => renderFile(file))}
          </ScrollArea>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={triggerFileInput} disabled={isUploading}>
            <Upload className="mr-2 h-4 w-4" />
            {t("uploadFile")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => startInlineCreate(null, "file")}>
            <FilePlus className="mr-2 h-4 w-4" />
            {t("newFile")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => startInlineCreate(null, "folder")}>
            <FolderPlus className="mr-2 h-4 w-4" />
            {t("newFolder")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Dialogs */}
    </div>
  );
}
