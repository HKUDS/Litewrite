"use client";

import { useState, useRef, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  User,
  Shield,
  AlertTriangle,
  ArrowLeft,
  Code,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ProfileSettings, ProfileSettingsRef } from "@/components/settings/profile-settings";
import { SecuritySettings } from "@/components/settings/security-settings";
import { DangerZone } from "@/components/settings/danger-zone";
import { EditorSettingsSection } from "@/components/settings/editor-settings-section";
import { UserMenu } from "@/components/user-menu";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useToast } from "@/components/ui/use-toast";
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

type SettingsTab =
  | "profile"
  | "security"
  | "editor"
  | "danger";

// Validate whether the tab is valid
const validTabs: SettingsTab[] = ["profile", "security", "editor", "danger"];

export default function SettingsPage() {
  const { t } = useTranslations("userSettings");
  const { t: tCommon } = useTranslations("common");
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();

  // Read initial tab from URL params
  const tabParam = searchParams.get("tab") as SettingsTab | null;
  const initialTab = tabParam && validTabs.includes(tabParam) ? tabParam : "profile";
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  // Refs for settings components that support unsaved changes detection
  const profileRef = useRef<ProfileSettingsRef>(null);

  // Leave-confirmation dialog state
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);
  const [pendingTab, setPendingTab] = useState<SettingsTab | null>(null);

  const tabs = [
    { id: "profile" as const, label: t("profile.title"), icon: User },
    { id: "security" as const, label: t("security.title"), icon: Shield },
    { id: "editor" as const, label: t("editorSettings.title"), icon: Code },
    { id: "danger" as const, label: t("dangerZone.title"), icon: AlertTriangle },
  ];

  // Check whether the current tab has unsaved changes
  const checkForUnsavedChanges = (): boolean => {
    if (activeTab === "profile" && profileRef.current) {
      return profileRef.current.hasUnsavedChanges();
    }
    // You can add checks for other settings tabs here
    return false;
  };

  // Discard changes in the current tab
  const discardCurrentChanges = () => {
    if (activeTab === "profile" && profileRef.current) {
      profileRef.current.discardChanges();
    }
    // You can add discard logic for other settings tabs here
  };

  // Handle tab switch
  const handleTabChange = (newTab: SettingsTab) => {
    if (newTab === activeTab) return;

    // Check for unsaved changes
    if (checkForUnsavedChanges()) {
      setPendingTab(newTab);
      setShowLeaveDialog(true);
    } else {
      setActiveTab(newTab);
    }
  };

  // Confirm discarding changes and switch tab
  const handleDiscardAndSwitch = () => {
    discardCurrentChanges();
    if (pendingTab) {
      setActiveTab(pendingTab);
      setPendingTab(null);
    }
    setShowLeaveDialog(false);
  };

  // Cancel switching
  const handleCancelSwitch = () => {
    setPendingTab(null);
    setShowLeaveDialog(false);
  };

  return (
    <>
      <div className="min-h-screen bg-background">
        {/* Header */}
        <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex h-14 items-center justify-between px-6">
            <div className="flex items-center gap-4">
              <Link href="/dashboard">
                <Button variant="ghost" size="sm" className="gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  {t("backToHome")}
                </Button>
              </Link>
              <h1 className="text-lg font-semibold">{t("title")}</h1>
            </div>
            <div className="flex items-center gap-2">
              <LanguageSwitcher />
              <ThemeSwitcher />
              <UserMenu />
            </div>
          </div>
        </header>

        {/* Main Content */}
        <div className="flex-1 px-6 py-8">
          <div className="flex flex-col gap-8 lg:flex-row">
            {/* Sidebar */}
            <aside className="lg:w-64 shrink-0">
              <nav className="sticky top-24 space-y-1">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      activeTab === tab.id
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                      tab.id === "danger" && "text-destructive hover:text-destructive"
                    )}
                  >
                    <tab.icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                ))}
              </nav>
            </aside>

            {/* Content */}
            <main className="flex-1 min-w-0">
              <div className="max-w-2xl">
                {activeTab === "profile" && <ProfileSettings ref={profileRef} />}
                {activeTab === "security" && <SecuritySettings />}
                {activeTab === "editor" && <EditorSettingsSection />}
                {activeTab === "danger" && <DangerZone />}
              </div>
            </main>
          </div>
        </div>
      </div>

      {/* Leave confirmation dialog */}
      <AlertDialog open={showLeaveDialog} onOpenChange={setShowLeaveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("profile.unsavedChangesTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("profile.unsavedChangesDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelSwitch}>
              {t("profile.stayOnPage")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDiscardAndSwitch}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("profile.discardChanges")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
