"use client";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  FileText,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Play,
  AlertTriangle,
  ChevronUp,
  ChevronDown,
  PanelRightClose,
  MoveHorizontal,
  MoveVertical,
  FileOutput,
  X,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { AnimatedLogo } from "@/components/ui/animated-logo";
import { useTranslations } from "@/lib/i18n";
import type { CompileStatus, CompileResult, CompileError } from "@/types";
import { cn } from "@/lib/utils";
import { useState, useCallback, useEffect, useRef, Component, ReactNode } from "react";
import { CompileLogsPanel } from "./compile-logs-panel";

// Error Boundary
class LitewriteErrorBoundary extends Component<
  { children: ReactNode; onError: () => void; fallback: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; onError: () => void; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("[Litewrite] Error:", error);
    this.props.onError();
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// Jump info type
interface SyncTexJumpInfo {
  file: string;
  line: number;
  clickedWord?: string;
  contextBefore?: string;
  contextAfter?: string;
  wordPositionRatio?: number;
}

interface PdfViewerProps {
  compileStatus: CompileStatus;
  compileResult: CompileResult | null;
  onCompile: () => void;
  projectId: string;
  pdfViewer?: "browser" | "litewrite";
  onSyncTexJump?: (info: SyncTexJumpInfo) => void;
  syncTexTarget?: { page: number; x: number; y: number } | null;
  onSwitchToDrawio?: () => void;
  onToggle?: () => void; // Collapse/expand preview area
  compileProgress?: number; // Compile progress 0-100
  compileStage?: string; // Compile stage
}

export function PdfViewer({
  compileStatus,
  compileResult,
  onCompile,
  projectId,
  pdfViewer = "litewrite",
  onSyncTexJump,
  syncTexTarget,
  onSwitchToDrawio,
  onToggle,
  compileProgress = 0,
  compileStage,
}: PdfViewerProps) {
  const { t } = useTranslations("pdfViewer");
  const { t: tEditor } = useTranslations("editor");
  const { t: tCompile } = useTranslations("compile");
  const { t: tLogs } = useTranslations("compileLogs");

  // PDF control state
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [scale, setScale] = useState(1.5);
  const [litewriteFailed, setLitewriteFailed] = useState(false);
  const [LitewriteRenderer, setLitewriteRenderer] = useState<React.ComponentType<any> | null>(null);
  const [rendererLoading, setRendererLoading] = useState(true);
  const [showLogsPanel, setShowLogsPanel] = useState(false);
  const [syncTexStatus, setSyncTexStatus] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfRendererRef = useRef<any>(null);
  const initialFitDoneRef = useRef(false);

  // Scale edit state
  const [scaleInputOpen, setScaleInputOpen] = useState(false);
  const [scaleInputValue, setScaleInputValue] = useState("");
  const scaleInputRef = useRef<HTMLInputElement>(null);

  // Load Litewrite renderer
  useEffect(() => {
    if (pdfViewer === "litewrite") {
      import("./pdf-renderer")
        .then((mod) => {
          setLitewriteRenderer(() => mod.PdfRenderer);
          setRendererLoading(false);
        })
        .catch((err) => {
          console.error("[Litewrite] Failed to load renderer:", err);
          setLitewriteFailed(true);
          setRendererLoading(false);
        });
    }
  }, [pdfViewer]);

  // Reset failure state
  useEffect(() => {
    if (pdfViewer === "litewrite") {
      setLitewriteFailed(false);
    }
  }, [pdfViewer]);

  // Handle forward sync target (editor → PDF)
  useEffect(() => {
    if (syncTexTarget && pdfRendererRef.current) {
      console.log(`[PdfViewer] Forward sync to page ${syncTexTarget.page}`, syncTexTarget);
      pdfRendererRef.current.scrollToPage(syncTexTarget.page);
      setSyncTexStatus(t("pdfViewer.syncTex.locatedToPage", { page: syncTexTarget.page }));
      setTimeout(() => setSyncTexStatus(null), 3000);
    }
  }, [syncTexTarget, t]);

  // Handle PDF clicks (SyncTeX backward sync)
  const handlePageClick = useCallback(async (
    pageNumber: number,
    x: number,
    y: number,
    clickedWord?: { word: string; contextBefore?: string; contextAfter?: string }
  ) => {
    if (!onSyncTexJump) return;

    console.log(`[Litewrite] Double-click at page ${pageNumber}, PDF coords: (${x.toFixed(2)}, ${y.toFixed(2)}), word: ${clickedWord?.word || "(none)"}`);
    setSyncTexStatus(t("syncTex.findingSource"));

    try {
      const response = await fetch(`/api/projects/${projectId}/synctex`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page: pageNumber,
          x,
          y,
          direction: "backward",
          // Pass context info for disambiguating multiple matches
          clickedWord: clickedWord?.word,
          contextBefore: clickedWord?.contextBefore,
          contextAfter: clickedWord?.contextAfter,
        }),
      });

      const result = await response.json();

      if (result.success && result.file && result.line) {
        const wordInfo = clickedWord?.word ? ` "${clickedWord.word}"` : "";
        console.log(`[Litewrite] SyncTeX: ${result.file}:${result.line}${wordInfo}`);
        setSyncTexStatus(t("pdfViewer.syncTex.jumpToLine", { file: result.file, line: result.line, word: wordInfo }));
        onSyncTexJump({
          file: result.file,
          line: result.line,
          clickedWord: clickedWord?.word,
          contextBefore: clickedWord?.contextBefore,
          contextAfter: clickedWord?.contextAfter,
          wordPositionRatio: 0,
        });
        setTimeout(() => setSyncTexStatus(null), 3000);
      } else {
        console.log(`[Litewrite] SyncTeX not found:`, result.errorCode || result.error);
        // Prefer translating via errorCode; otherwise fall back to positionNotFound
        const errorMessage = result.errorCode
          ? t(`apiErrors.${result.errorCode}`)
          : t("syncTex.positionNotFound");
        setSyncTexStatus(errorMessage);
        setTimeout(() => setSyncTexStatus(null), 3000);
      }
    } catch (error) {
      console.error("[Litewrite] SyncTeX error:", error);
      setSyncTexStatus(t("syncTex.queryFailed"));
      setTimeout(() => setSyncTexStatus(null), 3000);
    }
  }, [projectId, onSyncTexJump, t]);

  // Compile button
  const getCompileIcon = () => {
    switch (compileStatus) {
      case "compiling":
        return <Loader2 className="h-4 w-4 animate-spin" />;
      case "success":
        return <CheckCircle2 className="h-4 w-4" />;
      case "error":
        return <AlertCircle className="h-4 w-4" />;
      default:
        return <Play className="h-4 w-4" />;
    }
  };

  const getCompileText = () => {
    switch (compileStatus) {
      case "compiling":
        return tEditor("compile.compiling");
      case "success":
        return tEditor("compile.success");
      case "error":
        return tEditor("compile.error");
      default:
        return tEditor("compile.idle");
    }
  };

  // Page navigation
  const goToPrevPage = useCallback(() => {
    if (currentPage > 1) {
      const newPage = currentPage - 1;
      setCurrentPage(newPage);
      setPageInput(String(newPage));
      pdfRendererRef.current?.scrollToPage(newPage);
    }
  }, [currentPage]);

  const goToNextPage = useCallback(() => {
    if (currentPage < numPages) {
      const newPage = currentPage + 1;
      setCurrentPage(newPage);
      setPageInput(String(newPage));
      pdfRendererRef.current?.scrollToPage(newPage);
    }
  }, [currentPage, numPages]);

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInput(e.target.value);
  };

  const handlePageInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const page = parseInt(pageInput, 10);
      if (!isNaN(page) && page >= 1 && page <= numPages) {
        setCurrentPage(page);
        pdfRendererRef.current?.scrollToPage(page);
      } else {
        setPageInput(String(currentPage));
      }
    }
  };

  const handlePageInputBlur = () => {
    const page = parseInt(pageInput, 10);
    if (isNaN(page) || page < 1 || page > numPages) {
      setPageInput(String(currentPage));
    }
  };

  // Zoom controls
  const handleZoomIn = useCallback(() => setScale((prev) => Math.min(prev + 0.25, 3.0)), []);
  const handleZoomOut = useCallback(() => setScale((prev) => Math.max(prev - 0.25, 0.5)), []);
  const handleZoomReset = useCallback(() => setScale(1.5), []);

  // Click to open scale editor
  const handleScaleClick = useCallback(() => {
    setScaleInputValue(String(Math.round(scale * 100)));
    setScaleInputOpen(true);
    // Delay focus until the input is rendered
    setTimeout(() => scaleInputRef.current?.select(), 0);
  }, [scale]);

  // Confirm scale input
  const handleScaleInputSubmit = useCallback(() => {
    const value = parseInt(scaleInputValue, 10);
    if (!isNaN(value) && value >= 50 && value <= 300) {
      setScale(value / 100);
    }
    setScaleInputOpen(false);
  }, [scaleInputValue]);

  // Scale input key handlers
  const handleScaleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleScaleInputSubmit();
    } else if (e.key === "Escape") {
      setScaleInputOpen(false);
    }
  }, [handleScaleInputSubmit]);

  // Fit to width
  const handleFitWidth = useCallback(() => {
    const container = containerRef.current;
    const pageSize = pdfRendererRef.current?.getPageSize?.(1);
    if (container && pageSize) {
      // Container width minus padding (16px left + 16px right = 32px)
      const containerWidth = container.clientWidth - 32;
      const newScale = containerWidth / pageSize.width;
      setScale(Math.min(Math.max(newScale, 0.5), 3.0));
    }
    setScaleInputOpen(false);
  }, []);

  // Fit to height (show a full page)
  const handleFitHeight = useCallback(() => {
    const container = containerRef.current;
    const pageSize = pdfRendererRef.current?.getPageSize?.(1);
    if (container && pageSize) {
      // Container height minus padding (16px top + 16px bottom = 32px)
      const containerHeight = container.clientHeight - 32;
      const newScale = containerHeight / pageSize.height;
      setScale(Math.min(Math.max(newScale, 0.5), 3.0));
    }
    setScaleInputOpen(false);
  }, []);

  // Ctrl + wheel zooms the PDF (prevents browser default zoom)
  // Depends on compileStatus and showLogsPanel to only bind when the PDF area is visible
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      // Only zoom when Ctrl/Meta is pressed
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        if (e.deltaY < 0) {
          // Scroll up = zoom in
          setScale((prev) => Math.min(prev + 0.1, 3.0));
        } else {
          // Scroll down = zoom out
          setScale((prev) => Math.max(prev - 0.1, 0.5));
        }
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [compileStatus, showLogsPanel]);

  // PDF load succeeded
  const onDocumentLoadSuccess = useCallback((pages: number) => {
    setNumPages(pages);

    // Auto-fit width on first load
    if (!initialFitDoneRef.current) {
      // Delay until pdfRenderer is fully initialized
      setTimeout(() => {
        const container = containerRef.current;
        const pageSize = pdfRendererRef.current?.getPageSize?.(1);
        if (container && pageSize) {
          const containerWidth = container.clientWidth - 32;
          const newScale = containerWidth / pageSize.width;
          setScale(Math.min(Math.max(newScale, 0.5), 3.0));
          // Mark as done only after a successful fit-to-width
          initialFitDoneRef.current = true;
        }
      }, 100);
    }
  }, []);

  // Visible page changed
  const handleVisiblePageChange = useCallback((pageNumber: number) => {
    setCurrentPage(pageNumber);
    setPageInput(String(pageNumber));
  }, []);

  // Error message handling
  const getErrorMessage = useCallback((error: CompileError): string => {
    if (error.code) {
      const translated = tCompile(`errors.${error.code}`);
      if (translated && !translated.startsWith("compile.errors.")) {
        return translated;
      }
    }
    return error.message;
  }, [tCompile]);

  // Determine whether PDF controls can be shown
  const showPdfControls = compileStatus === "success" && compileResult?.pdfUrl;

  return (
    <div className="flex h-full flex-col bg-white dark:bg-slate-900">
      {/* Unified toolbar — always single-line, z-10 above PDF content */}
      <div className="relative z-10 flex flex-nowrap items-center justify-between border-b border-litewrite-cyan/20 bg-gradient-to-r from-litewrite-cyan/5 via-litewrite-teal/5 to-litewrite-blue/5 backdrop-blur-sm px-3 py-1.5 min-w-0">
        {/* Left: compile button + PDF controls */}
        <div className="flex flex-nowrap items-center gap-2 flex-shrink-0">
          {/* Compile button + logs button group */}
          <div className="flex items-center">
            {/* Compile button */}
            <Button
              onClick={onCompile}
              disabled={compileStatus === "compiling"}
              size="sm"
              className={cn(
                "gap-1.5 h-7 px-3 rounded-l-md rounded-r-none text-xs font-medium transition-all duration-200",
                compileStatus === "idle" && "bg-litewrite-cyan text-white hover:bg-litewrite-cyan/90",
                compileStatus === "compiling" && "bg-litewrite-cyan text-white",
                compileStatus === "success" && "bg-litewrite-teal text-white hover:bg-litewrite-teal/90",
                compileStatus === "error" && "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              )}
            >
              {getCompileIcon()}
              <span>{getCompileText()}</span>
            </Button>

            {/* Logs button - shown after compilation */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 px-2 rounded-l-none rounded-r-md border-l transition-all duration-200 relative",
                    (compileStatus === "success" || compileStatus === "error") && compileResult?.parsedLogs
                      ? showLogsPanel
                        ? "bg-muted"
                        : "hover:bg-muted/50"
                      : "opacity-50 cursor-not-allowed",
                    compileStatus === "success" && "border-litewrite-teal/30 text-litewrite-teal",
                    compileStatus === "error" && "border-destructive/30 text-destructive",
                    compileStatus === "idle" && "border-litewrite-cyan/30 text-muted-foreground",
                    compileStatus === "compiling" && "border-litewrite-cyan/30 text-muted-foreground"
                  )}
                  onClick={() => compileResult?.parsedLogs && setShowLogsPanel(!showLogsPanel)}
                  disabled={!compileResult?.parsedLogs}
                >
                  <FileOutput className="h-3.5 w-3.5" />
                  {/* Logs count bubble */}
                  {compileResult?.logStats && (compileResult.logStats.errors > 0 || compileResult.logStats.warnings > 0) && (
                    <span className={cn(
                      "absolute -top-1 -right-1 min-w-[16px] h-4 px-1 text-[10px] font-medium rounded-full flex items-center justify-center",
                      compileResult.logStats.errors > 0
                        ? "bg-destructive text-destructive-foreground"
                        : "bg-amber-500 text-white"
                    )}>
                      {compileResult.logStats.errors > 0
                        ? compileResult.logStats.errors
                        : compileResult.logStats.warnings}
                    </span>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {compileResult?.logStats
                    ? `${tLogs("errors")}: ${compileResult.logStats.errors}, ${tLogs("warnings")}: ${compileResult.logStats.warnings}`
                    : tLogs("noLogs")}
                </p>
              </TooltipContent>
            </Tooltip>
          </div>

          {showPdfControls && <div className="h-4 w-px bg-border" />}

          {/* Page navigation */}
          {showPdfControls && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={goToPrevPage}
                disabled={currentPage <= 1}
                title={t("prevPage")}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>

              <div className="flex items-center gap-1">
                <Input
                  type="text"
                  value={pageInput}
                  onChange={handlePageInputChange}
                  onKeyDown={handlePageInputKeyDown}
                  onBlur={handlePageInputBlur}
                  className="h-6 w-10 text-center text-xs px-1"
                />
                <span className="text-xs text-muted-foreground">/ {numPages || "-"}</span>
              </div>

              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={goToNextPage}
                disabled={currentPage >= numPages}
                title={t("nextPage")}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>

              <div className="h-4 w-px bg-border" />

              {/* Zoom controls */}
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomOut} title={t("zoomOut")}>
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>

              {/* Zoom percentage - click to edit; fixed width to prevent layout jitter */}
              <div className="relative w-[3.5rem] flex justify-center">
                {scaleInputOpen ? (
                  <>
                    <div className="flex items-center gap-0.5">
                      <Input
                        ref={scaleInputRef}
                        type="text"
                        value={scaleInputValue}
                        onChange={(e) => setScaleInputValue(e.target.value)}
                        onKeyDown={handleScaleInputKeyDown}
                        onBlur={() => setTimeout(() => setScaleInputOpen(false), 150)}
                        className="h-6 w-10 text-center text-xs px-0.5"
                        autoFocus
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                    {/* Fit options dropdown */}
                    <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-1 bg-popover border border-border rounded-md shadow-lg p-1 whitespace-nowrap">
                      <button
                        type="button"
                        className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent rounded-sm transition-colors text-left whitespace-nowrap"
                        onMouseDown={(e) => { e.preventDefault(); handleFitWidth(); }}
                      >
                        <MoveHorizontal className="h-3.5 w-3.5 flex-shrink-0" />
                        <span>{t("fitWidth")}</span>
                      </button>
                      <button
                        type="button"
                        className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent rounded-sm transition-colors text-left whitespace-nowrap"
                        onMouseDown={(e) => { e.preventDefault(); handleFitHeight(); }}
                      >
                        <MoveVertical className="h-3.5 w-3.5 flex-shrink-0" />
                        <span>{t("fitHeight")}</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="w-full text-center text-xs text-muted-foreground cursor-pointer hover:text-foreground hover:bg-accent/50 px-1.5 py-0.5 rounded transition-colors select-none"
                        onClick={handleScaleClick}
                      >
                        {Math.round(scale * 100)}%
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p>{t("clickToEdit")}</p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>

              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomIn} title={t("zoomIn")}>
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleFitWidth} title={t("resetZoom")}>
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>

        {/* Right: status indicator */}
        <div className="flex flex-nowrap items-center gap-2 flex-shrink-0">
          {showPdfControls && (
            <div className="flex items-center gap-1 text-xs text-litewrite-teal">
              <CheckCircle2 className="h-3 w-3" />
              <span className="hidden md:inline">Litewrite</span>
            </div>
          )}

          {!showPdfControls && (
            <div className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-primary/60" />
              <span className="text-xs font-medium text-muted-foreground">
                {t("title")}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden">
        {/* Idle state */}
        {compileStatus === "idle" && !compileResult && (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <div className="mb-4 rounded-full bg-muted p-4">
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-medium">{t("empty.title")}</h3>
            <p className="mb-4 text-sm text-muted-foreground">{t("empty.description")}</p>
            <Button onClick={onCompile}>
              <Play className="mr-2 h-4 w-4" />
              {tEditor("compile.idle")}
            </Button>
          </div>
        )}

        {/* Compiling state */}
        {compileStatus === "compiling" && (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <AnimatedLogo width={80} height={42} duration={1.2} pauseDuration={300} className="mb-4" />
            <h3 className="mb-2 text-lg font-medium">{t("compiling.title")}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {compileStage || t("compiling.description")}
            </p>
            {/* Progress bar */}
            <div className="w-full max-w-xs space-y-2">
              <Progress value={compileProgress} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {tLogs("progress.compiling", { percent: compileProgress })}
              </p>
            </div>
          </div>
        )}

        {/* Error state - uses logs panel */}
        {compileStatus === "error" && (
          <div className="flex h-full flex-col">
            <div className="mx-4 mt-4 mb-2 flex items-center gap-2 rounded-lg bg-destructive/10 p-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="font-medium text-destructive">{t("error.title")}</span>
            </div>

            {compileResult?.parsedLogs ? (
              <div className="flex-1 overflow-hidden">
                <CompileLogsPanel
                  logs={compileResult.parsedLogs}
                  stats={compileResult.logStats || { errors: 0, warnings: 0, info: 0 }}
                  rawLogs={compileResult.logs}
                  onJumpToSource={(file, line) => {
                    if (onSyncTexJump) {
                      onSyncTexJump({ file, line });
                    }
                  }}
                />
              </div>
            ) : (
              <ScrollArea className="flex-1 px-4">
                <div className="space-y-2">
                  {compileResult?.errors?.map((error, index) => (
                    <div
                      key={index}
                      className={cn(
                        "rounded-md p-3 text-sm",
                        error.severity === "error" ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-600"
                      )}
                    >
                      {error.file && error.line && (
                        <div className="mb-1 font-mono text-xs opacity-70">
                          {error.file}:{error.line}{error.column && `:${error.column}`}
                        </div>
                      )}
                      <div>{getErrorMessage(error)}</div>
                    </div>
                  ))}
                </div>
                {compileResult?.logs && (
                  <div className="mt-4">
                    <h4 className="mb-2 text-sm font-medium text-muted-foreground">{t("error.logs")}</h4>
                    <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">{compileResult.logs}</pre>
                  </div>
                )}
              </ScrollArea>
            )}

            <div className="p-4">
              <Button onClick={onCompile} className="w-full">
                <RotateCcw className="mr-2 h-4 w-4" />
                {t("error.recompile")}
              </Button>
            </div>
          </div>
        )}

        {/* Success state - show PDF or logs panel (overlay toggle) */}
        {compileStatus === "success" && compileResult?.pdfUrl && (
          <div className="h-full">
            {/* Logs panel (overlays PDF) */}
            {showLogsPanel && compileResult.parsedLogs ? (
              <div className="h-full bg-background flex flex-col">
                {/* Logs panel title bar */}
                <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                  <span className="text-sm font-medium">{tLogs("title")}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => setShowLogsPanel(false)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex-1 overflow-hidden">
                  <CompileLogsPanel
                    logs={compileResult.parsedLogs}
                    stats={compileResult.logStats || { errors: 0, warnings: 0, info: 0 }}
                    rawLogs={compileResult.logs}
                    onJumpToSource={(file, line) => {
                      console.log("[Logs] Jump to source:", file, line);
                      if (onSyncTexJump) {
                        // Close logs panel before jumping
                        setShowLogsPanel(false);
                        onSyncTexJump({ file, line });
                      }
                    }}
                  />
                </div>
              </div>
            ) : (
              /* PDF area */
              <div ref={containerRef} className="h-full overflow-auto">
                {pdfViewer === "litewrite" && !litewriteFailed && LitewriteRenderer ? (
                  <LitewriteErrorBoundary
                    onError={() => setLitewriteFailed(true)}
                    fallback={
                      <div className="flex h-full flex-col">
                        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          <span>{t("litewriteFallback")}</span>
                        </div>
                        <iframe title="PDF preview" src={compileResult.pdfUrl} className="flex-1 w-full border-0" />
                      </div>
                    }
                  >
                    <div className="p-4">
                      <LitewriteRenderer
                        ref={pdfRendererRef}
                        pdfUrl={compileResult.pdfUrl}
                        scale={scale}
                        onLoadSuccess={onDocumentLoadSuccess}
                        onPageClick={handlePageClick}
                        onVisiblePageChange={handleVisiblePageChange}
                      />
                    </div>
                  </LitewriteErrorBoundary>
                ) : (
                  <iframe
                    title="PDF preview"
                    src={compileResult.pdfUrl}
                    className="h-full w-full border-0"
                    style={{ transform: `scale(${scale})`, transformOrigin: "top center" }}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
