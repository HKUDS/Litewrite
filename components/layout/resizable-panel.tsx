"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface ResizablePanelProps {
  children: React.ReactNode;
  isOpen: boolean;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  side: "left" | "right";
  onWidthChange?: (width: number) => void;
  onToggle?: () => void;
  onResizingChange?: (isResizing: boolean) => void; // Dragging state change callback
  hideWhenClosed?: boolean; // Completely hide when closed (for AI Chat, etc.)
  showContentOverlay?: boolean; // Show a content overlay (avoid frequent renders while dragging)
  overlayText?: string; // Text displayed on the overlay
}

const HANDLE_WIDTH = 7; // Handle width
const COLLAPSE_THRESHOLD = 60; // Auto-collapse threshold while dragging
const COLLAPSED_CONTENT_WIDTH = 42; // Toolbar width to keep when collapsed

/**
 * Convert a pixel width to a percentage relative to the parent container.
 * Storing as a percentage keeps the splitter position stable during page zoom.
 */
function pxToPercent(px: number, containerWidth: number): number {
  if (containerWidth <= 0) return 0;
  return (px / containerWidth) * 100;
}

function percentToPx(percent: number, containerWidth: number): number {
  return (percent / 100) * containerWidth;
}

export function ResizablePanel({
  children,
  isOpen,
  defaultWidth,
  minWidth,
  maxWidth,
  side,
  onWidthChange,
  onToggle,
  onResizingChange,
  hideWhenClosed = false,
  showContentOverlay = false,
  overlayText = "Resizing panel...",
}: ResizablePanelProps) {
  // Store width as a percentage (relative to parent container)
  const [widthPercent, setWidthPercent] = useState<number | null>(null);
  const [isResizing, setIsResizingInternal] = useState(false);
  const [isHoveringHandle, setIsHoveringHandle] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLElement | null>(null);

  // Wrap setIsResizing to trigger callback
  const setIsResizing = useCallback((value: boolean) => {
    setIsResizingInternal(value);
    onResizingChange?.(value);
  }, [onResizingChange]);

  // Get parent container width
  const getContainerWidth = useCallback(() => {
    if (containerRef.current) {
      return containerRef.current.offsetWidth;
    }
    if (panelRef.current?.parentElement) {
      containerRef.current = panelRef.current.parentElement;
      return containerRef.current.offsetWidth;
    }
    return window.innerWidth;
  }, []);

  // Init: convert default pixel width to percentage
  useEffect(() => {
    const containerWidth = getContainerWidth();
    if (containerWidth > 0) {
      setWidthPercent(pxToPercent(defaultWidth, containerWidth));
    }
  }, [defaultWidth, getContainerWidth]);

  // Compute current pixel width
  const getCurrentWidth = useCallback(() => {
    if (widthPercent === null) return defaultWidth;
    const containerWidth = getContainerWidth();
    return percentToPx(widthPercent, containerWidth);
  }, [widthPercent, defaultWidth, getContainerWidth]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
  }, []);

  const handleToggleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onToggle?.();
  }, [onToggle]);

  // While dragging: disable text selection and set global cursor
  useEffect(() => {
    if (isResizing) {
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";
    } else {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
    }

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
    };
  }, [isResizing]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !panelRef.current) return;

      const rect = panelRef.current.getBoundingClientRect();
      const containerWidth = getContainerWidth();
      let newWidth: number;

      if (side === "left") {
        newWidth = e.clientX - rect.left;
      } else {
        newWidth = rect.right - e.clientX;
      }

      // If dragged below threshold, trigger collapse
      if (newWidth < COLLAPSE_THRESHOLD && onToggle) {
        setIsResizing(false);
        onToggle();
        return;
      }

      newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

      // Store as percentage
      setWidthPercent(pxToPercent(newWidth, containerWidth));
      onWidthChange?.(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isResizing, side, minWidth, maxWidth, onToggle, getContainerWidth]);

  // Get arrow icon
  const getArrowIcon = () => {
    if (side === "left") {
      // Left panel: open shows left arrow (collapse), collapsed shows right arrow (expand)
      return isOpen ? (
        <ChevronLeft className="h-3 w-3" />
      ) : (
        <ChevronRight className="h-3 w-3" />
      );
    } else {
      // Right panel: open shows right arrow (collapse), collapsed shows left arrow (expand)
      return isOpen ? (
        <ChevronRight className="h-3 w-3" />
      ) : (
        <ChevronLeft className="h-3 w-3" />
      );
    }
  };

  // Compute actual width (excluding handle)
  const getContentWidth = useCallback(() => {
    if (!isOpen) {
      // When collapsed, keep toolbar width (left only; right panel is fully hidden)
      return side === "left" ? COLLAPSED_CONTENT_WIDTH : 0;
    }
    return getCurrentWidth();
  }, [isOpen, side, getCurrentWidth]);

  // Recompute width on window resize
  const [, forceUpdate] = useState({});
  useEffect(() => {
    const handleResize = () => {
      forceUpdate({});
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // If hideWhenClosed is true and panel is closed, do not render at all
  if (hideWhenClosed && !isOpen) {
    return null;
  }

  return (
    <div
      ref={panelRef}
      className={cn(
        "relative flex-shrink-0 h-full flex",
        side === "left" ? "flex-row" : "flex-row-reverse"
      )}
      style={{ width: getContentWidth() + HANDLE_WIDTH }}
    >
      {/* Content area */}
      <div
        className={cn(
          "relative h-full bg-sidebar overflow-hidden",
          !isResizing && "transition-[width] duration-200 ease-out"
        )}
        style={{ width: getContentWidth() }}
      >
        {children}
        {/* Content overlay while dragging */}
        {showContentOverlay && (
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-10 flex items-center justify-center">
            <div className="text-muted-foreground text-sm">{overlayText}</div>
          </div>
        )}
      </div>

      {/* Resize handle - always visible */}
      <div
        className={cn(
          "relative h-full flex-shrink-0 cursor-col-resize",
          "flex items-center justify-center",
          "bg-border/30 hover:bg-primary/20 active:bg-primary/30",
          "border-x border-border/40",
          isResizing && "bg-primary/30"
        )}
        style={{ width: HANDLE_WIDTH }}
        onMouseDown={handleMouseDown}
        onMouseEnter={() => setIsHoveringHandle(true)}
        onMouseLeave={() => setIsHoveringHandle(false)}
      >
        {/* Middle arrow button */}
        <div
          className={cn(
            "absolute flex items-center justify-center",
            "w-4 h-6 rounded-sm cursor-pointer",
            "bg-background border border-border/50",
            "text-muted-foreground hover:text-foreground",
            "hover:bg-accent hover:border-border",
            "transition-all duration-150",
            "shadow-sm",
            // Shown on hover or when collapsed
            "opacity-100"
          )}
          onClick={handleToggleClick}
          onMouseDown={(e) => e.stopPropagation()} // Prevent triggering drag
        >
          {getArrowIcon()}
        </div>
      </div>

      {/* Overlay while resizing */}
      {isResizing && (
        <div className="fixed inset-0 z-50 cursor-col-resize" />
      )}
    </div>
  );
}
