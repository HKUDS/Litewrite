"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Loader2,
  Share2,
  History,
  Sparkles,
  FileCode,
  FileOutput,
  File,
  Download,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { UserMenu } from "@/components/user-menu";
import { ProjectSettingsDialog } from "@/components/projects/project-settings-dialog";
import { useTranslations } from "@/lib/i18n";
import type { CompileStatus } from "@/types";
import type { CollaboratorInfo } from "@/components/editor/collaborative-editor";
import { cn } from "@/lib/utils";

interface EditorHeaderProps {
  projectId: string;
  projectName: string;
  compileStatus: CompileStatus;
  onCompile: () => void;
  onToggleSidebar: () => void;
  onTogglePdfPanel: () => void;
  sidebarOpen: boolean;
  pdfPanelOpen: boolean;
  onGoHome?: () => void;
  collaborators?: CollaboratorInfo[];
  onToggleHistory?: () => void;
  onToggleAiPanel?: () => void;
  aiPanelOpen?: boolean;
  pdfUrl?: string;
}

export function EditorHeader({
  projectId,
  projectName,
  compileStatus,
  onCompile,
  onToggleSidebar,
  onTogglePdfPanel,
  sidebarOpen,
  pdfPanelOpen,
  onGoHome,
  collaborators = [],
  onToggleHistory,
  onToggleAiPanel,
  aiPanelOpen = false,
  pdfUrl,
}: EditorHeaderProps) {
  const { t } = useTranslations("editor");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const { toast } = useToast();

  // Export to other formats
  const handleExport = async (format: 'markdown' | 'docx') => {
    setExporting(format);
    try {
      const response = await fetch(`/api/projects/${projectId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format }),
      });

      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const data = await response.json();
        throw new Error(data.error?.code || t("exportFailed"));
      }

      if (!response.ok) throw new Error(t("exportFailed"));

      const blob = await response.blob();
      const filename = response.headers.get('content-disposition')
        ?.match(/filename="?([^"]+)"?/)?.[1] || `export.${format === 'markdown' ? 'zip' : format}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = decodeURIComponent(filename);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({ title: t("exportSuccess"), description: t("exportedAs", { filename: decodeURIComponent(filename) }) });
    } catch (error) {
      toast({ title: t("exportFailed"), description: error instanceof Error ? error.message : t("unknownError"), variant: 'destructive' });
    } finally {
      setExporting(null);
    }
  };

  // Download PDF directly
  const handleDownloadPdf = () => {
    if (pdfUrl) {
      const a = document.createElement('a');
      a.href = pdfUrl;
      a.download = `${projectName || 'document'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const displayedCollaborators = collaborators.slice(0, 5);
  const remainingCount = collaborators.length - 5;

  return (
    <header className="relative z-20 flex h-12 items-center justify-between bg-gradient-to-r from-white via-litewrite-cyan/5 to-litewrite-teal/5 dark:from-slate-900 dark:via-litewrite-cyan/10 dark:to-litewrite-teal/10 backdrop-blur-xl border-b border-litewrite-cyan/15 px-4">
      {/* Left - logo + project name */}
      <div className="flex items-center gap-1.5">
        {/* Logo - click to go back to dashboard */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onGoHome}
              aria-label={t("backToHome")}
              title={t("backToHome")}
              className="flex items-center hover:opacity-80 transition-all duration-200 group -ml-1"
            >
              <div className="relative">
                <div className="absolute -inset-2 blur-lg bg-gradient-to-r from-litewrite-cyan/30 to-litewrite-teal/30 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-full" />
                <Image src="/logo.svg" alt="Litewrite" width={56} height={56} className="relative" />
              </div>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="z-[100]">{t("backToHome")}</TooltipContent>
        </Tooltip>

        {/* Divider */}
        <div className="h-5 w-px bg-gradient-to-b from-transparent via-litewrite-cyan/30 to-transparent" />

        {/* Project name */}
        <span className="text-sm font-medium text-foreground/90 line-clamp-1 max-w-[200px]">
          {projectName}
        </span>
      </div>

      {/* Center spacer */}
      <div className="flex-1" />

      {/* Right - action buttons */}
      <div className="flex items-center gap-2">
        {/* Collaborators - with shadow */}
        {collaborators.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/60 dark:bg-slate-800/60 border border-litewrite-cyan/20 shadow-md shadow-litewrite-cyan/10 dark:shadow-slate-900/30">
            <div className="flex -space-x-1.5">
              {displayedCollaborators.map((user, index) => (
                <Tooltip key={index}>
                  <TooltipTrigger asChild>
                    {user.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={user.image}
                        alt={user.name}
                        className="h-6 w-6 rounded-full ring-2 ring-white dark:ring-slate-800 object-cover cursor-default transition-transform hover:scale-110 hover:z-10 shadow-sm"
                      />
                    ) : (
                      <div
                        className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-medium text-white ring-2 ring-white dark:ring-slate-800 cursor-default transition-transform hover:scale-110 hover:z-10 shadow-sm"
                        style={{ backgroundColor: user.color }}
                      >
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="z-[100]">{user.name}</TooltipContent>
                </Tooltip>
              ))}
              {remainingCount > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium ring-2 ring-white dark:ring-slate-800 shadow-sm">
                      +{remainingCount}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="z-[100]">
                    {t("collaborators")}: {collaborators.length}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <span className="text-[11px] text-muted-foreground hidden lg:block">
              {t("collaborating", { count: collaborators.length })}
            </span>
          </div>
        )}

        {/* Divider */}
        {collaborators.length > 0 && (
          <div className="h-5 w-px bg-gradient-to-b from-transparent via-border/40 to-transparent" />
        )}

        {/* Core action group - with labels */}
        <div className="flex items-center gap-1">
          {/* History */}
          {onToggleHistory && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-3 gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-litewrite-cyan/10"
              onClick={onToggleHistory}
            >
              <History className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("historyBtn")}</span>
            </Button>
          )}

          {/* Share */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-3 gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-litewrite-cyan/10"
            onClick={() => setSettingsOpen(true)}
          >
            <Share2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("shareBtn")}</span>
          </Button>

          {/* Export / download */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-3 gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-litewrite-cyan/10"
              >
                {exporting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">{t("downloadBtn")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                {t("selectFormat")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleDownloadPdf}
                disabled={!pdfUrl}
                className="gap-2"
              >
                <File className="h-4 w-4 text-red-500" />
                <div className="flex flex-col">
                  <span>{t("pdfDocument")}</span>
                  <span className="text-[10px] text-muted-foreground">{t("pdfDesc")}</span>
                </div>
                {!pdfUrl && <span className="text-[10px] text-muted-foreground ml-auto">{t("needCompile")}</span>}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleExport('markdown')} disabled={!!exporting} className="gap-2">
                <FileCode className="h-4 w-4 text-blue-500" />
                <div className="flex flex-col">
                  <span>Markdown</span>
                  <span className="text-[10px] text-muted-foreground">{t("markdownDesc")}</span>
                </div>
                {exporting === 'markdown' && <Loader2 className="h-3 w-3 animate-spin ml-auto" />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Divider */}
        <div className="h-5 w-px bg-gradient-to-b from-transparent via-border/40 to-transparent" />

        {/* AI button */}
        {onToggleAiPanel && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onToggleAiPanel}
                className={cn(
                  "relative h-8 px-4 rounded-full font-medium text-sm transition-all duration-300 overflow-hidden group",
                  aiPanelOpen
                    ? "bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-500/30"
                    : "bg-gradient-to-r from-violet-500/10 via-purple-500/10 to-indigo-500/10 text-purple-600 dark:text-purple-400 border border-purple-300/50 dark:border-purple-500/30 hover:border-purple-400 dark:hover:border-purple-400/50 hover:shadow-md hover:shadow-purple-500/20"
                )}
              >
                {/* Shimmer background */}
                <div className={cn(
                  "absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700",
                  aiPanelOpen && "via-white/30"
                )} />
                <div className="relative flex items-center gap-1.5">
                  <Sparkles className={cn(
                    "h-4 w-4 transition-all duration-300",
                    aiPanelOpen ? "scale-110" : "group-hover:rotate-12 group-active:animate-ping"
                  )} />
                  <span>AI</span>
                </div>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="z-[100]">{t("aiAssistantTooltip")}</TooltipContent>
          </Tooltip>
        )}

        {/* User menu */}
        <UserMenu />
      </div>

      {/* Project settings dialog */}
      <ProjectSettingsDialog
        projectId={projectId}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
    </header>
  );
}
