"use client";

import { useState, useEffect, useCallback } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AnimatedLogo } from "@/components/ui/animated-logo";
import { ProjectSidebar, type ProjectFilter, type TagItem } from "@/components/home/project-sidebar";
import { ProjectTable, type ProjectItem } from "@/components/home/project-table";
import { ProjectToolbar } from "@/components/home/project-toolbar";
import { ProjectPagination } from "@/components/home/project-pagination";
import { CreateTagDialog, ManageTagsDialog } from "@/components/home/tag-manager";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { UploadProjectDialog } from "@/components/projects/upload-project-dialog";
import { RenameDialog } from "@/components/home/rename-dialog";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { UserMenu } from "@/components/user-menu";
import { useTranslations } from "@/lib/i18n";
import { getApiErrorMessage } from "@/lib/api-error-handler";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function HomePage() {
  const { t } = useTranslations();

  // Project data state
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState("");

  // Filter & sort state
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("updatedAt");
  const [order, setOrder] = useState("desc");
  const [page, setPage] = useState(1);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // Tag data
  const [tags, setTags] = useState<TagItem[]>([]);

  // Selected projects
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);

  // Dialog state
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [uploadProjectOpen, setUploadProjectOpen] = useState(false);
  const [createTagOpen, setCreateTagOpen] = useState(false);
  const [manageTagsOpen, setManageTagsOpen] = useState(false);
  const [manageTagsProjectId, setManageTagsProjectId] = useState<string | null>(null);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameProjectId, setRenameProjectId] = useState("");
  const [renameProjectName, setRenameProjectName] = useState("");

  // Confirmation dialog
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    action: () => Promise<void>;
    confirmText?: string;
    confirmStyle?: "default" | "destructive";
  }>({ open: false, title: "", description: "", action: async () => {}, confirmText: undefined, confirmStyle: "destructive" });

  // Fetch project list
  const fetchProjects = useCallback(async (resetPage = true) => {
    try {
      if (resetPage) {
        setIsLoading(true);
        setPage(1);
      } else {
        setIsLoadingMore(true);
      }
      setError("");

      const params = new URLSearchParams({
        filter,
        search,
        sort,
        order,
        page: resetPage ? "1" : String(page + 1),
        limit: "20",
      });
      if (selectedTag) {
        params.set("tag", selectedTag);
      }

      const response = await fetch(`/api/projects?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, t, "errors.loadProjectFailed"));
      }

      if (resetPage) {
        setProjects(data.projects || []);
      } else {
        setProjects(prev => [...prev, ...(data.projects || [])]);
        setPage(p => p + 1);
      }
      setTotal(data.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.loadProjectFailed"));
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [filter, search, sort, order, selectedTag, page, t]);

  // Fetch tags
  const fetchTags = useCallback(async () => {
    try {
      const response = await fetch("/api/tags");
      const data = await response.json();
      if (response.ok) {
        setTags(data.tags || []);
      }
    } catch (err) {
      console.error("Error fetching tags:", err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchProjects();
    fetchTags();
  }, []);

  // Reload when filter conditions change
  useEffect(() => {
    fetchProjects(true);
  }, [filter, search, sort, order, selectedTag]);

  // Load more
  const handleLoadMore = () => {
    fetchProjects(false);
  };

  // Handle sort changes
  const handleSortChange = (newSort: string, newOrder: string) => {
    setSort(newSort);
    setOrder(newOrder);
  };

  // Archive project
  const handleArchive = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/archive`, {
        method: "POST",
      });
      if (response.ok) {
        fetchProjects(true);
      }
    } catch (err) {
      console.error("Error archiving project:", err);
    }
  };

  // Move to trash
  const handleTrash = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/trash`, {
        method: "POST",
      });
      if (response.ok) {
        fetchProjects(true);
      }
    } catch (err) {
      console.error("Error trashing project:", err);
    }
  };

  // Restore from trash
  const handleRestore = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/trash`, {
        method: "PATCH",
      });
      if (response.ok) {
        fetchProjects(true);
      }
    } catch (err) {
      console.error("Error restoring project:", err);
    }
  };

  // Permanently delete
  const handleDelete = (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    setConfirmDialog({
      open: true,
      title: t("home.confirmDelete.title"),
      description: t("home.confirmDelete.description", { name: project?.name || "" }),
      confirmText: t("common.delete"),
      confirmStyle: "destructive",
      action: async () => {
        try {
          const response = await fetch(`/api/projects/${projectId}/trash`, {
            method: "DELETE",
          });
          if (response.ok) {
            fetchProjects(true);
          }
        } catch (err) {
          console.error("Error deleting project:", err);
        }
      },
    });
  };

  // Copy project
  const handleCopy = async (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    setConfirmDialog({
      open: true,
      title: t("home.confirmCopy.title"),
      description: t("home.confirmCopy.description", { name: project?.name || "" }),
      confirmText: t("common.confirm"),
      confirmStyle: "default",
      action: async () => {
        try {
          const response = await fetch(`/api/projects/${projectId}/copy`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              suffix: t("home.confirmCopy.suffix"),
              suffixNumbered: t("home.confirmCopy.suffixNumbered", { number: "{number}" }),
            }),
          });
          const data = await response.json();
          if (!response.ok) {
            throw new Error(getApiErrorMessage(data, t, "errors.copyProjectFailed"));
          }
          fetchProjects(true);
        } catch (err) {
          setError(err instanceof Error ? err.message : t("errors.copyProjectFailed"));
        }
      },
    });
  };

  // Open rename dialog
  const handleOpenRename = (projectId: string, currentName: string) => {
    setRenameProjectId(projectId);
    setRenameProjectName(currentName);
    setRenameDialogOpen(true);
  };

  // Rename project
  const handleRename = async (projectId: string, newName: string) => {
    const response = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(getApiErrorMessage(data, t, "errors.updateProjectFailed"));
    }
    fetchProjects(true);
  };

  // Leave shared project
  const handleLeaveProject = (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    setConfirmDialog({
      open: true,
      title: t("home.confirmLeave.title"),
      description: t("home.confirmLeave.description", { name: project?.name || "" }),
      confirmText: t("home.confirmLeave.submit"),
      confirmStyle: "destructive",
      action: async () => {
        try {
          const response = await fetch(`/api/projects/${projectId}/collaborators?userId=me`, {
            method: "DELETE",
          });
          if (response.ok) {
            fetchProjects(true);
          }
        } catch (err) {
          console.error("Error leaving project:", err);
        }
      },
    });
  };

  // Manage project tags
  const handleManageTags = (projectId: string) => {
    setManageTagsProjectId(projectId);
    setManageTagsOpen(true);
  };

  // Create tag
  const handleCreateTag = async (name: string, color: string) => {
    const response = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color }),
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(getApiErrorMessage(data, t));
    }
    fetchTags();
  };

  // Add tag to project
  const handleAddTagToProject = async (projectId: string, tagId: string) => {
    const response = await fetch(`/api/projects/${projectId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagId }),
    });
    if (response.ok) {
      fetchProjects(true);
    }
  };

  // Remove tag from project
  const handleRemoveTagFromProject = async (projectId: string, tagId: string) => {
    const response = await fetch(`/api/projects/${projectId}/tags?tagId=${tagId}`, {
      method: "DELETE",
    });
    if (response.ok) {
      fetchProjects(true);
    }
  };

  // Batch archive
  const handleBatchArchive = async () => {
    for (const projectId of selectedProjects) {
      await handleArchive(projectId);
    }
    setSelectedProjects([]);
  };

  // Batch trash
  const handleBatchTrash = async () => {
    for (const projectId of selectedProjects) {
      await handleTrash(projectId);
    }
    setSelectedProjects([]);
  };

  // Batch add tag
  const handleBatchTag = () => {
    if (selectedProjects.length === 1) {
      handleManageTags(selectedProjects[0]);
    }
  };

  // Get tags for the current project
  const currentProjectTags = manageTagsProjectId
    ? projects.find(p => p.id === manageTagsProjectId)?.tags || []
    : [];

  return (
    <TooltipProvider>
      <div className="flex h-screen relative overflow-hidden">
        {/* Background layer */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-mesh" />
          <div className="absolute inset-0 bg-grid opacity-50" />
          {/* Animated glow spots */}
          <div className="absolute top-1/4 right-1/4 w-[400px] h-[400px] bg-litewrite-cyan/10 rounded-full blur-[100px]" />
          <div className="absolute bottom-1/4 left-1/4 w-[300px] h-[300px] bg-litewrite-teal/10 rounded-full blur-[100px]" />
        </div>

        {/* Left sidebar */}
        <ProjectSidebar
          filter={filter}
          onFilterChange={setFilter}
          tags={tags}
          selectedTag={selectedTag}
          onTagSelect={setSelectedTag}
          onNewProject={() => setCreateProjectOpen(true)}
          onUploadProject={() => setUploadProjectOpen(true)}
          onNewTag={() => setCreateTagOpen(true)}
        />

        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top nav — aligned with the sidebar logo area height */}
          <header className="flex items-center justify-between px-6 py-4 min-h-[64px]">
            <h2 className="text-xl font-bold text-foreground">
              {filter === "all" && t("home.sidebar.allProjects")}
              {filter === "owned" && t("home.sidebar.yourProjects")}
              {filter === "shared" && t("home.sidebar.sharedWithYou")}
              {filter === "archived" && t("home.sidebar.archivedProjects")}
              {filter === "trashed" && t("home.sidebar.trashedProjects")}
            </h2>
            <div className="flex items-center gap-2">
              <ThemeSwitcher />
              <LanguageSwitcher />
              <UserMenu />
            </div>
          </header>

          {/* Main content — project list uses a separate white card background */}
          <main className="flex-1 overflow-auto p-6 pt-2">
            {/* Project list card container — contrasts with the background */}
            <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-2xl shadow-elevation-2 border border-white/50 dark:border-slate-800/50 overflow-hidden">
              {/* Toolbar */}
              <div className="p-4 pb-0">
                <ProjectToolbar
                  search={search}
                  onSearchChange={setSearch}
                  sort={sort}
                  order={order}
                  onSortChange={handleSortChange}
                  selectedCount={selectedProjects.length}
                  onBatchArchive={handleBatchArchive}
                  onBatchTrash={handleBatchTrash}
                  onBatchTag={handleBatchTag}
                  onClearSelection={() => setSelectedProjects([])}
                  currentFilter={filter}
                />
              </div>

              {/* Loading state */}
              {isLoading && (
                <div className="flex flex-col items-center justify-center py-20">
                  <AnimatedLogo
                    width={360}
                    height={189}
                    duration={1.5}
                    pauseDuration={500}
                  />
                  <div className="mt-8 flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-litewrite-cyan animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-litewrite-cyan animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-litewrite-teal animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}

              {/* Error state */}
              {!isLoading && error && (
                <div className="flex flex-col items-center justify-center py-20 px-6">
                  <div className="rounded-xl bg-destructive/10 p-6 text-center border border-destructive/20">
                    <p className="text-destructive">{error}</p>
                  </div>
                </div>
              )}

              {/* Project table */}
              {!isLoading && !error && (
                <div className="px-4 pb-4">
                  <ProjectTable
                    projects={projects}
                    selectedProjects={selectedProjects}
                    onSelectionChange={setSelectedProjects}
                    onRename={handleOpenRename}
                    onArchive={handleArchive}
                    onTrash={handleTrash}
                    onRestore={handleRestore}
                    onDelete={handleDelete}
                    onLeaveProject={handleLeaveProject}
                    onCopy={handleCopy}
                    onManageTags={handleManageTags}
                    currentFilter={filter}
                    sort={sort}
                    order={order}
                    onSortChange={handleSortChange}
                  />

                  {/* Pagination */}
                  <ProjectPagination
                    total={total}
                    loaded={projects.length}
                    isLoading={isLoadingMore}
                    onLoadMore={handleLoadMore}
                  />
                </div>
              )}
            </div>
          </main>
        </div>

        {/* Dialogs */}
        <CreateProjectDialog
          open={createProjectOpen}
          onOpenChange={setCreateProjectOpen}
          onSuccess={() => {
            fetchProjects(true);
            setCreateProjectOpen(false);
          }}
        />

        <UploadProjectDialog
          open={uploadProjectOpen}
          onOpenChange={setUploadProjectOpen}
          onSuccess={() => {
            fetchProjects(true);
          }}
        />

        <CreateTagDialog
          open={createTagOpen}
          onOpenChange={setCreateTagOpen}
          onCreateTag={handleCreateTag}
        />

        <ManageTagsDialog
          open={manageTagsOpen}
          onOpenChange={setManageTagsOpen}
          projectId={manageTagsProjectId || ""}
          projectTags={currentProjectTags as TagItem[]}
          allTags={tags}
          onAddTag={handleAddTagToProject}
          onRemoveTag={handleRemoveTagFromProject}
        />

        <RenameDialog
          open={renameDialogOpen}
          onOpenChange={setRenameDialogOpen}
          projectId={renameProjectId}
          currentName={renameProjectName}
          onRename={handleRename}
        />

        {/* Confirm dialog */}
        <AlertDialog open={confirmDialog.open} onOpenChange={(open: boolean) => setConfirmDialog(prev => ({ ...prev, open }))}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
              <AlertDialogDescription>
                {confirmDialog.description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                className={confirmDialog.confirmStyle === "destructive"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : ""}
                onClick={() => {
                  confirmDialog.action();
                  setConfirmDialog(prev => ({ ...prev, open: false }));
                }}
              >
                {confirmDialog.confirmText || t("common.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
