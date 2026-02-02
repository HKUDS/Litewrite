"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
}

export function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
  className,
  headerClassName,
  contentClassName,
  icon,
  actions,
  onOpenChange,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  const handleToggle = () => {
    const newState = !isOpen;
    setIsOpen(newState);
    onOpenChange?.(newState);
  };

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between px-3 py-2 cursor-pointer select-none",
          "bg-muted/50 border-b border-border",
          "hover:bg-muted/70 transition-colors duration-150",
          headerClassName
        )}
        onClick={handleToggle}
      >
        <div className="flex items-center gap-2 min-w-0">
          {/* Expand/collapse chevron */}
          <span className="flex-shrink-0 text-muted-foreground">
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </span>

          {/* Optional icon */}
          {icon && (
            <span className="flex-shrink-0 text-muted-foreground">
              {icon}
            </span>
          )}

          {/* Title */}
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground truncate">
            {title}
          </span>
        </div>

        {/* Right-side actions */}
        {actions && (
          <div
            className="flex items-center gap-1 flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {actions}
          </div>
        )}
      </div>

      {/* Content */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-200 ease-out",
          isOpen ? "opacity-100" : "opacity-0 h-0",
          contentClassName
        )}
        style={{
          maxHeight: isOpen ? "9999px" : "0",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// Simplified version for sidebar grouping
interface CollapsibleGroupProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function CollapsibleGroup({
  title,
  defaultOpen = true,
  children,
  className,
}: CollapsibleGroupProps) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  return (
    <div className={cn("", className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>{title}</span>
        {isOpen ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
      </button>

      {isOpen && (
        <div className="animate-fade-in">
          {children}
        </div>
      )}
    </div>
  );
}
