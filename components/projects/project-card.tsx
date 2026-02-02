"use client";

import { useState } from "react";
import Link from "next/link";
import {
  FileText,
  MoreHorizontal,
  Pencil,
  Trash2,
  Calendar,
  Clock,
  LogOut,
  Users,
  User
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/lib/i18n";
import type { ProjectListItem } from "@/types";

interface ProjectCardProps {
  project: ProjectListItem;
  onRename: (project: ProjectListItem) => void;
  onDelete: (project: ProjectListItem) => void;
  onLeave?: (project: ProjectListItem) => void;
}

export function ProjectCard({ project, onRename, onDelete, onLeave }: ProjectCardProps) {
  const { t } = useTranslations("project.card");
  const { t: tCommon } = useTranslations("common");
  const [isHovered, setIsHovered] = useState(false);

  // Format date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t("justNow");
    if (diffMins < 60) return t("minutesAgo", { count: diffMins });
    if (diffHours < 24) return t("hoursAgo", { count: diffHours });
    if (diffDays < 7) return t("daysAgo", { count: diffDays });

    return date.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // Get owner display name
  const ownerDisplayName = project.owner?.name || project.owner?.email || "";

  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-xl border bg-card p-5 shadow-sm transition-all duration-200",
        "hover:shadow-md hover:border-primary/30 hover:-translate-y-0.5",
        // Shared projects use a different border color
        !project.isOwner && "border-l-4 border-l-blue-500"
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Project icon and action menu */}
      <div className="flex items-start justify-between mb-4">
        <Link
          href={`/editor/${project.id}`}
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-lg shadow-sm transition-transform hover:scale-105",
            project.isOwner
              ? "bg-gradient-to-br from-emerald-500 to-teal-600"
              : "bg-gradient-to-br from-blue-500 to-indigo-600"
          )}
        >
          <FileText className="h-6 w-6 text-white" />
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8 transition-opacity",
                isHovered ? "opacity-100" : "opacity-0"
              )}
              aria-label="More actions"
              title="More actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* Only the owner can rename */}
            {project.isOwner && (
              <>
                <DropdownMenuItem onClick={() => onRename(project)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  {tCommon("rename")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}

            {/* Owners delete projects; collaborators leave collaboration */}
            {project.isOwner ? (
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => onDelete(project)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {tCommon("delete")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                className="text-amber-600"
                onClick={() => onLeave?.(project)}
              >
                <LogOut className="mr-2 h-4 w-4" />
                {t("leaveCollaboration")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Project name */}
      <Link href={`/editor/${project.id}`} className="block flex-1">
        <h3 className="font-semibold text-foreground mb-1 line-clamp-2 hover:text-primary transition-colors">
          {project.name}
        </h3>
        {project.description && (
          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
            {project.description}
          </p>
        )}
      </Link>

      {/* Show owner info for shared projects */}
      {!project.isOwner && ownerDisplayName && (
        <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 mb-2">
          <User className="h-3.5 w-3.5" />
          <span>{t("sharedBy", { name: ownerDisplayName })}</span>
        </div>
      )}

      {/* Time info and collaborator count */}
      <div className="flex items-center justify-between mt-auto pt-3 border-t border-border/50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span>{formatDate(project.updatedAt)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" />
            <span>{formatDate(project.createdAt)}</span>
          </div>
        </div>

        {/* Collaborator count */}
        {project.collaboratorCount !== undefined && project.collaboratorCount > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            <span>{project.collaboratorCount}</span>
          </div>
        )}
      </div>
    </div>
  );
}
