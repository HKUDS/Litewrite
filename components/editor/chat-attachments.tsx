"use client";

import React, { useCallback, useState, useRef } from "react";
import {
  X,
  File,
  FileText,
  Code,
  Paperclip,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/lib/i18n";
import type { Attachment, LineRange } from "@/types/ask";

interface ChatAttachmentsProps {
  attachments: Attachment[];
  onRemove: (id: string) => void;
  onClear: () => void;
  className?: string;
  maxHeight?: number;
}

/**
 * Chat attachment list component - Cursor style.
 *
 * Displays added files and selection references with dark tag styling.
 */
export function ChatAttachments({
  attachments,
  onRemove,
  onClear,
  className,
  maxHeight = 150,
}: ChatAttachmentsProps) {
  const { t } = useTranslations("chat");
  if (attachments.length === 0) return null;

  return (
    <div className={cn("space-y-2", className)}>
      {/* Header */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Paperclip className="h-3 w-3" />
          <span>{t("attachments.references", { count: attachments.length })}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-xs hover:text-destructive"
          onClick={onClear}
        >
          {t("attachments.clear")}
        </Button>
      </div>

      {/* Attachment chips - Cursor style, wrap allowed */}
      <div className="flex flex-wrap gap-1.5" style={{ maxHeight, overflowY: 'auto' }}>
        {attachments.map((attachment) => (
          <AttachmentChip
            key={attachment.id}
            attachment={attachment}
            onRemove={() => onRemove(attachment.id)}
          />
        ))}
      </div>
    </div>
  );
}

interface AttachmentChipProps {
  attachment: Attachment;
  onRemove: () => void;
}

/**
 * Cursor-style attachment chip - dark background.
 */
function AttachmentChip({ attachment, onRemove }: AttachmentChipProps) {
  const getIcon = () => {
    if (attachment.type === "selection") {
      return <Code className="h-3 w-3" />;
    }
    const ext = attachment.fileName.split(".").pop()?.toLowerCase();
    if (ext === "tex" || ext === "latex") {
      return <FileText className="h-3 w-3" />;
    }
    if (ext === "md") {
      return <FileText className="h-3 w-3" />;
    }
    return <File className="h-3 w-3" />;
  };

  const formatLineRange = (range?: LineRange) => {
    if (!range) return "";
    return ` (${range.start}-${range.end})`;
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="group inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-800 dark:bg-zinc-800 text-zinc-100 text-xs cursor-default hover:bg-zinc-700 transition-colors">
          {/* Icon */}
          <span className="text-zinc-400">
            {getIcon()}
          </span>

          {/* File name + line range */}
          <span className="max-w-[180px] truncate">
            {attachment.fileName}
            {attachment.lineRange && (
              <span className="text-zinc-400">
                {formatLineRange(attachment.lineRange)}
              </span>
            )}
          </span>

          {/* Remove button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            aria-label="Remove attachment"
            title="Remove attachment"
            className="ml-0.5 text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </TooltipTrigger>
      {attachment.preview && (
        <TooltipContent side="top" className="max-w-sm">
          <pre className="text-xs whitespace-pre-wrap font-mono max-h-[200px] overflow-auto">
            {attachment.preview.slice(0, 300)}
            {attachment.preview.length > 300 && "..."}
          </pre>
        </TooltipContent>
      )}
    </Tooltip>
  );
}

// Keep legacy AttachmentItem for compatibility
interface AttachmentItemProps {
  attachment: Attachment;
  onRemove: () => void;
}

function AttachmentItem({ attachment, onRemove }: AttachmentItemProps) {
  return <AttachmentChip attachment={attachment} onRemove={onRemove} />;
}

interface DropZoneProps {
  onDrop: (files: File[]) => void;
  children: React.ReactNode;
  className?: string;
  acceptAll?: boolean;  // Whether to accept all file types
  accept?: string[];
}

// Excluded binary file types
const BINARY_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".tar", ".gz", ".rar", ".7z", ".exe", ".dll", ".so", ".dylib", ".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv"];

/**
 * File drag-and-drop area.
 */
export function DropZone({
  onDrop,
  children,
  className,
  acceptAll = true,  // Default: accept all text files
  accept = [".tex", ".bib", ".cls", ".sty", ".txt", ".md", ".json", ".py", ".js", ".ts", ".tsx", ".css", ".html", ".xml", ".yml", ".yaml", ".toml", ".sh", ".bash", ".gitignore", ".env"],
}: DropZoneProps) {
  const { t } = useTranslations("chat");
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounter.current = 0;

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const files = Array.from(e.dataTransfer.files).filter((file) => {
          const fileName = file.name.toLowerCase();
          const lastDotIndex = fileName.lastIndexOf(".");
          const ext = lastDotIndex > 0 ? fileName.substring(lastDotIndex) : "";

          // If accepting all files, only exclude binary files
          if (acceptAll) {
            return !BINARY_EXTENSIONS.includes(ext);
          }

          // Otherwise, check allowlist
          if (ext) {
            return accept.includes(ext);
          }
          // Files without extension (e.g. Makefile, .gitignore)
          return accept.includes("." + fileName);
        });
        if (files.length > 0) {
          onDrop(files);
        }
        e.dataTransfer.clearData();
      }
    },
    [onDrop, accept, acceptAll]
  );

  return (
    <div
      className={cn(
        "relative transition-colors",
        isDragging && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        className
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}

      {/* Drag-and-drop indicator */}
      {isDragging && (
        <div className="absolute inset-0 bg-primary/10 backdrop-blur-sm rounded-lg flex items-center justify-center z-10">
          <div className="flex flex-col items-center gap-2 text-primary">
            <Paperclip className="h-8 w-8" />
            <span className="text-sm font-medium">{t("attachments.dropHere")}</span>
          </div>
        </div>
      )}
    </div>
  );
}

interface FilePickerButtonProps {
  onSelect: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  className?: string;
}

/**
 * File picker button.
 */
export function FilePickerButton({
  onSelect,
  accept = ".tex,.bib,.cls,.sty,.txt,.md,.json,.py,.js,.ts,.tsx,.css,.html,.xml,.yml,.yaml",
  multiple = true,
  className,
}: FilePickerButtonProps) {
  const { t } = useTranslations("chat");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onSelect(Array.from(e.target.files));
      e.target.value = ""; // Reset input
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={handleChange}
        aria-label={t("attachments.upload")}
        title={t("attachments.upload")}
        className="hidden"
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-7 w-7", className)}
            onClick={handleClick}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{t("attachments.upload")}</TooltipContent>
      </Tooltip>
    </>
  );
}

export type { Attachment, LineRange };
