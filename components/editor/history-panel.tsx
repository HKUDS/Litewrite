"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  X,
  Plus,
  History,
  Loader2,
  GitCompare,
  Clock,
  User,
  ChevronLeft,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { DiffViewer } from "./diff-viewer";

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

interface HistoryPanelProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
}

type ViewMode = "list" | "compare";

export function HistoryPanel({ projectId, isOpen, onClose }: HistoryPanelProps) {
  const { t, locale } = useTranslations("history");
  const { t: tRoot } = useTranslations();
  const { toast } = useToast();
  const { data: session } = useSession();

  // State
  const [versions, setVersions] = useState<Version[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Compare mode state
  const [fromVersionId, setFromVersionId] = useState<string>("");
  const [toVersionId, setToVersionId] = useState<string>("current");
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [isComparing, setIsComparing] = useState(false);

  // Delete confirmation
  const [deleteVersionId, setDeleteVersionId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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
    } catch (error) {
      toast({
        title: t("error"),
        description: error instanceof Error ? error.message : t("loadVersionsFailed"),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [projectId, t, toast]);

  // Load data when the panel opens
  useEffect(() => {
    if (isOpen) {
      loadVersions();
    }
  }, [isOpen, loadVersions]);

  // Compare versions
  const handleCompare = async () => {
    if (!fromVersionId) {
      toast({
        title: t("error"),
        description: t("selectFromVersion"),
        variant: "destructive",
      });
      return;
    }

    setIsComparing(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/versions/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromVersionId,
          toVersionId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const apiMessage = getApiErrorMessage(data, tRoot, "common.error");
        throw new Error(apiMessage === tRoot("common.error") ? t("compareFailed") : apiMessage);
      }

      setCompareResult(data);
      setViewMode("compare");
    } catch (error) {
      toast({
        title: t("error"),
        description: error instanceof Error ? error.message : t("compareFailed"),
        variant: "destructive",
      });
    } finally {
      setIsComparing(false);
    }
  };

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

      // Reload list
      loadVersions();

      // If the deleted version is currently selected, reset selection
      if (fromVersionId === deleteVersionId) {
        setFromVersionId("");
      }
      if (toVersionId === deleteVersionId) {
        setToVersionId("current");
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

  // Map app locale to a locale string for date formatting
  const dateLocale = locale === "zh" ? "zh-CN" : "en-US";

  // Format time
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString(dateLocale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Get user's display name
  const getUserName = (user: Version["user"]) => {
    return user.name || user.email?.split("@")[0] || t("unknownUser");
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-y-0 right-0 z-50 w-[400px] bg-background border-l border-border shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            {viewMode === "compare" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  setViewMode("list");
                  setCompareResult(null);
                }}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <History className="h-5 w-5" />
            <h2 className="font-semibold">
              {viewMode === "list" ? t("historyTitle") : t("compareTitle")}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            {viewMode === "list" && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={loadVersions}
                  disabled={isLoading}
                >
                  <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setCreateDialogOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        {viewMode === "list" ? (
          <>
            {/* Compare selector */}
            <div className="p-4 border-b border-border space-y-3">
              <div className="flex items-center gap-2">
                <GitCompare className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{t("compareVersions")}</span>
              </div>
              <div className="flex items-center gap-2">
                <Select value={fromVersionId} onValueChange={setFromVersionId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={t("selectOlderVersion")} />
                  </SelectTrigger>
                  <SelectContent>
                    {versions.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground">→</span>
                <Select value={toVersionId} onValueChange={setToVersionId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="current">{t("currentVersion")}</SelectItem>
                    {versions.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                className="w-full"
                onClick={handleCompare}
                disabled={!fromVersionId || isComparing}
              >
                {isComparing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("compare")}
              </Button>
            </div>

            <Separator />

            {/* Version list */}
            <ScrollArea className="flex-1">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : versions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground px-4">
                  <History className="h-12 w-12 mb-4 opacity-50" />
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
                <div className="divide-y divide-border">
                  {versions.map((version) => (
                    <div
                      key={version.id}
                      className="p-4 hover:bg-muted/50 transition-colors group"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium truncate">{version.name}</h3>
                          {version.description && (
                            <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                              {version.description}
                            </p>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => setDeleteVersionId(version.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          <span>{getUserName(version.user)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          <span>{formatTime(version.createdAt)}</span>
                        </div>
                        <span>{t("filesCount", { count: version.fileCount })}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </>
        ) : (
          /* Compare result view */
          compareResult && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Stats */}
              <div className="px-4 py-3 border-b border-border flex items-center gap-4 text-sm">
                <span className="text-green-600 dark:text-green-400">
                  +{compareResult.stats.added} {t("added")}
                </span>
                <span className="text-red-600 dark:text-red-400">
                  -{compareResult.stats.removed} {t("removed")}
                </span>
                <span className="text-yellow-600 dark:text-yellow-400">
                  ~{compareResult.stats.modified} {t("modified")}
                </span>
              </div>

              {/* Diff view */}
              <DiffViewer
                diffs={compareResult.diffs}
                fromVersionName={compareResult.fromVersion.name}
                toVersionName={compareResult.toVersion.name}
              />
            </div>
          )
        )}
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
    </>
  );
}
