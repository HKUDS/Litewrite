"use client";

import { useTheme, themes, type Theme } from "@/lib/theme";
import { useTranslations } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sun, Moon, Monitor, Check } from "lucide-react";
import { cn } from "@/lib/utils";

// Get theme icon.
function getThemeIcon(theme: Theme, className?: string) {
  const iconProps = { className: cn("h-4 w-4", className) };
  switch (theme) {
    case "light":
      return <Sun {...iconProps} />;
    case "dark":
      return <Moon {...iconProps} />;
    case "system":
      return <Monitor {...iconProps} />;
  }
}

interface ThemeSwitcherProps {
  variant?: "icon" | "full";
  className?: string;
}

export function ThemeSwitcher({ variant = "icon", className }: ThemeSwitcherProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { t } = useTranslations("theme");

  // Get the current icon (based on the resolved theme).
  const currentIcon = theme === "system"
    ? getThemeIcon(resolvedTheme)
    : getThemeIcon(theme);

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={variant === "icon" ? "icon" : "sm"}
          className={cn("h-8", variant === "icon" ? "w-8" : "gap-2", className)}
        >
          {currentIcon}
          {variant === "full" && <span>{t(theme)}</span>}
          <span className="sr-only">{t("toggle")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {themes.map((themeOption) => (
          <DropdownMenuItem
            key={themeOption}
            onClick={() => {
              setTheme(themeOption);
            }}
            className="flex items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2">
              {getThemeIcon(themeOption)}
              <span>{t(themeOption)}</span>
            </div>
            {theme === themeOption && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
