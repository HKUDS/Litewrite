"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useTranslations } from "@/lib/i18n";
import { getApiErrorMessage } from "@/lib/api-error-handler";

interface CreateVersionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onSuccess?: () => void;
}

export function CreateVersionDialog({
  open,
  onOpenChange,
  projectId,
  onSuccess,
}: CreateVersionDialogProps) {
  const { t } = useTranslations("history");
  const { t: tRoot } = useTranslations();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast({
        title: t("error"),
        description: t("versionNameRequired"),
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const apiMessage = getApiErrorMessage(data, tRoot, "common.error");
        throw new Error(apiMessage === tRoot("common.error") ? t("createVersionFailed") : apiMessage);
      }

      // Prefer frontend-translated messages so the language follows system settings.
      const message = data.version
        ? t("versionCreatedWithCount", { name: data.version.name, count: data.version.fileCount || 0 })
        : t("versionCreated");

      toast({
        title: t("success"),
        description: message,
      });

      // Reset the form and close the dialog.
      setName("");
      setDescription("");
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast({
        title: t("error"),
        description: error instanceof Error ? error.message : t("createVersionFailed"),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t("createVersion")}</DialogTitle>
          <DialogDescription>{t("createVersionDescription")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="version-name">{t("versionName")}</Label>
              <Input
                id="version-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("versionNamePlaceholder")}
                disabled={isLoading}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="version-description">
                {t("versionDescription")}
                <span className="text-muted-foreground ml-1">({t("optional")})</span>
              </Label>
              <Input
                id="version-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("versionDescriptionPlaceholder")}
                disabled={isLoading}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={isLoading || !name.trim()}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
