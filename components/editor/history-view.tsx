"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import {
  ArrowLeft,
  Plus,
  History,
  Loader2,
  Clock,
  User,
  Trash2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  FileText,
  FilePlus,
  FileMinus,
  FileEdit,
  Check,
  GitCompare,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AnimatedLogo } from "@/components/ui/animated-logo";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useTranslations } from "@/lib/i18n";
import { getApiErrorMessage } from "@/lib/api-error-handler";
import { cn } from "@/lib/utils";
import { CreateVersionDialog } from "./create-version-dialog";

// Type definitions
interface Version {
  id: string;
  name: string;
  description: string | null;
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
  fileCount: number;
  createdAt: string;
}

interface DiffLine {
  type: "added" | "removed" | "unchanged";
  content: string;
  lineNumber?: number;
  oldLineNumber?: number;
  newLineNumber?: number;
}

interface FileDiff {
  filePath: string;
  status: "added" | "removed" | "modified" | "unchanged";
  diff: DiffLine[];
}

interface CompareResult {
  fromVersion: {
    id: string;
    name: string;
    createdAt: string;
    userName: string | null;
  };
  toVersion: {
    id: string;
    name: string;
    createdAt: string;
    userName: string | null;
  };
  stats: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
  diffs: FileDiff[];
}

interface HistoryViewProps {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onRestore?: () => void; // Callback after a successful restore (used to refresh the file list)
}

export function HistoryView({ projectId, projectName, onClose, onRestore }: HistoryViewProps) {
  const { t, locale } = useTranslations("history");
  const { t: tRoot } = useTranslations();
  const { toast } = useToast();
  const { data: session } = useSession();

  // State
  const [versions, setVersions] = useState<Version[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Version selection state
  const [selectedVersions, setSelectedVersions] = useState<[string | null, string | null]>([null, "current"]);
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [isComparing, setIsComparing] = useState(false);

  // File expansion state
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [activeFile, setActiveFile] = useState<string | null>(null);

  // Delete confirmation
  const [deleteVersionId, setDeleteVersionId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Restore confirmation
  const [restoreVersionId, setRestoreVersionId] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  // Load version list
  const loadVersions = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/versions`);
      const data = await response.json();

      if (!response.ok) {
        const apiMessage = getApiErrorMessage(data, tRoot, "common.error");
        throw new Error(apiMessage === tRoot("common.error") ? t("loadVersionsFailed") : apiMessage);
      }

      setVersions(data.versions);

      // If versions exist, default to comparing the latest version
      if (data.versions.length > 0 && !selectedVersions[0]) {
        setSelectedVersions([data.versions[0].id, "current"]);
      }
    } catch (error) {
      toast({
        title: t("error"),
        description: error instanceof Error ? error.message : t("loadVersionsFailed"),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [projectId, t, toast, selectedVersions]);

  // Initial load
  useEffect(() => {
    loadVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Compare versions
  const handleCompare = useCallback(async () => {
    const [fromId, toId] = selectedVersions;
    if (!fromId) return;

    setIsComparing(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/versions/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromVersionId: fromId,
          toVersionId: toId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const apiMessage = getApiErrorMessage(data, tRoot, "common.error");
        throw new Error(apiMessage === tRoot("common.error") ? t("compareFailed") : apiMessage);
      }

      setCompareResult(data);

      // Auto-expand changed files
      const changedFiles = data.diffs
        .filter((d: FileDiff) => d.status !== "unchanged")
        .map((d: FileDiff) => d.filePath);
      setExpandedFiles(new Set(changedFiles));

      // Select the first changed file
      if (changedFiles.length > 0) {
        setActiveFile(changedFiles[0]);
      }
    } catch (error) {
      toast({
        title: t("error"),
        description: error instanceof Error ? error.message : t("compareFailed"),
        variant: "destructive",
      });
    } finally {
      setIsComparing(false);
    }
  }, [projectId, selectedVersions, t, toast]);

  // Auto-compare when the selected versions change
  useEffect(() => {
    if (selectedVersions[0]) {
      handleCompare();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVersions]);

  // Version click handler (supports Shift multi-select)
  const handleVersionClick = useCallback((versionId: string, event: React.MouseEvent) => {
    if (event.shiftKey && selectedVersions[0]) {
      // Shift-click: select a range
      setSelectedVersions([selectedVersions[0], versionId]);
    } else {
      // Regular click: compare with the current version
      setSelectedVersions([versionId, "current"]);
    }
  }, [selectedVersions]);

  // Compare button handler: set this version as the comparison target (To version)
  const handleCompareClick = useCallback((versionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (selectedVersions[0] && selectedVersions[0] !== versionId) {
      // If a From version is selected, set this version as To
      setSelectedVersions([selectedVersions[0], versionId]);
    } else {
      // If no From is selected (or it's the same), compare with the current version
      setSelectedVersions([versionId, "current"]);
    }
  }, [selectedVersions]);

  // Delete version
  const handleDeleteVersion = async () => {
    if (!deleteVersionId) return;

    setIsDeleting(true);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/versions/${deleteVersionId}`,
        { method: "DELETE" }
      );

      const data = await response.json();

      if (!response.ok) {
        const apiMessage = getApiErrorMessage(data, tRoot, "common.error");
        throw new Error(apiMessage === tRoot("common.error") ? t("deleteVersionFailed") : apiMessage);
      }

      toast({
        title: t("success"),
        description: data.message || t("versionDeleted"),
      });

      loadVersions();

      if (selectedVersions[0] === deleteVersionId) {
        setSelectedVersions([null, "current"]);
        setCompareResult(null);
      }
    } catch (error) {
      toast({
        title: t("error"),
        description: error instanceof Error ? error.message : t("deleteVersionFailed"),
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setDeleteVersionId(null);
    }
  };

  // Restore version
  const handleRestoreVersion = async () => {
    if (!restoreVersionId) return;

    setIsRestoring(true);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/versions/${restoreVersionId}/restore`,
        { method: "POST" }
      );

      const data = await response.json();

      if (!response.ok) {
        const apiMessage = getApiErrorMessage(data, tRoot, "common.error");
        throw new Error(apiMessage === tRoot("common.error") ? t("restoreVersionFailed") : apiMessage);
      }

      toast({
        title: t("success"),
        description: t("versionRestoredWithDetails", {
          name: data.versionName,
          count: data.restoredFileCount
        }),
      });

      // After restoring, refresh files (if provided) and close the history view
      onRestore?.();
      onClose();
    } catch (error) {
      toast({
        title: t("error"),
        description: error instanceof Error ? error.message : t("restoreVersionFailed"),
        variant: "destructive",
      });
    } finally {
      setIsRestoring(false);
      setRestoreVersionId(null);
    }
  };

  // Locale used for date formatting
  const dateLocale = locale === "zh" ? "zh-CN" : "en-US";

  // Format time
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString(dateLocale, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(dateLocale, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  // Get user display name
  const getUserName = (user: Version["user"]) => {
    return user.name || user.email?.split("@")[0] || t("unknownUser");
  };

  // Get version display name (handle special markers)
  const getVersionDisplayName = (name: string) => {
    if (name === "__CURRENT_VERSION__") {
      return t("currentVersion");
    }
    return name;
  };

  // Group versions by date
  const groupedVersions = useMemo(() => {
    const groups: { [date: string]: Version[] } = {};
    versions.forEach((v) => {
      const date = formatDate(v.createdAt);
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(v);
    });
    return groups;
  }, [versions]);

  // File list (derived from comparison results)
  const changedFiles = useMemo(() => {
    if (!compareResult) return [];
    return compareResult.diffs.filter((d) => d.status !== "unchanged");
  }, [compareResult]);

  // Toggle file expansion
  const toggleFile = (filePath: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
    setActiveFile(filePath);
  };

  // Get status icon
  const getStatusIcon = (status: FileDiff["status"]) => {
    switch (status) {
      case "added":
        return <FilePlus className="h-4 w-4 text-green-500" />;
      case "removed":
        return <FileMinus className="h-4 w-4 text-red-500" />;
      case "modified":
        return <FileEdit className="h-4 w-4 text-yellow-500" />;
      default:
        return <FileText className="h-4 w-4 text-muted-foreground" />;
    }
  };

  // Get status label
  const getStatusLabel = (status: FileDiff["status"]) => {
    switch (status) {
      case "added":
        return <span className="text-xs text-green-600 dark:text-green-400">{t("fileStatusCreated")}</span>;
      case "removed":
        return <span className="text-xs text-red-600 dark:text-red-400">{t("fileStatusRemoved")}</span>;
      case "modified":
        return <span className="text-xs text-yellow-600 dark:text-yellow-400">{t("fileStatusEdited")}</span>;
      default:
        return null;
    }
  };

  // Get diff line counts
  const getLineCounts = (diff: DiffLine[]) => {
    const added = diff.filter((l) => l.type === "added").length;
    const removed = diff.filter((l) => l.type === "removed").length;
    return { added, removed };
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Top navigation bar - aligned with EditorHeader styling */}
      <header className="flex h-12 items-center justify-between bg-gradient-to-r from-white via-litewrite-cyan/5 to-litewrite-teal/5 dark:from-slate-900 dark:via-litewrite-cyan/10 dark:to-litewrite-teal/10 backdrop-blur-xl border-b border-litewrite-cyan/15 px-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-litewrite-cyan/10">
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("backToEditor")}
          </Button>
          <div className="h-5 w-px bg-gradient-to-b from-transparent via-litewrite-cyan/30 to-transparent" />
          <span className="text-sm font-medium text-foreground/90">{projectName}</span>
        </div>

        <div className="flex items-center gap-2">
          {compareResult && (
            <span className="text-xs text-muted-foreground">
              {t("comparingVersions", {
                from: getVersionDisplayName(compareResult.fromVersion.name),
                to: getVersionDisplayName(compareResult.toVersion.name)
              })}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={loadVersions}
            disabled={isLoading}
            className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-litewrite-cyan/10"
          >
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => setCreateDialogOpen(true)}
            className="h-8 gap-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("createVersion")}
          </Button>
        </div>
      </header>

      {/* Main content area - three-column layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: file list */}
        <div className="w-64 border-r border-border flex flex-col bg-muted/20">
          <div className="p-3 border-b border-border">
            <h3 className="font-medium text-sm">{t("changedFiles")}</h3>
            {compareResult && (
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                <span className="text-green-600">+{compareResult.stats.added}</span>
                <span className="text-red-600">-{compareResult.stats.removed}</span>
                <span className="text-yellow-600">~{compareResult.stats.modified}</span>
              </div>
            )}
          </div>

          <ScrollArea className="flex-1">
            {isComparing ? (
              <div className="flex items-center justify-center py-8">
                <AnimatedLogo width={60} height={32} duration={1.2} pauseDuration={300} />
              </div>
            ) : changedFiles.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground text-center">
                {versions.length === 0 ? t("noVersions") : t("noChanges")}
              </div>
            ) : (
              <div className="py-1">
                {changedFiles.map((file) => (
                  <button
                    key={file.filePath}
                    className={cn(
                      "w-full px-3 py-2 flex items-center gap-2 text-left text-sm hover:bg-muted/50 transition-colors",
                      activeFile === file.filePath && "bg-muted"
                    )}
                    onClick={() => toggleFile(file.filePath)}
                  >
                    {getStatusIcon(file.status)}
                    <span className="flex-1 truncate font-mono text-xs">
                      {file.filePath}
                    </span>
                    {getStatusLabel(file.status)}
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Center: diff view */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {isComparing ? (
            <div className="flex-1 flex items-center justify-center">
              <AnimatedLogo width={80} height={42} duration={1.2} pauseDuration={300} />
            </div>
          ) : !compareResult ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
              <History className="h-16 w-16 mb-4 opacity-30" />
              <p className="text-lg">{t("selectVersionToCompare")}</p>
              <p className="text-sm mt-1">{t("selectVersionHint")}</p>
            </div>
          ) : changedFiles.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
              <Check className="h-16 w-16 mb-4 opacity-30 text-green-500" />
              <p className="text-lg">{t("noChanges")}</p>
              <p className="text-sm mt-1">{t("versionsIdentical")}</p>
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4">
                {changedFiles.map((fileDiff) => {
                  const isExpanded = expandedFiles.has(fileDiff.filePath);
                  const { added, removed } = getLineCounts(fileDiff.diff);

                  return (
                    <div
                      key={fileDiff.filePath}
                      className={cn(
                        "border border-border rounded-lg overflow-hidden",
                        activeFile === fileDiff.filePath && "ring-2 ring-primary"
                      )}
                    >
                      {/* File header */}
                      <div
                        className="flex items-center gap-2 px-4 py-2 bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
                        onClick={() => toggleFile(fileDiff.filePath)}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        {getStatusIcon(fileDiff.status)}
                        <span className="flex-1 font-mono text-sm">{fileDiff.filePath}</span>
                        {getStatusLabel(fileDiff.status)}
                        <div className="flex items-center gap-2 text-xs">
                          {added > 0 && (
                            <span className="text-green-600 dark:text-green-400">+{added}</span>
                          )}
                          {removed > 0 && (
                            <span className="text-red-600 dark:text-red-400">-{removed}</span>
                          )}
                        </div>
                      </div>

                      {/* Diff content */}
                      {isExpanded && fileDiff.diff.length > 0 && (
                        <div className="overflow-hidden">
                          <table className="w-full text-xs font-mono table-fixed">
                            <tbody>
                              {fileDiff.diff.map((line, idx) => (
                                <tr
                                  key={idx}
                                  className={cn(
                                    line.type === "added" && "bg-green-500/10",
                                    line.type === "removed" && "bg-red-500/10"
                                  )}
                                >
                                  <td className="w-12 text-right px-2 py-0.5 text-muted-foreground select-none border-r border-border/50">
                                    {line.oldLineNumber || ""}
                                  </td>
                                  <td className="w-12 text-right px-2 py-0.5 text-muted-foreground select-none border-r border-border/50">
                                    {line.newLineNumber || ""}
                                  </td>
                                  <td className="w-6 text-center select-none">
                                    {line.type === "added" && (
                                      <span className="text-green-600 dark:text-green-400">+</span>
                                    )}
                                    {line.type === "removed" && (
                                      <span className="text-red-600 dark:text-red-400">-</span>
                                    )}
                                  </td>
                                  <td className="px-2 py-0.5 whitespace-pre-wrap break-all">
                                    {line.content || " "}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Right: version timeline */}
        <div className="w-96 border-l border-border flex flex-col bg-muted/20">
          <div className="p-3 border-b border-border flex items-center justify-between">
            <h3 className="font-medium text-sm">{t("allHistory")}</h3>
            <span className="text-xs text-muted-foreground">
              {versions.length} {t("versions")}
            </span>
          </div>

          <ScrollArea className="flex-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <AnimatedLogo width={60} height={32} duration={1.2} pauseDuration={300} />
              </div>
            ) : versions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground px-4">
                <History className="h-12 w-12 mb-4 opacity-30" />
                <p className="text-sm">{t("noVersions")}</p>
                <p className="text-xs mt-1">{t("noVersionsHint")}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => setCreateDialogOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t("createFirstVersion")}
                </Button>
              </div>
            ) : (
              <div className="py-2">
                {Object.entries(groupedVersions).map(([date, dateVersions]) => (
                  <div key={date} className="mb-4">
                    {/* Date group header */}
                    <div className="px-4 py-1 text-xs font-medium text-muted-foreground sticky top-0 bg-muted/20">
                      {date}
                    </div>

                    {/* Version list */}
                    {dateVersions.map((version) => {
                      const isSelected =
                        selectedVersions[0] === version.id ||
                        selectedVersions[1] === version.id;
                      const isFromVersion = selectedVersions[0] === version.id;

                      return (
                        <div
                          key={version.id}
                          className={cn(
                            "group px-3 py-3 cursor-pointer hover:bg-muted/50 transition-colors border-l-2 ml-4 overflow-hidden",
                            isSelected
                              ? "border-l-primary bg-primary/5"
                              : "border-l-transparent"
                          )}
                          onClick={(e) => handleVersionClick(version.id, e)}
                        >
                          <div className="flex items-start gap-2 overflow-hidden">
                            {/* Selection indicator */}
                            <div
                              className={cn(
                                "w-3 h-3 rounded-full mt-1 border-2 flex-shrink-0",
                                isSelected
                                  ? "border-primary bg-primary"
                                  : "border-muted-foreground/50"
                              )}
                            />

                            <div className="flex-1 min-w-0 overflow-hidden">
                              {/* Time and version name */}
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">
                                  {formatTime(version.createdAt)}
                                </span>
                                {isFromVersion && (
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                                    {t("from")}
                                  </span>
                                )}
                              </div>

                              {/* Version name */}
                              <p className="text-sm text-muted-foreground truncate mt-0.5">
                                {version.name}
                              </p>

                              {/* User info */}
                              <div className="flex items-center gap-2 mt-1">
                                <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-xs text-primary">
                                  {getUserName(version.user).charAt(0).toUpperCase()}
                                </div>
                                <span className="text-xs text-muted-foreground">
                                  {getUserName(version.user)}
                                </span>
                              </div>

                              {/* File count */}
                              <div className="text-xs text-muted-foreground mt-1">
                                {t("filesCount", { count: version.fileCount })}
                              </div>
                            </div>

                            {/* Action buttons */}
                            <div className="flex items-center gap-0.5 flex-shrink-0">
                              {/* Restore button */}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 opacity-0 group-hover:opacity-100 hover:opacity-100"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRestoreVersionId(version.id);
                                }}
                                title={t("restoreVersion")}
                              >
                                <RotateCcw className="h-3 w-3 text-muted-foreground hover:text-green-600" />
                              </Button>
                              {/* Compare button */}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 opacity-0 group-hover:opacity-100 hover:opacity-100"
                                onClick={(e) => handleCompareClick(version.id, e)}
                                title={t("compareWith")}
                              >
                                <GitCompare className="h-3 w-3 text-muted-foreground hover:text-primary" />
                              </Button>
                              {/* Delete button */}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 opacity-0 group-hover:opacity-100 hover:opacity-100"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteVersionId(version.id);
                                }}
                              >
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}

                {/* Current version */}
                <div className="px-4 py-3 border-l-2 ml-4 border-l-muted-foreground/30">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full border-2 border-muted-foreground/50 flex-shrink-0" />
                    <span className="text-sm text-muted-foreground">{t("currentVersion")}</span>
                  </div>
                </div>
              </div>
            )}
          </ScrollArea>
        </div>
      </div>

      {/* Create version dialog */}
      <CreateVersionDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        projectId={projectId}
        onSuccess={loadVersions}
      />

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteVersionId} onOpenChange={() => setDeleteVersionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteVersionTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteVersionDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteVersion}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Restore confirmation dialog */}
      <AlertDialog open={!!restoreVersionId} onOpenChange={() => setRestoreVersionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("restoreVersionTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("restoreVersionDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRestoring}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRestoreVersion}
              disabled={isRestoring}
              className="bg-green-600 text-white hover:bg-green-700"
            >
              {isRestoring && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("restore")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
