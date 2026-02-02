"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Code,
  Palette,
  Settings2,
  User,
  ExternalLink,
  FileText,
  Check,
  RotateCcw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useUserSettings, type UserSettings } from "@/lib/hooks/use-user-settings";
import { useTheme, type Theme } from "@/lib/theme";
import { useI18n, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type SettingsTab = "editor" | "compiler" | "pdfviewer" | "appearance" | "account";

interface EditorSettingsDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditorSettingsDialog({
  projectId,
  open,
  onOpenChange,
}: EditorSettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("editor");
  const { settings, updateSettings, isLoading } = useUserSettings();
  const { setTheme } = useTheme();
  const { setLocale } = useI18n();

  // Local temporary settings state
  const [localSettings, setLocalSettings] = useState<UserSettings>(settings);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Project-level compiler (not stored in user settings)
  const [projectCompiler, setProjectCompiler] = useState<string | null>(null);
  const [initialProjectCompiler, setInitialProjectCompiler] = useState<string | null>(null);

  // Track previous open state to avoid losing in-progress edits if settings change while open
  const prevOpenRef = useRef(false);
  // Track whether user changed compiler before fetch completes
  const userModifiedCompilerRef = useRef(false);

  // Sync local settings only when dialog transitions from closed to open
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;

    // Sync only when the dialog has just opened (false -> true)
    if (open && !wasOpen) {
      setLocalSettings(settings);
      setHasChanges(false);
      userModifiedCompilerRef.current = false;

      // Fetch current project compiler (project-level)
      fetch(`/api/projects/${projectId}`)
        .then(res => res.json())
        .then((data) => {
          const compilerFromApi = data?.project?.compiler ?? null;
          // Always update initialProjectCompiler so Reset works correctly
          setInitialProjectCompiler(compilerFromApi);
          // Only update the current displayed value if the user hasn't modified it
          if (!userModifiedCompilerRef.current) {
            setProjectCompiler(compilerFromApi);
          }
        })
        .catch(() => {
          // If request fails, set defaults only if user hasn't modified the compiler
          if (!userModifiedCompilerRef.current) {
            setProjectCompiler(null);
            setInitialProjectCompiler(null);
          }
        });
    }
  }, [open, settings, projectId]);

  // Update local settings
  const updateLocalSettings = useCallback((updates: Partial<UserSettings>) => {
    setLocalSettings(prev => ({ ...prev, ...updates }));
    setHasChanges(true);
  }, []);

  const hasProjectCompilerChanges = useMemo(() => {
    return projectCompiler !== initialProjectCompiler;
  }, [projectCompiler, initialProjectCompiler]);

  // Reset to original settings
  const handleReset = useCallback(() => {
    setLocalSettings(settings);
    setHasChanges(false);
    setProjectCompiler(initialProjectCompiler);
  }, [settings, initialProjectCompiler]);

  // Save settings
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      // 1) Save user settings (only if changed)
      if (hasChanges) {
        await updateSettings(localSettings);
        // If theme changed, apply immediately
        if (localSettings.theme !== settings.theme) {
          setTheme(localSettings.theme as Theme);
        }
        // If language changed, apply immediately
        if (localSettings.language !== settings.language) {
          setLocale(localSettings.language as Locale);
        }
        // Mark user settings as saved immediately after success
        setHasChanges(false);
      }

      // 2) Save project-level compiler (allow null to clear)
      if (hasProjectCompilerChanges) {
        const res = await fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ compiler: projectCompiler }),
        });
        if (res.ok) {
          setInitialProjectCompiler(projectCompiler);
        } else {
          // Do not close the dialog on failure to allow retry
          const text = await res.text().catch(() => "");
          throw new Error(text || "Failed to update project compiler");
        }
      }

      onOpenChange(false);
    } catch (error) {
      console.error("Failed to save settings:", error);
    } finally {
      setIsSaving(false);
    }
  }, [hasChanges, localSettings, settings.theme, settings.language, updateSettings, setTheme, setLocale, hasProjectCompilerChanges, projectId, projectCompiler, onOpenChange]);

  // Close dialog (discard changes)
  const handleClose = useCallback(() => {
    setLocalSettings(settings);
    setHasChanges(false);
    setProjectCompiler(initialProjectCompiler);
    onOpenChange(false);
  }, [settings, initialProjectCompiler, onOpenChange]);

  const tabs = [
    { id: "editor" as const, label: "Editor", icon: Code },
    { id: "compiler" as const, label: "Compiler", icon: Settings2 },
    { id: "pdfviewer" as const, label: "PDF Viewer", icon: FileText },
    { id: "appearance" as const, label: "Appearance", icon: Palette },
    { id: "account" as const, label: "Account", icon: User },
  ];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-[400px]">
          {/* Left navigation */}
          <div className="w-48 border-r bg-muted/30 p-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  activeTab === tab.id
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
                onClick={() => setActiveTab(tab.id)}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Right content */}
          <div className="flex-1 p-6 overflow-y-auto">
            {activeTab === "editor" && (
              <EditorSettings settings={localSettings} updateSettings={updateLocalSettings} />
            )}
            {activeTab === "compiler" && (
              <ProjectCompilerSettings compiler={projectCompiler} onChange={(value) => {
                userModifiedCompilerRef.current = true;
                setProjectCompiler(value);
              }} />
            )}
            {activeTab === "pdfviewer" && (
              <PdfViewerSettings settings={localSettings} updateSettings={updateLocalSettings} />
            )}
            {activeTab === "appearance" && (
              <AppearanceSettings settings={localSettings} updateSettings={updateLocalSettings} />
            )}
            {activeTab === "account" && <AccountSettings />}
          </div>
        </div>

        {/* Footer actions */}
        <DialogFooter className="px-6 py-4 border-t bg-muted/20">
          <div className="flex items-center justify-between w-full">
            <div className="text-xs text-muted-foreground">
              {(hasChanges || hasProjectCompilerChanges) && "You have unsaved changes"}
            </div>
            <div className="flex items-center gap-2">
              {(hasChanges || hasProjectCompilerChanges) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReset}
                  className="gap-1.5"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleClose}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={(!hasChanges && !hasProjectCompilerChanges) || isSaving}
                className="gap-1.5"
              >
                <Check className="h-3.5 w-3.5" />
                {isSaving ? "Saving..." : "Confirm"}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Editor settings
function EditorSettings({
  settings,
  updateSettings,
}: {
  settings: UserSettings;
  updateSettings: (updates: Partial<UserSettings>) => void;
}) {
  return (
    <div className="space-y-6">
      {/* Auto-complete */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Auto-complete</Label>
          <p className="text-xs text-muted-foreground">
            Suggests code completions while typing
          </p>
        </div>
        <Switch
          checked={settings.autoComplete}
          onCheckedChange={(checked) => updateSettings({ autoComplete: checked })}
        />
      </div>

      {/* Auto-close brackets */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Auto-close brackets</Label>
          <p className="text-xs text-muted-foreground">
            Automatically insert closing brackets and parentheses
          </p>
        </div>
        <Switch
          checked={settings.autoCloseBrackets}
          onCheckedChange={(checked) => updateSettings({ autoCloseBrackets: checked })}
        />
      </div>

      {/* Keybindings */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Keybindings</Label>
          <p className="text-xs text-muted-foreground">
            Work in Vim or Emacs emulation mode
          </p>
        </div>
        <Select
          value={settings.keybindings}
          onValueChange={(value) => updateSettings({ keybindings: value })}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="vim">Vim</SelectItem>
            <SelectItem value="emacs">Emacs</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// Project compiler settings (project-level; not stored in user settings)
function ProjectCompilerSettings({
  compiler,
  onChange,
}: {
  compiler: string | null;
  onChange: (compiler: string | null) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Project LaTeX Compiler</Label>
          <p className="text-xs text-muted-foreground">
            Choose the LaTeX compiler for this project. Use Default to fall back to your account preference.
          </p>
        </div>
        <Select
          value={compiler ?? "default"}
          onValueChange={(value) => onChange(value === "default" ? null : value)}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default</SelectItem>
            <SelectItem value="pdflatex">pdfLaTeX</SelectItem>
            <SelectItem value="xelatex">XeLaTeX</SelectItem>
            <SelectItem value="lualatex">LuaLaTeX</SelectItem>
            <SelectItem value="latex">LaTeX</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md bg-muted/50 p-4">
        <p className="text-sm text-muted-foreground">
          <strong>pdfLaTeX</strong> - Fast compilation, good for basic documents
          <br />
          <strong>XeLaTeX</strong> - Best for Unicode and non-Latin fonts
          <br />
          <strong>LuaLaTeX</strong> - Advanced features and Lua scripting support
          <br />
          <strong>LaTeX</strong> - Traditional LaTeX → DVI → PS → PDF
        </p>
      </div>
    </div>
  );
}

// PDF viewer settings
function PdfViewerSettings({
  settings,
  updateSettings,
}: {
  settings: UserSettings;
  updateSettings: (updates: Partial<UserSettings>) => void;
}) {
  return (
    <div className="space-y-6">
      {/* PDF Viewer */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">PDF Viewer</Label>
          <p className="text-xs text-muted-foreground">
            Choose the PDF viewer for preview
          </p>
        </div>
        <Select
          value={settings.pdfViewer}
          onValueChange={(value) => updateSettings({ pdfViewer: value })}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="browser">Browser</SelectItem>
            <SelectItem value="litewrite">Litewrite</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md bg-muted/50 p-4 space-y-3">
        <div>
          <p className="text-sm font-medium">Browser</p>
          <p className="text-xs text-muted-foreground">
            Uses the browser&apos;s native PDF viewer. Simple and stable.
          </p>
        </div>
        <div>
          <p className="text-sm font-medium">Litewrite</p>
          <p className="text-xs text-muted-foreground">
            Custom PDF viewer with SyncTeX support. Double-click on PDF to jump to the corresponding source code location.
          </p>
        </div>
      </div>
    </div>
  );
}

// Appearance settings
function AppearanceSettings({
  settings,
  updateSettings,
}: {
  settings: UserSettings;
  updateSettings: (updates: Partial<UserSettings>) => void;
}) {
  return (
    <div className="space-y-6">
      {/* Language */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Language</Label>
          <p className="text-xs text-muted-foreground">
            Choose your preferred interface language
          </p>
        </div>
        <Select
          value={settings.language || "en"}
          onValueChange={(value) => updateSettings({ language: value })}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="zh">Chinese</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Theme */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Theme</Label>
          <p className="text-xs text-muted-foreground">
            Choose your preferred color theme
          </p>
        </div>
        <Select
          value={settings.theme}
          onValueChange={(value) => updateSettings({ theme: value })}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Font Family */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Font Family</Label>
          <p className="text-xs text-muted-foreground">
            Editor font family
          </p>
        </div>
        <Select
          value={settings.fontFamily || "jetbrains"}
          onValueChange={(value) => updateSettings({ fontFamily: value })}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="jetbrains">JetBrains Mono</SelectItem>
            <SelectItem value="fira">Fira Code</SelectItem>
            <SelectItem value="sf-mono">SF Mono</SelectItem>
            <SelectItem value="consolas">Consolas</SelectItem>
            <SelectItem value="monaco">Monaco</SelectItem>
            <SelectItem value="source-code">Source Code Pro</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Font Size */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Font Size</Label>
          <p className="text-xs text-muted-foreground">
            Editor font size in pixels
          </p>
        </div>
        <Select
          value={String(settings.fontSize)}
          onValueChange={(value) => updateSettings({ fontSize: parseInt(value) })}
        >
          <SelectTrigger className="w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24].map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}px
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// Account settings
function AccountSettings() {
  return (
    <div className="space-y-6">
      <div className="rounded-md border p-4">
        <h3 className="text-sm font-medium mb-2">Account Settings</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Manage your account settings, profile, and preferences.
        </p>
        <Button variant="outline" size="sm" asChild>
          <a href="/settings" target="_blank" rel="noopener noreferrer">
            Go to Account Settings
            <ExternalLink className="ml-2 h-3 w-3" />
          </a>
        </Button>
      </div>

      <div className="rounded-md border p-4">
        <h3 className="text-sm font-medium mb-2">Keyboard Shortcuts</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Save & Compile</span>
            <kbd className="px-2 py-1 bg-muted rounded text-xs">Ctrl+S / ⌘S</kbd>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Bold</span>
            <kbd className="px-2 py-1 bg-muted rounded text-xs">Ctrl+B / ⌘B</kbd>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Italic</span>
            <kbd className="px-2 py-1 bg-muted rounded text-xs">Ctrl+I / ⌘I</kbd>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Underline</span>
            <kbd className="px-2 py-1 bg-muted rounded text-xs">Ctrl+U / ⌘U</kbd>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Search</span>
            <kbd className="px-2 py-1 bg-muted rounded text-xs">Ctrl+F / ⌘F</kbd>
          </div>
        </div>
      </div>
    </div>
  );
}
