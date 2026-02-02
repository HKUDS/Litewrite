"use client";

import { useState } from "react";
import { FolderOpen, MessageCircle, Settings, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FileTree } from "@/components/file-tree/file-tree";
import { FileOutline } from "@/components/file-tree/file-outline";
import { CollaboratorChat } from "@/components/editor/collaborator-chat";
import { EditorSettingsDialog } from "@/components/editor/editor-settings-dialog";
import { HelpDialog } from "@/components/editor/help-dialog";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useTranslations } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ProjectFile } from "@/types";

type SidebarTab = "files" | "chat" | "ai-draw";
type EditorMode = "latex" | "markdown";

interface EditorSidebarProps {
  projectId: string;
  files: ProjectFile[];
  selectedFile: string;
  onFileSelect: (fileId: string) => void;
  onCreateFile: (parentId: string | null, name: string, type: "file" | "folder") => void;
  onDeleteFile: (fileId: string) => void;
  onRenameFile: (fileId: string, newName: string) => void;
  onMoveFile?: (sourceId: string, targetFolderId: string | null) => void;
  onFilesUploaded?: () => void;
  onTabChange?: (tab: SidebarTab) => void;
  onToggleOpen?: () => void; // Toggle panel expand/collapse
  isOpen?: boolean; // Whether the content area is expanded
  // Props for outline
  content?: string;
  editorMode?: EditorMode;
  onOutlineNavigate?: (line: number) => void;
  currentLine?: number; // Current cursor line for bi-directional sync
}

export function EditorSidebar({
  projectId,
  files,
  selectedFile,
  onFileSelect,
  onCreateFile,
  onDeleteFile,
  onRenameFile,
  onMoveFile,
  onFilesUploaded,
  onTabChange,
  onToggleOpen,
  isOpen = true,
  content,
  editorMode = "latex",
  onOutlineNavigate,
  currentLine,
}: EditorSidebarProps) {
  const { t } = useTranslations("sidebar");
  const { t: tSettings } = useTranslations("settings");
  const { t: tHelp } = useTranslations("help");

  const [activeTab, setActiveTab] = useState<SidebarTab>("files");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);

  const handleTabChange = (tab: SidebarTab) => {
    if (!isOpen) {
      // If the panel is collapsed, clicking any icon should expand it
      setActiveTab(tab);
      onTabChange?.(tab);
      onToggleOpen?.();
    } else if (activeTab === tab) {
      // If the panel is expanded, clicking the active icon again should collapse it
      onToggleOpen?.();
    } else {
      // Switch to another tab
      setActiveTab(tab);
      onTabChange?.(tab);
    }
  };

  const handleOutlineCollapsedChange = (collapsed: boolean) => {
    setOutlineCollapsed(collapsed);
  };

  return (
    <div className="flex h-full flex-row bg-white/80 dark:bg-slate-900/80">
      {/* Left vertical toolbar */}
      <div className="flex flex-col items-center justify-between bg-muted/30 border-r border-border py-2 px-1">
        {/* Top: tab switch buttons */}
        <div className="flex flex-col items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-8 w-8 transition-all duration-150",
                  // Only show selected state when expanded
                  isOpen && activeTab === "files"
                    ? "bg-background text-foreground shadow-sm border border-border/50"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
                onClick={() => handleTabChange("files")}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{t("fileTree")}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-8 w-8 transition-all duration-150",
                  // Only show selected state when expanded
                  isOpen && activeTab === "chat"
                    ? "bg-background text-foreground shadow-sm border border-border/50"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
                onClick={() => handleTabChange("chat")}
              >
                <MessageCircle className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{t("collaboratorChat")}</TooltipContent>
          </Tooltip>
        </div>

        {/* Bottom: utility buttons */}
        <div className="flex flex-col items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{tSettings("title")}</TooltipContent>
          </Tooltip>

          {/* Help button - temporarily hidden; feature is not complete yet */}
          {/* TODO: Restore after filling help content; see docs/DEVELOPMENT.md */}
          {/* <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => setHelpOpen(true)}
              >
                <HelpCircle className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{tHelp("title")}</TooltipContent>
          </Tooltip> */}
        </div>
      </div>

      {/* Right content area - toggled via hidden; chat stays mounted to keep WebSocket connection */}
      <div className={cn("flex-1 flex flex-col overflow-hidden", !isOpen && "hidden")}>
        {/* Content - always mount all panels; use display to show/hide */}
        <div className="flex-1 overflow-hidden relative">
          {/* File tree + outline panel */}
          <div className={cn("absolute inset-0 flex flex-col", activeTab !== "files" && "hidden")}>
            {/* File tree - fills remaining space */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {outlineCollapsed ? (
                // Collapsed: file tree takes the full space
                <FileTree
                  files={files}
                  selectedFile={selectedFile}
                  projectId={projectId}
                  onFileSelect={onFileSelect}
                  onCreateFile={onCreateFile}
                  onDeleteFile={onDeleteFile}
                  onRenameFile={onRenameFile}
                  onMoveFile={onMoveFile}
                  onFilesUploaded={onFilesUploaded}
                />
              ) : (
                // Expanded: split vertically
                <ResizablePanelGroup direction="vertical">
                  <ResizablePanel defaultSize={60} minSize={20}>
                    <FileTree
                      files={files}
                      selectedFile={selectedFile}
                      projectId={projectId}
                      onFileSelect={onFileSelect}
                      onCreateFile={onCreateFile}
                      onDeleteFile={onDeleteFile}
                      onRenameFile={onRenameFile}
                      onMoveFile={onMoveFile}
                      onFilesUploaded={onFilesUploaded}
                    />
                  </ResizablePanel>
                  <ResizableHandle />
                  <ResizablePanel defaultSize={40} minSize={15}>
                    <FileOutline
                      content={content || ""}
                      mode={editorMode}
                      onNavigate={onOutlineNavigate}
                      defaultCollapsed={false}
                      onCollapsedChange={handleOutlineCollapsedChange}
                      currentLine={currentLine}
                    />
                  </ResizablePanel>
                </ResizablePanelGroup>
              )}
            </div>

            {/* When collapsed, show a small outline bar at the bottom */}
            {outlineCollapsed && (
              <FileOutline
                content={content || ""}
                mode={editorMode}
                onNavigate={onOutlineNavigate}
                defaultCollapsed={true}
                onCollapsedChange={handleOutlineCollapsedChange}
                currentLine={currentLine}
              />
            )}
          </div>

          {/* Chat stays mounted to keep WebSocket connection */}
          <div className={cn("absolute inset-0", activeTab !== "chat" && "hidden")}>
            <CollaboratorChat projectId={projectId} />
          </div>
        </div>
      </div>

      {/* Settings dialog */}
      <EditorSettingsDialog projectId={projectId} open={settingsOpen} onOpenChange={setSettingsOpen} />

      {/* Help dialog */}
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
