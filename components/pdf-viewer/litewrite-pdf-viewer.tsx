"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Loader2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Download,
  CheckCircle2,
  ChevronUp,
  ChevronDown,
  FileOutput,
  FileCode,
  FileType,
  FileDown,
  Play,
  AlertCircle,
  MoveHorizontal,
  MoveVertical,
} from "lucide-react";
import { useTranslations } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { PdfRenderer, type PdfRendererHandle, type ClickedWordInfo } from "./pdf-renderer";

// Jump info (includes word and context for more accurate navigation)
export interface SyncTexJumpInfo {
  file: string;
  line: number;
  clickedWord?: string;       // Word selected by double-click
  contextBefore?: string;     // Context before the word
  contextAfter?: string;      // Context after the word
}

type CompileStatus = "idle" | "compiling" | "success" | "error";

interface LitewritePdfViewerProps {
  pdfUrl: string;
  projectId: string;
  onSyncTexJump?: (info: SyncTexJumpInfo) => void;
  syncTexTarget?: {
    page: number;
    x: number;
    y: number;
    h?: number;  // SyncTeX h coordinate
    v?: number;  // SyncTeX v coordinate
    width?: number;
    height?: number;
  } | null;
  // Compile-related
  compileStatus?: CompileStatus;
  onCompile?: () => void;
  compileButtonText?: string;
}

interface SyncTexResult {
  success: boolean;
  file?: string;
  line?: number;
  column?: number;
  page?: number;
  errorCode?: string;
  error?: string;
  x?: number;
  y?: number;
}

export function LitewritePdfViewer({
  pdfUrl,
  projectId,
  onSyncTexJump,
  syncTexTarget,
  compileStatus = "success",
  onCompile,
  compileButtonText,
}: LitewritePdfViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageInput, setPageInput] = useState<string>("1");
  const [scale, setScale] = useState<number>(1.5);
  const [isLoading, setIsLoading] = useState(true);
  const [syncTexStatus, setSyncTexStatus] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const pdfRendererRef = useRef<PdfRendererHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const initialFitDoneRef = useRef(false);
  const { toast } = useToast();
  const { t } = useTranslations();

  // Scale edit state
  const [scaleInputOpen, setScaleInputOpen] = useState(false);
  const [scaleInputValue, setScaleInputValue] = useState("");
  const scaleInputRef = useRef<HTMLInputElement>(null);

  // Export to other formats
  const handleExport = async (format: 'markdown' | 'docx') => {
    setExporting(format);
    try {
      const response = await fetch(`/api/projects/${projectId}/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ format }),
      });

      // Check whether this is an error response (JSON)
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const data = await response.json();
        throw new Error(data.error?.code || "EXPORT_FAILED");
      }

      if (!response.ok) {
        throw new Error("EXPORT_FAILED");
      }

      // Fetch binary payload directly
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

      toast({
        title: t("export.success"),
        description: t("export.exportedAs", { filename: decodeURIComponent(filename) }),
      });
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: t("export.failed"),
        description: error instanceof Error ? error.message : t("export.unknownError"),
        variant: 'destructive',
      });
    } finally {
      setExporting(null);
    }
  };

  // Document loaded successfully
  const onDocumentLoadSuccess = useCallback((pages: number) => {
    console.log(`[Litewrite] Document loaded: ${pages} pages`);
    setNumPages(pages);
    setIsLoading(false);

    // Auto-fit width on first load
    if (!initialFitDoneRef.current) {
      setTimeout(() => {
        const container = containerRef.current;
        const pageSize = pdfRendererRef.current?.getPageSize?.(1);
        if (container && pageSize) {
          const containerWidth = container.clientWidth - 32;
          const newScale = containerWidth / pageSize.width;
          setScale(Math.min(Math.max(newScale, 0.5), 3.0));
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

  // Zoom controls
  const handleZoomIn = useCallback(() => setScale((prev) => Math.min(prev + 0.25, 3.0)), []);
  const handleZoomOut = useCallback(() => setScale((prev) => Math.max(prev - 0.25, 0.5)), []);
  const handleZoomReset = useCallback(() => setScale(1.0), []);

  // Click to open scale editor
  const handleScaleClick = useCallback(() => {
    setScaleInputValue(String(Math.round(scale * 100)));
    setScaleInputOpen(true);
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
      const containerWidth = container.clientWidth - 32;
      const newScale = containerWidth / pageSize.width;
      setScale(Math.min(Math.max(newScale, 0.5), 3.0));
    }
    setScaleInputOpen(false);
  }, []);

  // Fit to height
  const handleFitHeight = useCallback(() => {
    const container = containerRef.current;
    const pageSize = pdfRendererRef.current?.getPageSize?.(1);
    if (container && pageSize) {
      const containerHeight = container.clientHeight - 32;
      const newScale = containerHeight / pageSize.height;
      setScale(Math.min(Math.max(newScale, 0.5), 3.0));
    }
    setScaleInputOpen(false);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      // Only zoom while Ctrl/Meta is pressed (prevent browser default zoom)
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
  }, []);

  // Page navigation
  const goToPrevPage = useCallback(() => {
    console.log(`[Litewrite] goToPrevPage: currentPage=${currentPage}, ref=${!!pdfRendererRef.current}`);
    if (currentPage > 1 && pdfRendererRef.current) {
      pdfRendererRef.current.scrollToPage(currentPage - 1);
    }
  }, [currentPage]);

  const goToNextPage = useCallback(() => {
    console.log(`[Litewrite] goToNextPage: currentPage=${currentPage}, numPages=${numPages}, ref=${!!pdfRendererRef.current}`);
    if (currentPage < numPages && pdfRendererRef.current) {
      pdfRendererRef.current.scrollToPage(currentPage + 1);
    }
  }, [currentPage, numPages]);

  // Jump via page input
  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInput(e.target.value);
  };

  const handlePageInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const page = parseInt(pageInput, 10);
      console.log(`[Litewrite] Page input enter: page=${page}, ref=${!!pdfRendererRef.current}`);
      if (!isNaN(page) && page >= 1 && page <= numPages && pdfRendererRef.current) {
        pdfRendererRef.current.scrollToPage(page);
      } else {
        setPageInput(String(currentPage));
      }
    }
  };

  const handlePageInputBlur = () => {
    const page = parseInt(pageInput, 10);
    if (!isNaN(page) && page >= 1 && page <= numPages && pdfRendererRef.current) {
      pdfRendererRef.current.scrollToPage(page);
    } else {
      setPageInput(String(currentPage));
    }
  };

  // Handle PDF double-click - backward sync (PDF → editor)
  const handlePageClick = useCallback(async (pageNumber: number, pdfX: number, pdfY: number, clickedWord?: ClickedWordInfo) => {
    if (!onSyncTexJump) return;

    console.log(`[Litewrite] Double-click at page ${pageNumber}, PDF coords: (${pdfX.toFixed(2)}, ${pdfY.toFixed(2)}), word: ${clickedWord?.word || "(none)"}`);
    setSyncTexStatus(t("pdfViewer.syncTex.querying"));

    try {
      const response = await fetch(`/api/projects/${projectId}/synctex`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page: pageNumber,
          x: pdfX,
          y: pdfY,
          direction: "backward",
          // Pass context info for disambiguating multiple matches
          clickedWord: clickedWord?.word,
          contextBefore: clickedWord?.contextBefore,
          contextAfter: clickedWord?.contextAfter,
        }),
      });

      const result: SyncTexResult = await response.json();

      if (result.success && result.file && result.line) {
        const wordInfo = clickedWord?.word ? ` "${clickedWord.word}"` : "";
        console.log(`[Litewrite] SyncTeX: ${result.file}:${result.line}${wordInfo}`);
        setSyncTexStatus(t("pdfViewer.syncTex.jumpToLine", { file: result.file, line: result.line, word: wordInfo }));

        // Pass full jump info including word and context
        onSyncTexJump({
          file: result.file,
          line: result.line,
          clickedWord: clickedWord?.word,
          contextBefore: clickedWord?.contextBefore,
          contextAfter: clickedWord?.contextAfter,
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
  }, [projectId, onSyncTexJump]);

  // Handle forward sync target (editor → PDF)
  useEffect(() => {
    if (syncTexTarget && pdfRendererRef.current) {
      console.log(`[Litewrite] Forward sync to page ${syncTexTarget.page}`, syncTexTarget);

      // Currently uses full-page highlight; can be upgraded to precise area highlight later.
      // For precise highlighting, you can use highlightArea:
      // if (syncTexTarget.width && syncTexTarget.height) {
      //   pdfRendererRef.current.highlightArea(
      //     syncTexTarget.page,
      //     syncTexTarget.h || syncTexTarget.x,
      //     syncTexTarget.v || syncTexTarget.y,
      //     syncTexTarget.width,
      //     syncTexTarget.height
      //   );
      // }

      // Full-page highlight (via scrolling)
      pdfRendererRef.current.scrollToPage(syncTexTarget.page);

      setSyncTexStatus(t("pdfViewer.syncTex.locatedToPage", { page: syncTexTarget.page }));
      setTimeout(() => setSyncTexStatus(null), 3000);
    }
  }, [syncTexTarget]);

  // Get compile button icon
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

  return (
    <div className="flex h-full flex-col">
      {/* Unified toolbar — single-line layout; z-10 above PDF content without covering dialogs */}
      <div className="relative z-10 flex flex-nowrap items-center justify-between border-b border-litewrite-cyan/20 bg-gradient-to-r from-litewrite-cyan/5 via-litewrite-teal/5 to-litewrite-blue/5 backdrop-blur-sm px-3 py-1.5 min-w-0">
        {/* Left: compile button */}
        <div className="flex flex-nowrap items-center gap-2 flex-shrink-0">
          {onCompile && (
            <Button
              onClick={onCompile}
              disabled={compileStatus === "compiling"}
              size="sm"
              className={`gap-1.5 h-7 px-3 rounded-md text-xs font-medium transition-all duration-200 ${
                compileStatus === "idle" ? "bg-litewrite-cyan text-white hover:bg-litewrite-cyan/90" :
                compileStatus === "compiling" ? "bg-litewrite-cyan text-white" :
                compileStatus === "success" ? "bg-litewrite-teal text-white hover:bg-litewrite-teal/90" :
                "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              }`}
            >
              {getCompileIcon()}
              <span>{compileButtonText || t("compile.compileSuccess")}</span>
            </Button>
          )}

          <div className="h-4 w-px bg-border" />

          {/* Page navigation */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={goToPrevPage}
            disabled={currentPage <= 1}
            title={t("pdfViewer.prevPage")}
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
            title={t("pdfViewer.nextPage")}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>

          <div className="h-4 w-px bg-border" />

          {/* Zoom controls */}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomOut} title={t("pdfViewer.zoomOut")}>
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
                    <span>{t("pdfViewer.fitWidth")}</span>
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent rounded-sm transition-colors text-left whitespace-nowrap"
                    onMouseDown={(e) => { e.preventDefault(); handleFitHeight(); }}
                  >
                    <MoveVertical className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>{t("pdfViewer.fitHeight")}</span>
                  </button>
                </div>
              </>
            ) : (
              <span
                className="w-full text-center text-xs text-muted-foreground cursor-pointer hover:text-foreground hover:bg-accent/50 px-1.5 py-0.5 rounded transition-colors select-none"
                onClick={handleScaleClick}
                title={t("pdfViewer.clickToEdit")}
              >
                {Math.round(scale * 100)}%
              </span>
            )}
          </div>

          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomIn} title={t("pdfViewer.zoomIn")}>
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleFitWidth} title={t("pdfViewer.resetZoom")}>
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Right: status + download + export */}
        <div className="flex flex-nowrap items-center gap-2 flex-shrink-0">
          <div className="flex items-center gap-1 text-xs text-litewrite-teal">
            <CheckCircle2 className="h-3 w-3" />
            <span className="hidden md:inline">Litewrite</span>
          </div>

          {/* Download button */}
          <Button variant="ghost" size="sm" className="h-7 px-2" asChild>
            <a href={pdfUrl} download title={t("pdfViewer.downloadPdf")}>
              <Download className="h-3.5 w-3.5" />
              <span className="ml-1 hidden sm:inline">{t("common.download")}</span>
            </a>
          </Button>

          {/* Export menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                {exporting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileOutput className="h-3.5 w-3.5" />
                )}
                <span className="ml-1 hidden sm:inline">{t("pdfViewer.export")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                {t("pdfViewer.selectExportFormat")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleExport('markdown')}
                disabled={!!exporting}
                className="gap-2"
              >
                <FileCode className="h-4 w-4" />
                <span>Markdown</span>
                {exporting === 'markdown' && <Loader2 className="h-3 w-3 animate-spin ml-auto" />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* PDF area - continuous scrolling, supports Ctrl+wheel zoom */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-white dark:bg-slate-900"
      >
        <div className="p-4">
          <PdfRenderer
            ref={pdfRendererRef}
            pdfUrl={pdfUrl}
            scale={scale}
            onLoadSuccess={onDocumentLoadSuccess}
            onPageClick={handlePageClick}
            onVisiblePageChange={handleVisiblePageChange}
          />
        </div>
      </div>

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
}
