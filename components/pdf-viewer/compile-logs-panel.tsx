"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronRight,
  FileText,
  ExternalLink,
} from "lucide-react";

export interface CompileLogItem {
  message: string;
  severity: "error" | "warning" | "info";
  file?: string;
  line?: number;
}

export interface CompileLogStats {
  errors: number;
  warnings: number;
  info: number;
}

interface CompileLogsPanelProps {
  logs: CompileLogItem[];
  stats: CompileLogStats;
  rawLogs?: string;
  onJumpToSource?: (file: string, line: number) => void;
  className?: string;
}

type LogFilter = "all" | "error" | "warning" | "info";

export function CompileLogsPanel({
  logs,
  stats,
  rawLogs,
  onJumpToSource,
  className,
}: CompileLogsPanelProps) {
  const { t } = useTranslations("compileLogs");
  const [activeFilter, setActiveFilter] = useState<LogFilter>("all");
  const [rawLogsOpen, setRawLogsOpen] = useState(false);

  // Filter logs
  const filteredLogs = useMemo(() => {
    if (activeFilter === "all") return logs;
    return logs.filter((log) => log.severity === activeFilter);
  }, [logs, activeFilter]);

  // Get severity icon
  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case "error":
        return <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />;
      case "warning":
        return <AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0" />;
      case "info":
        return <Info className="h-4 w-4 text-blue-500 flex-shrink-0" />;
      default:
        return <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />;
    }
  };

  // Tab button styles
  const TabButton = ({
    filter,
    label,
    count,
  }: {
    filter: LogFilter;
    label: string;
    count: number;
  }) => (
    <button
      onClick={() => setActiveFilter(filter)}
      className={cn(
        "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
        activeFilter === filter
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {label} {count > 0 && <span className="ml-1">({count})</span>}
    </button>
  );

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Tabs */}
      <div className="flex items-center gap-1 p-2 border-b bg-muted/30">
        <TabButton filter="all" label={t("all")} count={logs.length} />
        <TabButton filter="error" label={t("errors")} count={stats.errors} />
        <TabButton filter="warning" label={t("warnings")} count={stats.warnings} />
        <TabButton filter="info" label={t("info")} count={stats.info} />
      </div>

      {/* Log list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {filteredLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t("noLogs")}
            </p>
          ) : (
            filteredLogs.map((log, index) => (
              <div
                key={index}
                className={cn(
                  "flex items-start gap-2 p-2 rounded-md text-sm",
                  "hover:bg-muted/50 transition-colors",
                  log.severity === "error" && "bg-destructive/5",
                  log.severity === "warning" && "bg-yellow-500/5"
                )}
              >
                {getSeverityIcon(log.severity)}
                <div className="flex-1 min-w-0">
                  <p className="text-foreground break-words">{log.message}</p>
                  {(log.file || log.line) && (
                    <div className="flex items-center gap-2 mt-1">
                      {log.file && (
                        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {log.file}
                        </span>
                      )}
                      {log.line && (
                        <span className="text-xs text-muted-foreground">
                          {t("line", { line: log.line })}
                        </span>
                      )}
                      {log.file && log.line && onJumpToSource && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 px-1.5 text-xs"
                          onClick={() => onJumpToSource(log.file!, log.line!)}
                        >
                          <ExternalLink className="h-3 w-3 mr-1" />
                          {t("jumpToSource")}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Raw logs collapsible section */}
      {rawLogs && (
        <Collapsible open={rawLogsOpen} onOpenChange={setRawLogsOpen}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 w-full p-2 border-t text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
              {rawLogsOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              {t("rawLogs")}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ScrollArea className="h-48 border-t">
              <pre className="p-2 text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all">
                {rawLogs}
              </pre>
            </ScrollArea>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
