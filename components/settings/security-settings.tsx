"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { Loader2, Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslations } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { getApiErrorMessage } from "@/lib/api-error-handler";

export function SecuritySettings() {
  const { t } = useTranslations("userSettings.security");
  const { t: tRoot } = useTranslations();
  const { toast } = useToast();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  const handleUpdatePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast({
        title: t("passwordMismatch"),
        variant: "destructive",
      });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        title: t("passwordHint"),
        variant: "destructive",
      });
      return;
    }

    setIsUpdating(true);
    try {
      const response = await fetch("/api/user/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (response.ok) {
        toast({
          title: t("updateSuccess"),
        });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        const data = await response.json();
        const errorMessage = getApiErrorMessage(data, tRoot, "userSettings.security.updateFailed");
        throw new Error(errorMessage);
      }
    } catch (error) {
      toast({
        title: t("updateFailed"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <div className="space-y-6">
        {/* Change Password */}
        <div className="rounded-lg border p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-muted-foreground" />
            <h3 className="font-medium">{t("changePassword")}</h3>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">{t("currentPassword")}</Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="newPassword">{t("newPassword")}</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("passwordHint")}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            <Button
              onClick={handleUpdatePassword}
              disabled={isUpdating || !currentPassword || !newPassword || !confirmPassword}
            >
              {isUpdating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("updating")}
                </>
              ) : (
                t("updatePassword")
              )}
            </Button>
          </div>
        </div>

        {/* Two-Factor Authentication (Coming Soon) */}
        <div className="rounded-lg border p-4 space-y-4 opacity-60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-muted-foreground" />
              <div>
                <h3 className="font-medium">{t("twoFactor")}</h3>
                <p className="text-sm text-muted-foreground">{t("twoFactorDesc")}</p>
              </div>
            </div>
            <Button variant="outline" disabled>
              {t("comingSoon")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
