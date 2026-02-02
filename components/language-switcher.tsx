"use client";

import { useI18n, locales, localeNames, type Locale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Globe, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface LanguageSwitcherProps {
  variant?: "icon" | "full";
  className?: string;
}

export function LanguageSwitcher({ variant = "icon", className }: LanguageSwitcherProps) {
  const { locale, setLocale } = useI18n();

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={variant === "icon" ? "icon" : "sm"}
          className={cn("h-8", variant === "icon" ? "w-8" : "gap-2", className)}
        >
          <Globe className="h-4 w-4" />
          {variant === "full" && <span>{localeNames[locale]}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map((loc) => (
          <DropdownMenuItem
            key={loc}
            onClick={() => {
              setLocale(loc as Locale);
            }}
            className="flex items-center justify-between"
          >
            <span>{localeNames[loc as Locale]}</span>
            {locale === loc && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
