"use client";

import { useState, useEffect } from "react";
import { FileIcon, ImageIcon, FileTextIcon, Loader2, AlertCircle, Download, ZoomIn, ZoomOut, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/lib/i18n";

interface FilePreviewProps {
  projectId: string;
  filePath: string;
  fileName: string;
  className?: string;
}

type FileType = "pdf" | "image" | "unsupported";

// Determine file type
function getFileType(fileName: string): FileType {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";

  if (ext === "pdf") {
    return "pdf";
  }

  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) {
    return "image";
  }

  return "unsupported";
}

// Get file path from file ID
function getFilePathFromId(fileId: string): string {
  // The file ID itself is the path: "folder/subfolder/file.ext" or "file.ext"
  return fileId;
}

export function FilePreview({ projectId, filePath, fileName, className }: FilePreviewProps) {
  const { t } = useTranslations("editor");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageZoom, setImageZoom] = useState(100);
  const [imageRotation, setImageRotation] = useState(0);

  const fileType = getFileType(fileName);
  const actualPath = getFilePathFromId(filePath);
  const assetUrl = `/api/projects/${projectId}/assets/${actualPath}`;

  useEffect(() => {
    // Reset state
    setLoading(true);
    setError(null);
    setImageZoom(100);
    setImageRotation(0);
  }, [filePath]);

  const handleLoad = () => {
    setLoading(false);
    setError(null);
  };

  const handleError = () => {
    setLoading(false);
    setError(t("fileLoadFailed"));
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = assetUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleZoomIn = () => setImageZoom((prev) => Math.min(prev + 25, 300));
  const handleZoomOut = () => setImageZoom((prev) => Math.max(prev - 25, 25));
  const handleRotate = () => setImageRotation((prev) => (prev + 90) % 360);

  // Unsupported file type
  if (fileType === "unsupported") {
    return (
      <div className={cn("flex flex-col items-center justify-center h-full bg-muted/30", className)}>
        <FileIcon className="h-16 w-16 text-muted-foreground mb-4" />
        <p className="text-lg font-medium text-muted-foreground mb-2">{fileName}</p>
        <p className="text-sm text-muted-foreground mb-4">{t("unsupportedFileType")}</p>
        <Button variant="outline" onClick={handleDownload}>
          <Download className="h-4 w-4 mr-2" />
          {t("downloadFile")}
        </Button>
      </div>
    );
  }

  // PDF preview
  if (fileType === "pdf") {
    return (
      <div className={cn("flex flex-col h-full bg-muted/30", className)}>
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b bg-background">
          <div className="flex items-center gap-2">
            <FileTextIcon className="h-4 w-4 text-red-500" />
            <span className="text-sm font-medium truncate max-w-[200px]">{fileName}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-2" />
            {t("download")}
          </Button>
        </div>

        {/* PDF content */}
        <div className="flex-1 relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 z-10">
              <AlertCircle className="h-8 w-8 text-destructive mb-2" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <iframe
            src={assetUrl}
            className="w-full h-full border-0"
            onLoad={handleLoad}
            onError={handleError}
            title={fileName}
          />
        </div>
      </div>
    );
  }

  // Image preview
  if (fileType === "image") {
    return (
      <div className={cn("flex flex-col h-full bg-muted/30", className)}>
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b bg-background">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-pink-500" />
            <span className="text-sm font-medium truncate max-w-[200px]">{fileName}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleZoomOut} title={t("zoomOut")}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground min-w-[50px] text-center">{imageZoom}%</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleZoomIn} title={t("zoomIn")}>
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleRotate} title={t("rotate")}>
              <RotateCw className="h-4 w-4" />
            </Button>
            <div className="w-px h-4 bg-border mx-2" />
            <Button variant="ghost" size="sm" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-2" />
              {t("download")}
            </Button>
          </div>
        </div>

        {/* Image content */}
        <div className="flex-1 relative overflow-auto">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 z-10">
              <AlertCircle className="h-8 w-8 text-destructive mb-2" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <div className="min-h-full flex items-center justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={assetUrl}
              alt={fileName}
              className="max-w-full transition-transform duration-200"
              style={{
                transform: `scale(${imageZoom / 100}) rotate(${imageRotation}deg)`,
              }}
              onLoad={handleLoad}
              onError={handleError}
            />
          </div>
        </div>
      </div>
    );
  }

  return null;
}
