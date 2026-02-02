"use client";

import Link from "next/link";
import Image from "next/image";
import { useTranslations } from "@/lib/i18n";

export function Footer() {
  const { t } = useTranslations("landing.footer");

  return (
    <footer className="relative border-t bg-muted/20">
      <div className="mx-auto max-w-7xl px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
          {/* Brand */}
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2.5 group">
              <Image
                src="/logo.svg"
                alt="Litewrite"
                width={28}
                height={28}
                className="h-7 w-7 transition-transform group-hover:scale-105"
              />
              <span className="font-semibold text-base text-foreground/90">Litewrite</span>
            </Link>
            <span className="hidden sm:inline text-xs text-muted-foreground/60">|</span>
            <p className="hidden sm:block text-xs text-muted-foreground max-w-xs">
              {t("description")}
            </p>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-border/30 flex items-center justify-center">
          <p className="text-xs text-muted-foreground/60">
            {t("copyright", { year: new Date().getFullYear() })}
          </p>
        </div>
      </div>
    </footer>
  );
}
