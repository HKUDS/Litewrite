"use client";

import { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { Download, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslations } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";

export function DangerZone() {
  const { t } = useTranslations("userSettings.dangerZone");
  const { t: tCommon } = useTranslations("common");
  const { data: session } = useSession();
  const { toast } = useToast();

  const [isExporting, setIsExporting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await fetch("/api/user/export", {
        method: "POST",
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `litewrite-export-${new Date().toISOString().split("T")[0]}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        toast({
          title: t("exportSuccess"),
        });
      } else {
        throw new Error("Export failed");
      }
    } catch {
      toast({
        title: t("exportFailed"),
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleDelete = async () => {
    if (confirmEmail !== session?.user?.email) {
      return;
    }

    setIsDeleting(true);
    try {
      const response = await fetch("/api/user/delete", {
        method: "DELETE",
      });

      if (response.ok) {
        toast({
          title: t("deleteSuccess"),
        });
        await signOut({ callbackUrl: "/" });
      } else {
        throw new Error("Delete failed");
      }
    } catch {
      toast({
        title: t("deleteFailed"),
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <div className="space-y-4">
        {/* Export Data */}
        <div className="rounded-lg border p-4">
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-lg bg-muted">
              <Download className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex-1 space-y-1">
              <h3 className="font-medium">{t("exportData")}</h3>
              <p className="text-sm text-muted-foreground">{t("exportDataDesc")}</p>
            </div>
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={isExporting}
            >
              {isExporting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("exporting")}
                </>
              ) : (
                t("exportButton")
              )}
            </Button>
          </div>
        </div>

        {/* Delete Account */}
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4">
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-lg bg-destructive/10">
              <Trash2 className="h-5 w-5 text-destructive" />
            </div>
            <div className="flex-1 space-y-1">
              <h3 className="font-medium text-destructive">{t("deleteAccount")}</h3>
              <p className="text-sm text-muted-foreground">{t("deleteAccountDesc")}</p>
            </div>
            <Button
              variant="destructive"
              onClick={() => setShowDeleteDialog(true)}
            >
              {t("deleteButton")}
            </Button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {t("deleteConfirmTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("deleteConfirmDesc").replace("{email}", session?.user?.email || "")}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              placeholder={t("emailConfirmPlaceholder")}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowDeleteDialog(false);
                setConfirmEmail("");
              }}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={confirmEmail !== session?.user?.email || isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("deleting")}
                </>
              ) : (
                t("deleteButton")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
