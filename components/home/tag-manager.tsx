"use client";

import { useState } from "react";
import { Plus, X, Check, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/lib/i18n";

export interface TagItem {
  id: string;
  name: string;
  color: string;
  projectCount: number;
}

// Preset colors
const PRESET_COLORS = [
  "#EF4444", // red
  "#F97316", // orange
  "#F59E0B", // amber
  "#EAB308", // yellow
  "#84CC16", // lime
  "#22C55E", // green
  "#14B8A6", // teal
  "#06B6D4", // cyan
  "#0EA5E9", // sky
  "#3B82F6", // blue
  "#6366F1", // indigo
  "#8B5CF6", // violet
  "#A855F7", // purple
  "#D946EF", // fuchsia
  "#EC4899", // pink
  "#6B7280", // gray
];

interface CreateTagDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateTag: (name: string, color: string) => Promise<void>;
}

export function CreateTagDialog({
  open,
  onOpenChange,
  onCreateTag,
}: CreateTagDialogProps) {
  const { t } = useTranslations("home.tags");
  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError(t("nameRequired"));
      return;
    }

    setIsLoading(true);
    setError("");
    try {
      await onCreateTag(name.trim(), color);
      setName("");
      setColor(PRESET_COLORS[0]);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("createTag")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <label className="text-sm font-medium mb-2 block">
              {t("tagName")}
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("tagNamePlaceholder")}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">
              {t("tagColor")}
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Select color ${c}`}
                  title={`Select color ${c}`}
                  className={cn(
                    "h-6 w-6 rounded-full transition-transform hover:scale-110",
                    color === c && "ring-2 ring-offset-2 ring-gray-400"
                  )}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>

          {/* Preview */}
          <div>
            <label className="text-sm font-medium mb-2 block">
              {t("preview")}
            </label>
            <div className="flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-sm">{name || t("tagNamePlaceholder")}</span>
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading}>
            {isLoading ? t("creating") : t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ManageTagsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectTags: TagItem[];
  allTags: TagItem[];
  onAddTag: (projectId: string, tagId: string) => Promise<void>;
  onRemoveTag: (projectId: string, tagId: string) => Promise<void>;
}

export function ManageTagsDialog({
  open,
  onOpenChange,
  projectId,
  projectTags,
  allTags,
  onAddTag,
  onRemoveTag,
}: ManageTagsDialogProps) {
  const { t } = useTranslations("home.tags");
  const [isLoading, setIsLoading] = useState<string | null>(null);

  const projectTagIds = new Set(projectTags.map(t => t.id));

  const handleToggleTag = async (tagId: string) => {
    setIsLoading(tagId);
    try {
      if (projectTagIds.has(tagId)) {
        await onRemoveTag(projectId, tagId);
      } else {
        await onAddTag(projectId, tagId);
      }
    } catch (err) {
      console.error("Error toggling tag:", err);
    } finally {
      setIsLoading(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("manageTags")}</DialogTitle>
        </DialogHeader>

        <div className="py-4">
          {allTags.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t("noTags")}
            </p>
          ) : (
            <div className="space-y-2">
              {allTags.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => handleToggleTag(tag.id)}
                  disabled={isLoading === tag.id}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2 rounded-md transition-colors",
                    projectTagIds.has(tag.id)
                      ? "bg-emerald-50 dark:bg-emerald-900/30"
                      : "hover:bg-gray-100 dark:hover:bg-gray-800"
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="text-sm">{tag.name}</span>
                  </span>
                  {projectTagIds.has(tag.id) && (
                    <Check className="h-4 w-4 text-primary" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>
            {t("done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface EditTagDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tag: TagItem | null;
  onUpdateTag: (tagId: string, name: string, color: string) => Promise<void>;
  onDeleteTag: (tagId: string) => Promise<void>;
}

export function EditTagDialog({
  open,
  onOpenChange,
  tag,
  onUpdateTag,
  onDeleteTag,
}: EditTagDialogProps) {
  const { t } = useTranslations("home.tags");
  const [name, setName] = useState(tag?.name || "");
  const [color, setColor] = useState(tag?.color || PRESET_COLORS[0]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState("");

  // Update the form when `tag` changes.
  useState(() => {
    if (tag) {
      setName(tag.name);
      setColor(tag.color);
    }
  });

  const handleSubmit = async () => {
    if (!tag) return;
    if (!name.trim()) {
      setError(t("nameRequired"));
      return;
    }

    setIsLoading(true);
    setError("");
    try {
      await onUpdateTag(tag.id, name.trim(), color);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("updateFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!tag) return;

    setIsDeleting(true);
    try {
      await onDeleteTag(tag.id);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("deleteFailed"));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("editTag")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <label className="text-sm font-medium mb-2 block">
              {t("tagName")}
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("tagNamePlaceholder")}
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">
              {t("tagColor")}
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Select color ${c}`}
                  title={`Select color ${c}`}
                  className={cn(
                    "h-6 w-6 rounded-full transition-transform hover:scale-110",
                    color === c && "ring-2 ring-offset-2 ring-gray-400"
                  )}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter className="flex justify-between">
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting || isLoading}
          >
            {isDeleting ? t("deleting") : t("delete")}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={handleSubmit} disabled={isLoading || isDeleting}>
              {isLoading ? t("saving") : t("save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
