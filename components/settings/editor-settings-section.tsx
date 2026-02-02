"use client";

import { Code, Settings2, FileText, Palette, History } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslations } from "@/lib/i18n";
import { useUserSettings } from "@/lib/hooks/use-user-settings";

export function EditorSettingsSection() {
  const { t } = useTranslations("userSettings.editorSettings");
  const { t: tSettings } = useTranslations("settings");
  const { settings, updateSettings, isLoading } = useUserSettings();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <div className="space-y-8">
        {/* Editor Settings */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Code className="h-4 w-4" />
            {tSettings("editor")}
          </div>

          <div className="space-y-4 pl-6">
            {/* Auto-complete */}
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">{tSettings("autoComplete")}</Label>
                <p className="text-xs text-muted-foreground">{tSettings("autoCompleteDesc")}</p>
              </div>
              <Switch
                checked={settings.autoComplete}
                onCheckedChange={(checked) => updateSettings({ autoComplete: checked })}
                disabled={isLoading}
              />
            </div>

            {/* Auto-close brackets */}
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">{tSettings("autoCloseBrackets")}</Label>
                <p className="text-xs text-muted-foreground">{tSettings("autoCloseBracketsDesc")}</p>
              </div>
              <Switch
                checked={settings.autoCloseBrackets}
                onCheckedChange={(checked) => updateSettings({ autoCloseBrackets: checked })}
                disabled={isLoading}
              />
            </div>

            {/* Code check */}
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">{tSettings("codeCheck")}</Label>
                <p className="text-xs text-muted-foreground">{tSettings("codeCheckDesc")}</p>
              </div>
              <Switch
                checked={settings.codeCheck}
                onCheckedChange={(checked) => updateSettings({ codeCheck: checked })}
                disabled={isLoading}
              />
            </div>

            {/* Keybindings */}
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">{tSettings("keybindings")}</Label>
                <p className="text-xs text-muted-foreground">{tSettings("keybindingsDesc")}</p>
              </div>
              <Select
                value={settings.keybindings}
                onValueChange={(value) => updateSettings({ keybindings: value })}
                disabled={isLoading}
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="vim">Vim</SelectItem>
                  <SelectItem value="emacs">Emacs</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Spellcheck */}
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">{tSettings("spellcheck")}</Label>
                <p className="text-xs text-muted-foreground">{tSettings("spellcheckDesc")}</p>
              </div>
              <Switch
                checked={settings.spellcheck}
                onCheckedChange={(checked) => updateSettings({ spellcheck: checked })}
                disabled={isLoading}
              />
            </div>
          </div>
        </div>

        {/* Compiler Settings */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Settings2 className="h-4 w-4" />
            {tSettings("compiler")}
          </div>

          <div className="space-y-4 pl-6">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">{tSettings("compilerLabel")}</Label>
                <p className="text-xs text-muted-foreground">{tSettings("compilerDesc")}</p>
              </div>
              <Select
                value={settings.compiler}
                onValueChange={(value) => updateSettings({ compiler: value })}
                disabled={isLoading}
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pdflatex">pdfLaTeX</SelectItem>
                  <SelectItem value="xelatex">XeLaTeX</SelectItem>
                  <SelectItem value="lualatex">LuaLaTeX</SelectItem>
                  <SelectItem value="latex">LaTeX</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Version History Settings */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <History className="h-4 w-4" />
            {tSettings("versionHistory")}
          </div>

          <div className="space-y-4 pl-6">
            {/* Auto-save version */}
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">{tSettings("autoSaveVersion")}</Label>
                <p className="text-xs text-muted-foreground">{tSettings("autoSaveVersionDesc")}</p>
              </div>
              <Switch
                checked={settings.autoSaveVersion}
                onCheckedChange={(checked) => updateSettings({ autoSaveVersion: checked })}
                disabled={isLoading}
              />
            </div>
          </div>
        </div>

        {/* PDF Viewer Settings */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <FileText className="h-4 w-4" />
            {tSettings("pdfViewer")}
          </div>

          <div className="space-y-4 pl-6">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">{tSettings("pdfViewerLabel")}</Label>
                <p className="text-xs text-muted-foreground">{tSettings("pdfViewerDesc")}</p>
              </div>
              <Select
                value={settings.pdfViewer}
                onValueChange={(value) => updateSettings({ pdfViewer: value })}
                disabled={isLoading}
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="browser">Browser</SelectItem>
                  <SelectItem value="litewrite">Litewrite</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Appearance Settings */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Palette className="h-4 w-4" />
            {tSettings("appearance")}
          </div>

          <div className="space-y-4 pl-6">
            {/* Theme */}
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">{tSettings("theme")}</Label>
                <p className="text-xs text-muted-foreground">{tSettings("themeDesc")}</p>
              </div>
              <Select
                value={settings.theme}
                onValueChange={(value) => updateSettings({ theme: value })}
                disabled={isLoading}
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">System</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Font Size */}
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">{tSettings("fontSize")}</Label>
                <p className="text-xs text-muted-foreground">{tSettings("fontSizeDesc")}</p>
              </div>
              <Select
                value={String(settings.fontSize)}
                onValueChange={(value) => updateSettings({ fontSize: parseInt(value) })}
                disabled={isLoading}
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
        </div>
      </div>
    </div>
  );
}
