"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Minus, FileText, FilePlus, FileMinus, FileEdit } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/lib/i18n";
import { ScrollArea } from "@/components/ui/scroll-area";

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

interface DiffViewerProps {
  diffs: FileDiff[];
  fromVersionName?: string;
  toVersionName?: string;
}

export function DiffViewer({ diffs, fromVersionName, toVersionName }: DiffViewerProps) {
  const { t } = useTranslations("history");
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(
    new Set(diffs.filter(d => d.status !== "unchanged").map(d => d.filePath))
  );

  // Get version display name (handle special markers)
  const getVersionDisplayName = (name: string | undefined) => {
    if (!name) return t("unknownVersion");
    if (name === "__CURRENT_VERSION__") {
      return t("currentVersion");
    }
    return name;
  };

  const toggleFile = (filePath: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  };

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

  const getStatusBadge = (status: FileDiff["status"]) => {
    switch (status) {
      case "added":
        return (
          <span className="px-1.5 py-0.5 text-xs rounded bg-green-500/10 text-green-600 dark:text-green-400">
            {t("fileAdded")}
          </span>
        );
      case "removed":
        return (
          <span className="px-1.5 py-0.5 text-xs rounded bg-red-500/10 text-red-600 dark:text-red-400">
            {t("fileRemoved")}
          </span>
        );
      case "modified":
        return (
          <span className="px-1.5 py-0.5 text-xs rounded bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
            {t("fileModified")}
          </span>
        );
      default:
        return null;
    }
  };

  // Count changed lines
  const getLineCounts = (diff: DiffLine[]) => {
    const added = diff.filter(l => l.type === "added").length;
    const removed = diff.filter(l => l.type === "removed").length;
    return { added, removed };
  };

  // Filter files with changes
  const changedFiles = diffs.filter(d => d.status !== "unchanged");
  const unchangedFiles = diffs.filter(d => d.status === "unchanged");

  if (diffs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <FileText className="h-12 w-12 mb-4 opacity-50" />
        <p>{t("noDifferences")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Version info */}
      {(fromVersionName || toVersionName) && (
        <div className="flex items-center gap-2 px-4 py-2 bg-muted/50 text-sm border-b">
          <span className="text-muted-foreground">
            {t("comparingVersions", {
              from: getVersionDisplayName(fromVersionName),
              to: getVersionDisplayName(toVersionName)
            })}
          </span>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="divide-y divide-border">
          {/* Files with changes */}
          {changedFiles.map((fileDiff) => {
            const isExpanded = expandedFiles.has(fileDiff.filePath);
            const { added, removed } = getLineCounts(fileDiff.diff);

            return (
              <div key={fileDiff.filePath} className="bg-background">
                {/* File header */}
                <div
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 cursor-pointer hover:bg-muted/50 transition-colors",
                    isExpanded && "bg-muted/30"
                  )}
                  onClick={() => toggleFile(fileDiff.filePath)}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  {getStatusIcon(fileDiff.status)}
                  <span className="flex-1 font-mono text-sm truncate">
                    {fileDiff.filePath}
                  </span>
                  {getStatusBadge(fileDiff.status)}
                  {fileDiff.status !== "unchanged" && (
                    <div className="flex items-center gap-2 text-xs">
                      {added > 0 && (
                        <span className="text-green-600 dark:text-green-400 flex items-center gap-0.5">
                          <Plus className="h-3 w-3" />
                          {added}
                        </span>
                      )}
                      {removed > 0 && (
                        <span className="text-red-600 dark:text-red-400 flex items-center gap-0.5">
                          <Minus className="h-3 w-3" />
                          {removed}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Diff content */}
                {isExpanded && fileDiff.diff.length > 0 && (
                  <div className="border-t border-border overflow-x-auto">
                    <table className="w-full text-xs font-mono">
                      <tbody>
                        {fileDiff.diff.map((line, idx) => (
                          <tr
                            key={idx}
                            className={cn(
                              line.type === "added" && "bg-green-500/10",
                              line.type === "removed" && "bg-red-500/10"
                            )}
                          >
                            {/* Old line number */}
                            <td className="w-12 text-right px-2 py-0.5 text-muted-foreground select-none border-r border-border/50">
                              {line.oldLineNumber || ""}
                            </td>
                            {/* New line number */}
                            <td className="w-12 text-right px-2 py-0.5 text-muted-foreground select-none border-r border-border/50">
                              {line.newLineNumber || ""}
                            </td>
                            {/* Diff marker */}
                            <td className="w-6 text-center select-none">
                              {line.type === "added" && (
                                <span className="text-green-600 dark:text-green-400">+</span>
                              )}
                              {line.type === "removed" && (
                                <span className="text-red-600 dark:text-red-400">-</span>
                              )}
                            </td>
                            {/* Content */}
                            <td className="px-2 py-0.5 whitespace-pre">
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

          {/* Unchanged files (collapsed) */}
          {unchangedFiles.length > 0 && (
            <div className="px-4 py-2 text-sm text-muted-foreground bg-muted/20">
              <span>{t("unchangedFiles", { count: unchangedFiles.length })}</span>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
