"use client";

import React, { useState } from "react";
import { File, ChevronDown, ChevronRight, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Edit block with line-based positioning and original text
 */
interface EditBlock {
  startLine: number;
  endLine: number;
  original?: string;  // Original text being replaced (for session history display)
  originalSnippet?: string;  // Truncated original (100 chars) from session storage
  updated: string;
}

export interface FileEditProps {
  editId: string;
  filePath: string;
  blocks: EditBlock[];
  description?: string;
  onApply?: (editId: string) => Promise<void>;
  onReject?: (editId: string) => void;
  status?: "pending" | "applying" | "applied" | "rejected";
  /** Hide action buttons (for chat panel display) */
  hideActions?: boolean;
}

/**
 * Diff Display Component for Chat Panel (Line-Based)
 *
 * Shows file edits with line range info and new content preview.
 * Uses theme colors, no action buttons by default in chat.
 */
export function FileEditDiff({
  filePath,
  blocks,
  description,
  status = "pending",
  hideActions = true, // Default to hiding actions in chat panel
}: FileEditProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  // Render diff block showing original → updated
  const renderDiffBlock = (block: EditBlock, index: number) => {
    // 🔑 FIX: support both `original` and `originalSnippet` field names
    // - original: from realtime streaming (EditBlock)
    // - originalSnippet: from session history storage (SessionEditBlock)
    const originalContent = block.original || block.originalSnippet;
    const originalLines = originalContent?.split('\n') || [];
    const updatedLines = block.updated.split('\n');
    const hasOriginal = originalContent && originalContent.length > 0;

    // Line range info for header (shows original line numbers; actual position may shift after edits)
    const lineRange = block.startLine === block.endLine
      ? `Original Line ${block.startLine}`
      : `Original Lines ${block.startLine}-${block.endLine}`;

    return (
      <div key={index} className="border-b border-border/50 last:border-b-0">
        {/* Line range header */}
        <div className="flex items-center gap-2 px-2 py-1 bg-muted/30 text-xs text-muted-foreground">
          <span className="text-muted-foreground">{lineRange}</span>
          {hasOriginal && (
            <>
              <span className="text-destructive/70">-{originalLines.length}</span>
              <span className="text-muted-foreground">/</span>
            </>
          )}
          <span className="text-primary/70">+{updatedLines.length}</span>
        </div>

        {/* Original (deleted) lines - red background */}
        {hasOriginal && originalLines.map((line, i) => (
          <div
            key={`original-${i}`}
            className="flex font-mono text-xs"
          >
            <div className="w-6 flex-shrink-0 text-right pr-1 select-none text-destructive/60 bg-destructive/10">
              -
            </div>
            <div className="flex-1 px-2 bg-destructive/5 text-destructive/80 whitespace-pre overflow-x-auto">
              {line || '\u00A0'}
            </div>
          </div>
        ))}

        {/* Updated (new) lines - green background */}
        {updatedLines.map((line, i) => (
          <div
            key={`updated-${i}`}
            className="flex font-mono text-xs"
          >
            <div className="w-6 flex-shrink-0 text-right pr-1 select-none text-primary/60 bg-primary/10">
              +
            </div>
            <div className="flex-1 px-2 bg-primary/5 text-primary whitespace-pre overflow-x-auto">
              {line || '\u00A0'}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Status badge
  const renderStatusBadge = () => {
    if (status === "applied") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-primary/20 text-primary">
          <Check className="w-3 h-3" />
          Applied
        </span>
      );
    }
    if (status === "rejected") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-destructive/20 text-destructive">
          <X className="w-3 h-3" />
          Rejected
        </span>
      );
    }
    return null;
  };

  return (
    <div className={cn(
      "rounded-lg border overflow-hidden my-2",
      status === "applied" ? "border-primary/30 bg-primary/5" :
      status === "rejected" ? "border-destructive/30 bg-destructive/5 opacity-60" :
      "border-border bg-muted/30"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 bg-muted/50 border-b border-border/50">
        <button
          className="flex items-center gap-1.5 text-xs text-foreground/80 hover:text-foreground"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
          <File className="w-3 h-3 text-primary" />
          <span className="font-medium">{filePath}</span>
        </button>

        {!hideActions && renderStatusBadge()}
      </div>

      {/* Description if provided */}
      {description && isExpanded && (
        <div className="px-2 py-1 text-xs text-muted-foreground bg-muted/20 border-b border-border/30">
          {description}
        </div>
      )}

      {/* Diff content */}
      {isExpanded && (
        <div className="max-h-[200px] overflow-y-auto">
          {blocks.map((block, index) => renderDiffBlock(block, index))}
        </div>
      )}
    </div>
  );
}

export default FileEditDiff;
