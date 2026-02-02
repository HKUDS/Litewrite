"use client";

import Link from "next/link";
import {
  Copy,
  Download,
  Archive,
  Trash2,
  RotateCcw,
  Users,
  Tag,
  Pencil,
  LogOut
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/lib/i18n";

export interface ProjectTag {
  id: string;
  name: string;
  color: string;
}

export interface ProjectItem {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  visibility: string;
  isOwner: boolean;
  owner: {
    id?: string;
    name?: string | null;
    email: string;
  };
  collaboratorCount: number;
  tags: ProjectTag[];
  updatedAt: string;
  createdAt: string;
  trashedAt?: string | null;
}

interface ProjectTableProps {
  projects: ProjectItem[];
  selectedProjects: string[];
  onSelectionChange: (selected: string[]) => void;
  onRename: (projectId: string, currentName: string) => void;
  onArchive: (projectId: string) => void;
  onTrash: (projectId: string) => void;
  onRestore: (projectId: string) => void;
  onDelete: (projectId: string) => void;
  onLeaveProject: (projectId: string) => void;
  onCopy: (projectId: string) => void;
  onManageTags: (projectId: string) => void;
  currentFilter: string;
  sort: string;
  order: string;
  onSortChange: (sort: string, order: string) => void;
}

export function ProjectTable({
  projects,
  selectedProjects,
  onSelectionChange,
  onRename,
  onArchive,
  onTrash,
  onRestore,
  onDelete,
  onLeaveProject,
  onCopy,
  onManageTags,
  currentFilter,
  sort,
  order,
  onSortChange,
}: ProjectTableProps) {
  const { t } = useTranslations("home.table");
  const { t: tCommon } = useTranslations("common");

  // Format date (relative time)
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
    if (diffDays < 30) return t("weeksAgo", { count: Math.floor(diffDays / 7) });
    if (diffDays < 365) return t("monthsAgo", { count: Math.floor(diffDays / 30) });
    return t("yearsAgo", { count: Math.floor(diffDays / 365) });
  };

  // Select all / deselect all
  const handleSelectAll = () => {
    if (selectedProjects.length === projects.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(projects.map(p => p.id));
    }
  };

  // Toggle selection for a single project
  const handleSelectProject = (projectId: string) => {
    if (selectedProjects.includes(projectId)) {
      onSelectionChange(selectedProjects.filter(id => id !== projectId));
    } else {
      onSelectionChange([...selectedProjects, projectId]);
    }
  };

  // Handle sort click
  const handleSortClick = (field: string) => {
    if (sort === field) {
      onSortChange(field, order === "asc" ? "desc" : "asc");
    } else {
      onSortChange(field, "desc");
    }
  };

  // Get sort indicator
  const getSortIndicator = (field: string) => {
    if (sort !== field) return null;
    return order === "asc" ? "↑" : "↓";
  };

  // Get owner display name
  const getOwnerDisplay = (project: ProjectItem) => {
    if (project.isOwner) return t("you");
    return project.owner.name || project.owner.email;
  };

  return (
    <div className="border rounded-lg bg-white dark:bg-slate-900">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10">
              <Checkbox
                checked={projects.length > 0 && selectedProjects.length === projects.length}
                onCheckedChange={handleSelectAll}
                aria-label="Select all"
              />
            </TableHead>
            <TableHead
              className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
              onClick={() => handleSortClick("name")}
            >
              {t("title")} {getSortIndicator("name")}
            </TableHead>
            <TableHead>{t("owner")}</TableHead>
            <TableHead
              className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
              onClick={() => handleSortClick("updatedAt")}
            >
              {t("lastModified")} {getSortIndicator("updatedAt")}
            </TableHead>
            <TableHead className="text-right">{t("actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                {t("noProjects")}
              </TableCell>
            </TableRow>
          ) : (
            projects.map((project) => (
              <TableRow
                key={project.id}
                className={cn(
                  "group transition-colors duration-150 hover:bg-muted/50",
                  selectedProjects.includes(project.id) && "bg-primary/5 shadow-[inset_2px_0_0_0_hsl(var(--primary))]"
                )}
              >
                <TableCell>
                  <Checkbox
                    checked={selectedProjects.includes(project.id)}
                    onCheckedChange={() => handleSelectProject(project.id)}
                    aria-label={`Select ${project.name}`}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <Link
                      href={`/editor/${project.id}`}
                      className="font-medium text-gray-900 dark:text-gray-100 hover:text-primary dark:hover:text-primary hover:underline"
                    >
                      {project.name}
                    </Link>
                    {/* Tags */}
                    {project.tags && project.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {project.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag.id}
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-xs"
                            style={{
                              backgroundColor: `${tag.color}20`,
                              color: tag.color,
                            }}
                          >
                            {tag.name}
                          </span>
                        ))}
                        {project.tags.length > 3 && (
                          <span className="text-xs text-gray-400">
                            +{project.tags.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {getOwnerDisplay(project)}
                    </span>
                    {project.collaboratorCount > 0 && (
                      <Tooltip>
                        <TooltipTrigger>
                          <span className="inline-flex items-center text-xs text-gray-400">
                            <Users className="h-3 w-3 mr-0.5" />
                            {project.collaboratorCount}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("collaborators", { count: project.collaboratorCount })}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {formatDate(project.updatedAt)}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {currentFilter !== "trashed" && (
                      <>
                        {/* Copy */}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => onCopy(project.id)}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t("copy")}</TooltipContent>
                        </Tooltip>

                        {/* Download zip */}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => {
                                window.location.href = `/api/projects/${project.id}/download`;
                              }}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t("downloadZip")}</TooltipContent>
                        </Tooltip>

                        {project.isOwner && (
                          <>
                            {/* Rename */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => onRename(project.id, project.name)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{t("rename")}</TooltipContent>
                            </Tooltip>

                            {/* Manage tags */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => onManageTags(project.id)}
                                >
                                  <Tag className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{t("manageTags")}</TooltipContent>
                            </Tooltip>

                            {/* Archive */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => onArchive(project.id)}
                                >
                                  <Archive className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {project.status === "archived" ? t("unarchive") : t("archive")}
                              </TooltipContent>
                            </Tooltip>

                            {/* Trash */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                  onClick={() => onTrash(project.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{t("trash")}</TooltipContent>
                            </Tooltip>
                          </>
                        )}

                        {/* Non-owner - leave shared project */}
                        {!project.isOwner && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => onLeaveProject(project.id)}
                              >
                                <LogOut className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t("leaveProject")}</TooltipContent>
                          </Tooltip>
                        )}
                      </>
                    )}

                    {/* Actions in trash */}
                    {currentFilter === "trashed" && project.isOwner && (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => onRestore(project.id)}
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t("restore")}</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => onDelete(project.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t("deletePermanently")}</TooltipContent>
                        </Tooltip>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
