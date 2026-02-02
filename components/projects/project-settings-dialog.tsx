"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslations } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Copy,
  Check,
  Link,
  Users,
  Globe,
  Lock,
  UserPlus,
  Trash2,
} from "lucide-react";

interface Collaborator {
  id: string;
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
  role: string;
}

interface ProjectSettingsDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProjectSettingsDialog({
  projectId,
  open,
  onOpenChange,
}: ProjectSettingsDialogProps) {
  const { t } = useTranslations();
  const { toast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [visibility, setVisibility] = useState<string>("private");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [isAddingCollaborator, setIsAddingCollaborator] = useState(false);
  const [copied, setCopied] = useState(false);

  // Load share info and collaborators
  useEffect(() => {
    if (open) {
      loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      // Fetch share info
      const shareRes = await fetch(`/api/projects/${projectId}/share`);
      if (shareRes.ok) {
        const shareData = await shareRes.json();
        setVisibility(shareData.visibility);
        setShareUrl(shareData.shareUrl);
      }

      // Fetch collaborators
      const collabRes = await fetch(`/api/projects/${projectId}/collaborators`);
      if (collabRes.ok) {
        const collabData = await collabRes.json();
        setCollaborators(collabData.collaborators);
      }
    } catch (error) {
      console.error("Error loading project settings:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Generate share link
  const handleGenerateLink = async () => {
    setIsGeneratingLink(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/share`, {
        method: "POST",
      });
      const data = await res.json();

      if (res.ok) {
        setShareUrl(data.shareUrl);
        setVisibility("shared");
        toast({
          title: t("common.success"),
          description: t("share.linkCopied"),
        });
      } else {
        toast({
          title: t("common.error"),
          description: data.error,
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: t("common.error"),
        description: t("errors.networkError"),
        variant: "destructive",
      });
    } finally {
      setIsGeneratingLink(false);
    }
  };

  // Cancel sharing
  const handleCancelShare = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/share`, {
        method: "DELETE",
      });

      if (res.ok) {
        setShareUrl(null);
        setVisibility("private");
        toast({
          title: t("common.success"),
        });
      }
    } catch {
      toast({
        title: t("common.error"),
        variant: "destructive",
      });
    }
  };

  // Copy link
  const handleCopyLink = async () => {
    if (shareUrl) {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        description: t("share.linkCopied"),
      });
    }
  };

  // Add collaborator
  const handleAddCollaborator = async () => {
    if (!newEmail.trim()) return;

    setIsAddingCollaborator(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/collaborators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim(), role: "editor" }),
      });
      const data = await res.json();

      if (res.ok) {
        setCollaborators([...collaborators, data.collaborator]);
        setNewEmail("");
        toast({
          title: t("common.success"),
        });
      } else {
        toast({
          title: t("common.error"),
          description: data.error,
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: t("common.error"),
        variant: "destructive",
      });
    } finally {
      setIsAddingCollaborator(false);
    }
  };

  // Remove collaborator
  const handleRemoveCollaborator = async (userId: string) => {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/collaborators?userId=${userId}`,
        { method: "DELETE" }
      );

      if (res.ok) {
        setCollaborators(collaborators.filter((c) => c.user.id !== userId));
        toast({
          title: t("common.success"),
        });
      }
    } catch {
      toast({
        title: t("common.error"),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("share.title")}</DialogTitle>
          <DialogDescription>{t("share.description")}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Link sharing */}
            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <Link className="h-4 w-4" />
                {t("share.sharedDesc")}
              </Label>

              {shareUrl ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input value={shareUrl} readOnly className="flex-1" />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleCopyLink}
                      aria-label="Copy link"
                      title="Copy link"
                    >
                      {copied ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelShare}
                    className="text-destructive"
                  >
                    {t("share.cancelShare")}
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={handleGenerateLink}
                  disabled={isGeneratingLink}
                  className="w-full"
                >
                  {isGeneratingLink && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {t("share.generateLink")}
                </Button>
              )}
            </div>

            {/* Collaborators */}
            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                {t("share.collaborators")}
              </Label>

              {/* Add collaborator */}
              <div className="flex gap-2">
                <Input
                  placeholder={t("share.emailPlaceholder")}
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddCollaborator()}
                />
                <Button
                  onClick={handleAddCollaborator}
                  disabled={isAddingCollaborator || !newEmail.trim()}
                  aria-label="Add collaborator"
                  title="Add collaborator"
                >
                  {isAddingCollaborator ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4" />
                  )}
                </Button>
              </div>

              {/* Collaborator list */}
              {collaborators.length > 0 && (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {collaborators.map((collab) => (
                    <div
                      key={collab.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
                    >
                      <div className="flex items-center gap-2">
                        {collab.user.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={collab.user.image}
                            alt={collab.user.name || ""}
                            className="h-8 w-8 rounded-full"
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm">
                            {collab.user.name?.[0] || collab.user.email[0]}
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-medium">
                            {collab.user.name || collab.user.email}
                          </p>
                          {collab.user.name && (
                            <p className="text-xs text-muted-foreground">
                              {collab.user.email}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {collab.role === "editor"
                            ? t("share.roleEditor")
                            : t("share.roleViewer")}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveCollaborator(collab.user.id)}
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          aria-label="Remove collaborator"
                          title="Remove collaborator"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {collaborators.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {t("share.addCollaborator")}
                </p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
