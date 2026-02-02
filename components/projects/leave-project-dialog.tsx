"use client";

import { useState } from "react";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslations } from "@/lib/i18n";
import type { ProjectListItem } from "@/types";

interface LeaveProjectDialogProps {
  project: ProjectListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function LeaveProjectDialog({
  project,
  open,
  onOpenChange,
  onSuccess,
}: LeaveProjectDialogProps) {
  const { t } = useTranslations("project.leave");
  const { t: tCommon } = useTranslations("common");
  const { t: tErrors } = useTranslations("errors");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLeave = async () => {
    if (!project) return;

    setIsLoading(true);
    setError("");

    try {
      // Call collaborators API to remove self.
      const response = await fetch(`/api/projects/${project.id}/collaborators?userId=me`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || tErrors("leaveProjectFailed"));
      }

      onOpenChange(false);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : tErrors("leaveProjectFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setError("");
    }
    onOpenChange(open);
  };

  // Get owner display name.
  const ownerDisplayName = project?.owner?.name || project?.owner?.email || "";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
              <LogOut className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <DialogTitle>{t("title")}</DialogTitle>
          </div>
          <DialogDescription className="pt-2">
            {t("description", { name: project?.name || "" })}
          </DialogDescription>
          {ownerDisplayName && (
            <p className="text-sm text-muted-foreground mt-2">
              {t("ownerInfo", { owner: ownerDisplayName })}
            </p>
          )}
        </DialogHeader>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isLoading}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            variant="default"
            className="bg-amber-600 hover:bg-amber-700 text-white"
            onClick={handleLeave}
            disabled={isLoading}
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
