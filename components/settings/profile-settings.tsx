"use client";

import { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslations } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { getApiErrorMessage } from "@/lib/api-error-handler";

// Methods exposed to the parent component
export interface ProfileSettingsRef {
  hasUnsavedChanges: () => boolean;
  discardChanges: () => void;
}

export const ProfileSettings = forwardRef<ProfileSettingsRef>(function ProfileSettings(_, ref) {
  const { t } = useTranslations("userSettings.profile");
  const { t: tRoot } = useTranslations();
  const { data: session, update } = useSession();
  const { toast } = useToast();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Original values (used to detect changes)
  const [originalName, setOriginalName] = useState("");
  const [originalAvatarUrl, setOriginalAvatarUrl] = useState<string | null>(null);

  // Current editable values
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // Newly selected avatar file (local preview; not uploaded yet)
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);
  const [pendingAvatarPreview, setPendingAvatarPreview] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);

  // Track initialization to prevent later session updates from overwriting user edits
  const [isInitialized, setIsInitialized] = useState(false);

  // Sync session data to local state (only during initialization)
  useEffect(() => {
    if (session?.user && !isInitialized) {
      const sessionName = session.user.name || "";
      const sessionImage = session.user.image || null;

      setName(sessionName);
      setAvatarUrl(sessionImage);
      setOriginalName(sessionName);
      setOriginalAvatarUrl(sessionImage);
      setIsInitialized(true);
    }
  }, [session, isInitialized]);

  // Check whether there are unsaved changes
  const hasChanges = useCallback(() => {
    const nameChanged = name !== originalName;
    const avatarChanged = pendingAvatarFile !== null;
    return nameChanged || avatarChanged;
  }, [name, originalName, pendingAvatarFile]);

  // Discard changes
  const discardChanges = useCallback(() => {
    setName(originalName);
    setPendingAvatarFile(null);
    if (pendingAvatarPreview) {
      URL.revokeObjectURL(pendingAvatarPreview);
      setPendingAvatarPreview(null);
    }
  }, [originalName, pendingAvatarPreview]);

  // Expose methods to parent component
  useImperativeHandle(ref, () => ({
    hasUnsavedChanges: hasChanges,
    discardChanges,
  }), [hasChanges, discardChanges]);

  // Cleanup avatar preview URL
  useEffect(() => {
    return () => {
      if (pendingAvatarPreview) {
        URL.revokeObjectURL(pendingAvatarPreview);
      }
    };
  }, [pendingAvatarPreview]);

  // Listen for browser unload (tab close / refresh)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasChanges()) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasChanges]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      let avatarSaved = false;
      let profileSaved = false;
      // Store newly uploaded avatar URL (avoid async React state update issues)
      let newAvatarUrl: string | null = null;

      // 1) If there is a new avatar, upload it first
      if (pendingAvatarFile) {
        const formData = new FormData();
        formData.append("avatar", pendingAvatarFile);

        const avatarResponse = await fetch("/api/user/avatar", {
          method: "POST",
          body: formData,
        });

        if (avatarResponse.ok) {
          const data = await avatarResponse.json();
          newAvatarUrl = data.image;
          setAvatarUrl(data.image);
          setOriginalAvatarUrl(data.image);
          setPendingAvatarFile(null);
          if (pendingAvatarPreview) {
            URL.revokeObjectURL(pendingAvatarPreview);
            setPendingAvatarPreview(null);
          }
          avatarSaved = true;
        } else {
          const errorData = await avatarResponse.json();
          const errorMessage = getApiErrorMessage(errorData, tRoot, "userSettings.profile.saveFailed");
          throw new Error(errorMessage);
        }
      }

      // 2) Save profile (name)
      if (name !== originalName) {
        const response = await fetch("/api/user/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });

        if (response.ok) {
          setOriginalName(name);
          profileSaved = true;
        } else {
          throw new Error("Failed to save profile");
        }
      }

      // 3) Update session (pass new data to ensure token is updated correctly)
      if (avatarSaved || profileSaved) {
        // Force refresh session with updated data
        // Use newAvatarUrl (if a new avatar was uploaded) or the current avatarUrl
        await update({
          name: name,
          image: newAvatarUrl ?? avatarUrl,
        });
        // Reset initialization flag to allow syncing from session next time
        setIsInitialized(false);
        router.refresh();
        toast({
          title: t("saveSuccess"),
        });
      } else {
        // No changes
        toast({
          title: t("noChanges"),
        });
      }
    } catch (error) {
      toast({
        title: t("saveFailed"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: t("unsupportedFormat"),
        description: t("unsupportedFormatDesc"),
        variant: "destructive",
      });
      return;
    }

    // Validate file size (2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: t("fileTooLarge"),
        description: t("fileTooLargeDesc"),
        variant: "destructive",
      });
      return;
    }

    // Cleanup previous preview URL
    if (pendingAvatarPreview) {
      URL.revokeObjectURL(pendingAvatarPreview);
    }

    // Create local preview
    const previewUrl = URL.createObjectURL(file);
    setPendingAvatarFile(file);
    setPendingAvatarPreview(previewUrl);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Displayed avatar: prefer pending preview, otherwise current avatar
  const displayAvatarUrl = pendingAvatarPreview || avatarUrl;

  return (
    <>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>

        <div className="space-y-6">
          {/* Avatar */}
          <div className="flex items-center gap-6">
            <div className="relative">
              <button
                onClick={handleAvatarClick}
                disabled={isSaving}
                className="relative h-20 w-20 rounded-full overflow-hidden border-2 border-muted hover:border-primary transition-colors group"
              >
                {displayAvatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={displayAvatarUrl}
                    alt={name || "Avatar"}
                    className="h-full w-full object-cover"
                    key={displayAvatarUrl}
                  />
                ) : (
                  <div className="h-full w-full bg-primary flex items-center justify-center text-primary-foreground text-2xl font-semibold">
                    {name?.[0] || session?.user?.email?.[0] || "U"}
                  </div>
                )}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Camera className="h-6 w-6 text-white" />
                </div>
              </button>
              {/* Unsaved indicator */}
              {pendingAvatarFile && (
                <div
                  className="absolute -top-1 -right-1 h-4 w-4 bg-orange-500 rounded-full border-2 border-background"
                  title={t("unsavedIndicator")}
                />
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                aria-label="Upload avatar"
                onChange={handleAvatarChange}
              />
            </div>
            <div>
              <Label>{t("avatar")}</Label>
              <p className="text-sm text-muted-foreground">
                {pendingAvatarFile
                  ? t("avatarPending")
                  : t("avatarHint")}
              </p>
            </div>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">{t("name")}</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
            />
          </div>

          {/* Email (read-only) */}
          <div className="space-y-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input
              id="email"
              value={session?.user?.email || ""}
              disabled
              className="bg-muted"
            />
          </div>

          {/* Save Button */}
          <div className="flex items-center gap-4">
            <Button onClick={handleSave} disabled={isSaving || !hasChanges()}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("saving")}
                </>
              ) : (
                t("saveChanges")
              )}
            </Button>
            {hasChanges() && (
              <span className="text-sm text-muted-foreground">
                {t("unsavedChanges")}
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
});
