"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";
import { Plus, FolderOpen, Users, Archive, Trash2, ChevronDown, ChevronRight, Upload, LayoutGrid, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/lib/i18n";

export type ProjectFilter = "all" | "owned" | "shared" | "archived" | "trashed";

export interface TagItem {
  id: string;
  name: string;
  color: string;
  projectCount: number;
}

interface ProjectSidebarProps {
  filter: ProjectFilter;
  onFilterChange: (filter: ProjectFilter) => void;
  tags: TagItem[];
  selectedTag: string | null;
  onTagSelect: (tagId: string | null) => void;
  onNewProject: () => void;
  onUploadProject: () => void;
  onNewTag: () => void;
  projectCounts?: {
    all: number;
    owned: number;
    shared: number;
    archived: number;
    trashed: number;
  };
}

export function ProjectSidebar({
  filter,
  onFilterChange,
  tags,
  selectedTag,
  onTagSelect,
  onNewProject,
  onUploadProject,
  onNewTag,
  projectCounts,
}: ProjectSidebarProps) {
  const { t } = useTranslations("home.sidebar");
  const { data: session } = useSession();
  const userName = session?.user?.name || "User";
  const [tagsExpanded, setTagsExpanded] = useState(true);

  const filterItems = [
    { id: "all" as const, label: t("allProjects"), icon: FolderOpen, count: projectCounts?.all },
    { id: "owned" as const, label: t("yourProjects"), icon: FolderOpen, count: projectCounts?.owned },
    { id: "shared" as const, label: t("sharedWithYou"), icon: Users, count: projectCounts?.shared },
    { id: "archived" as const, label: t("archivedProjects"), icon: Archive, count: projectCounts?.archived },
    { id: "trashed" as const, label: t("trashedProjects"), icon: Trash2, count: projectCounts?.trashed },
  ];

  return (
    <aside className="w-[260px] flex-shrink-0 bg-[var(--glass-bg)] backdrop-blur-xl border-r border-[var(--glass-border)] flex flex-col">
      {/* Logo area - minimal welcome bar */}
      <div className="px-5 py-3 flex items-center">
        <Link href="/" className="flex items-center gap-4 group w-full">
          <div className="relative shrink-0">
            <div className="absolute -inset-3 blur-xl bg-gradient-to-r from-litewrite-cyan/40 via-litewrite-teal/30 to-litewrite-blue/20 opacity-0 group-hover:opacity-100 transition-all duration-500 ease-out rounded-full scale-90 group-hover:scale-110" />
            <Image src="/logo.svg" alt="Litewrite" width={64} height={64} className="relative transition-transform duration-300 group-hover:scale-105" />
          </div>
          <div className="flex flex-col justify-center min-w-0">
            <span className="text-xs uppercase tracking-wider text-muted-foreground/70 font-medium leading-none mb-1 group-hover:text-primary transition-colors">
              Welcome!
            </span>
            <span className="text-lg font-semibold text-foreground truncate leading-tight">
              {userName}
            </span>
          </div>
        </Link>
      </div>

      {/* New project button area */}
      <div className="px-4 pt-1 pb-3 space-y-2.5">
        <Button
          onClick={onNewProject}
          className="w-full relative overflow-hidden group bg-gradient-to-r from-litewrite-blue-dark via-litewrite-cyan-dark to-litewrite-cyan text-white shadow-elevation-2 hover:shadow-elevation-3 hover:brightness-105 active:shadow-elevation-1"
        >
          <Plus className="mr-2 h-4 w-4" />
          {t("newProject")}
          {/* Shimmer effect */}
          <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button
            onClick={onUploadProject}
            variant="outline"
            size="sm"
            className="text-xs bg-white/60 dark:bg-slate-900/60 border-primary/20 hover:border-primary/40 hover:bg-white/80 dark:hover:bg-slate-900/80 text-foreground/80 hover:text-foreground"
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {t("importProject")}
          </Button>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="text-xs bg-white/60 dark:bg-slate-900/60 border-primary/20 hover:border-primary/40 hover:bg-white/80 dark:hover:bg-slate-900/80 text-foreground/80 hover:text-foreground"
          >
            <Link href="/templates">
              <LayoutGrid className="mr-1.5 h-3.5 w-3.5" />
              {t("templateLibrary")}
            </Link>
          </Button>
        </div>
      </div>

      {/* Filter */}
      <nav className="flex-1 px-3 overflow-y-auto">
        <ul className="space-y-0.5">
          {filterItems.map((item) => (
            <li key={item.id}>
              <button
                onClick={() => {
                  onFilterChange(item.id);
                  onTagSelect(null);
                }}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-all duration-200",
                  filter === item.id && !selectedTag
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-foreground/70 hover:bg-white/50 dark:hover:bg-slate-800/50 hover:text-foreground"
                )}
              >
                <span className="flex items-center gap-2.5">
                  <item.icon className={cn(
                    "h-4 w-4",
                    filter === item.id && !selectedTag ? "text-primary" : "text-foreground/50"
                  )} />
                  {item.label}
                </span>
                {item.count !== undefined && (
                  <span className={cn(
                    "text-xs tabular-nums",
                    filter === item.id && !selectedTag
                      ? "text-primary/80"
                      : "text-foreground/40"
                  )}>
                    {item.count}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>

        {/* Tag groups */}
        <div className="mt-4 pt-4 border-t border-border/30">
          <button
            onClick={() => setTagsExpanded(!tagsExpanded)}
            className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-foreground/60 hover:text-foreground transition-colors rounded-lg hover:bg-white/50 dark:hover:bg-slate-800/50"
          >
            <span className="flex items-center gap-2.5">
              <Sparkles className="h-4 w-4 text-litewrite-warm" />
              {t("organizeTags")}
            </span>
            {tagsExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>

          {tagsExpanded && (
            <ul className="mt-1 space-y-0.5 animate-fade-in">
              {tags.map((tag) => (
                <li key={tag.id}>
                  <button
                    onClick={() => {
                      onTagSelect(selectedTag === tag.id ? null : tag.id);
                      if (filter === "archived" || filter === "trashed") {
                        onFilterChange("all");
                      }
                    }}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-all duration-200",
                      selectedTag === tag.id
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-foreground/70 hover:bg-white/50 dark:hover:bg-slate-800/50 hover:text-foreground"
                    )}
                  >
                    <span className="flex items-center gap-2.5">
                      <span
                        className="h-2.5 w-2.5 rounded-full shadow-sm"
                        style={{ backgroundColor: tag.color }}
                      />
                      {tag.name}
                    </span>
                    <span className={cn(
                      "text-xs tabular-nums",
                      selectedTag === tag.id
                        ? "text-primary/80"
                        : "text-foreground/40"
                    )}>
                      {tag.projectCount}
                    </span>
                  </button>
                </li>
              ))}

              {/* New tag button */}
              <li>
                <button
                  onClick={onNewTag}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground/50 hover:text-primary rounded-lg transition-all duration-200 hover:bg-white/50 dark:hover:bg-slate-800/50"
                >
                  <Plus className="h-4 w-4" />
                  {t("newTag")}
                </button>
              </li>
            </ul>
          )}
        </div>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-[var(--glass-border)]">
        <div className="text-xs text-muted-foreground text-center">
          Litewrite v1.0.7
        </div>
      </div>
    </aside>
  );
}
