"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { useTranslations } from "@/lib/i18n";

interface RenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  currentName: string;
  onRename: (projectId: string, newName: string) => Promise<void>;
}

export function RenameDialog({
  open,
  onOpenChange,
  projectId,
  currentName,
  onRename,
}: RenameDialogProps) {
  const { t } = useTranslations("home.rename");
  const [name, setName] = useState(currentName);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // Reset `name` when the dialog opens or `currentName` changes.
  useEffect(() => {
    if (open) {
      setName(currentName);
      setError("");
    }
  }, [open, currentName]);

  const handleSubmit = async () => {
    const trimmedName = name.trim();

    if (!trimmedName) {
      setError(t("nameRequired"));
      return;
    }

    if (trimmedName === currentName) {
      onOpenChange(false);
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      await onRename(projectId, trimmedName);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("renameFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isLoading) {
      handleSubmit();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <label className="text-sm font-medium mb-2 block">
              {t("newName")}
            </label>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
              placeholder={t("namePlaceholder")}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            {t("cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isLoading ? t("renaming") : t("rename")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
