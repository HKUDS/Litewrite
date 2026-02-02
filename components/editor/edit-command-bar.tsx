"use client";

import React, { useEffect, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Loader2,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEditStore } from "@/stores/edit-store";

/**
 * Litewrite Edit Command Bar
 *
 * Compact floating bar in the editor area (top-right corner like Cursor)
 * when there are pending edits.
 */
export function EditCommandBar() {
  const {
    pendingEdits,
    currentEditIndex,
    isCommandBarVisible,
    nextEdit,
    prevEdit,
    applyEdit,
    rejectEdit,
    applyAll,
    rejectAll,
    getCurrentEdit,
    getPendingCount,
    navigateToCurrentEdit,
  } = useEditStore();

  const currentEdit = getCurrentEdit();
  const pendingCount = getPendingCount();

  // Get current edit position among pending edits
  const pendingEditsOnly = pendingEdits.filter((e) => e.status === "pending");
  const currentPendingIndex = pendingEditsOnly.findIndex((e) => e.id === currentEdit?.id);

  // Get current file name for display
  const currentFileName = currentEdit?.filePath?.split("/").pop() || "";

  // Navigate and switch file when clicking navigation buttons
  const handleNext = () => {
    nextEdit();
    // After state update, navigate to the new file
    setTimeout(() => navigateToCurrentEdit(), 0);
  };

  const handlePrev = () => {
    prevEdit();
    // After state update, navigate to the new file
    setTimeout(() => navigateToCurrentEdit(), 0);
  };

  // Track previous visibility to detect when command bar first appears
  const prevVisibleRef = useRef(false);

  // Auto-navigate to current edit when command bar becomes visible for the first time
  useEffect(() => {
    if (isCommandBarVisible && pendingCount > 0 && !prevVisibleRef.current) {
      // Small delay to ensure navigateToFileCallback is set up
      const timer = setTimeout(() => {
        navigateToCurrentEdit();
      }, 50);
      prevVisibleRef.current = true;
      return () => clearTimeout(timer);
    }
    if (!isCommandBarVisible) {
      prevVisibleRef.current = false;
    }
  }, [isCommandBarVisible, pendingCount, navigateToCurrentEdit]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isCommandBarVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+Y = Keep All
      if (e.ctrlKey && e.shiftKey && e.key === "Y") {
        e.preventDefault();
        applyAll();
      }
      // Ctrl+N = Undo current / Next
      if (e.ctrlKey && e.key === "n") {
        e.preventDefault();
        if (currentEdit) {
          rejectEdit(currentEdit.id);
        }
      }
      // Ctrl+Y = Keep current
      if (e.ctrlKey && e.key === "y" && !e.shiftKey) {
        e.preventDefault();
        if (currentEdit) {
          applyEdit(currentEdit.id);
        }
      }
      // Arrow keys for navigation
      if (e.key === "ArrowUp" && e.altKey) {
        e.preventDefault();
        handlePrev();
      }
      if (e.key === "ArrowDown" && e.altKey) {
        e.preventDefault();
        handleNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isCommandBarVisible, currentEdit, applyAll, rejectEdit, applyEdit, handlePrev, handleNext]);

  // Don't render if no pending edits or not visible
  if (!isCommandBarVisible || pendingCount === 0) {
    return null;
  }

  const isApplying = currentEdit?.status === "applying";

  return (
    <div className="absolute top-2 right-2 z-50">
      {/* Compact floating bar inside editor */}
      <div className="flex items-center gap-1 bg-card/95 backdrop-blur-md border border-border rounded-lg shadow-lg px-2 py-1.5">
        {/* Current file indicator */}
        {currentFileName && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <FileText className="w-3 h-3" />
            <span className="max-w-[80px] truncate">{currentFileName}</span>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={handlePrev}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title="Previous edit (Alt+↑)"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-medium text-foreground min-w-[50px] text-center">
            {currentPendingIndex + 1} of {pendingCount}
          </span>
          <button
            onClick={handleNext}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title="Next edit (Alt+↓)"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="w-px h-4 bg-border mx-1" />

        {/* Undo All */}
        <button
          onClick={rejectAll}
          disabled={isApplying}
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all",
            "text-muted-foreground hover:text-foreground hover:bg-muted",
            isApplying && "opacity-50 cursor-not-allowed"
          )}
          title="Undo All (Ctrl+Shift+Z)"
        >
          <X className="w-3 h-3" />
          Undo All
        </button>

        {/* Keep All */}
        <button
          onClick={applyAll}
          disabled={isApplying}
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all",
            "bg-primary text-primary-foreground hover:bg-primary/90",
            isApplying && "opacity-50 cursor-not-allowed"
          )}
          title="Keep All (Ctrl+Shift+Y)"
        >
          {isApplying ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Check className="w-3 h-3" />
          )}
          Keep All
        </button>
      </div>
    </div>
  );
}

export default EditCommandBar;
