"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSession } from "next-auth/react";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useTranslations } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function Navbar() {
  const { data: session } = useSession();
  const { t } = useTranslations("landing.nav");
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { href: "#ai-showcase", label: t("aiFeatures") },
    { href: "/templates", label: t("templates") },
    { href: "/docs", label: t("docs") },
  ];

  return (
    <nav
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-500",
        scrolled
          ? "bg-[var(--glass-bg)] backdrop-blur-xl border-b border-[var(--glass-border)] shadow-glass"
          : "bg-transparent border-b border-transparent"
      )}
    >
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link
            href="/"
            className="flex items-center gap-3 group"
          >
            <div className="relative">
              {/* Logo glow effect */}
              <div
                className={cn(
                  "absolute inset-0 blur-xl rounded-full transition-opacity duration-500",
                  "bg-gradient-to-r from-litewrite-cyan/40 to-litewrite-teal/40",
                  scrolled ? "opacity-0" : "opacity-100 animate-breathe"
                )}
              />
              <Image
                src="/logo.svg"
                alt="Litewrite"
                width={48}
                height={48}
                className="relative h-12 w-12 transition-transform duration-300 group-hover:scale-105"
              />
            </div>
            <span className="font-semibold text-2xl tracking-tight bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text">
              Litewrite
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-full transition-all duration-200",
                  "text-muted-foreground hover:text-foreground",
                  "hover:bg-[var(--glass-bg-light)]"
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1">
              <ThemeSwitcher />
              <LanguageSwitcher />
            </div>

            {session ? (
              <Button
                asChild
                variant="gradient"
                size="sm"
                className="rounded-full px-6 shadow-glow"
              >
                <Link href="/dashboard">{t("dashboard")}</Link>
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="hidden sm:inline-flex rounded-full"
                >
                  <Link href="/login">{t("login")}</Link>
                </Button>
                <div className="relative group">
                  {/* Outer glow layer - placed outside the button to avoid being clipped by overflow-hidden */}
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-[#7dd3d8] to-[#4ab0be] dark:from-[#5ec8ce] dark:to-[#3a9ca8] rounded-full blur opacity-45 group-hover:opacity-60 transition-opacity duration-500 pointer-events-none" />
                  <Button
                    asChild
                    variant="gradient"
                    size="sm"
                    className="rounded-full px-6 relative overflow-hidden"
                  >
                    <Link href="/register">
                      <span className="relative z-10">{t("getStarted")}</span>
                      {/* Shimmer effect */}
                      <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
                    </Link>
                  </Button>
                </div>
              </div>
            )}

            {/* Mobile Menu Button */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-[var(--glass-bg-heavy)] backdrop-blur-xl border-b border-[var(--glass-border)] animate-fade-in-down">
          <div className="px-6 py-4 space-y-2">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="block px-4 py-3 text-sm font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-[var(--glass-bg-light)] transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <div className="flex items-center gap-2 pt-2 border-t border-border/50">
              <ThemeSwitcher />
              <LanguageSwitcher />
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
