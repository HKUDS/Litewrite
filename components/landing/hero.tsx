"use client";

import Link from "next/link";
import { LatexTypewriter } from "@/components/ui/latex-typewriter";
import { Button } from "@/components/ui/button";
import { ArrowRight, Play, Sparkles, Users, Zap } from "lucide-react";
import { useTranslations } from "@/lib/i18n";

export function Hero() {
  const { t } = useTranslations("landing.hero");

  const scrollToShowcase = () => {
    const element = document.getElementById("ai-showcase");
    if (element) {
      const navbarHeight = 80; // Navbar height + some spacing
      const elementPosition = element.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({
        top: elementPosition - navbarHeight,
        behavior: "smooth",
      });
    }
  };

  const features = [
    { icon: Sparkles, labelKey: "featureAI", color: "text-ai-purple" },
    { icon: Users, labelKey: "featureCollab", color: "text-litewrite-cyan" },
    { icon: Zap, labelKey: "featurePDF", color: "text-litewrite-warm" },
  ];

  return (
    <section className="relative min-h-[calc(100vh-4rem)] flex items-center justify-center overflow-hidden pt-16 sm:pt-20 md:pt-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center text-center">
          {/* LaTeX-style typewriter title */}
          <div className="animate-fade-in-up min-h-[120px] sm:min-h-[140px] md:min-h-[160px] lg:min-h-[180px] flex items-center justify-center">
            <LatexTypewriter startDelay={300} />
          </div>

          {/* Subtitle */}
          <p className="animate-fade-in-up text-lg md:text-xl text-muted-foreground/80" style={{ animationDelay: "0.5s" }}>
            {t("subtitle")} <span className="italic text-foreground">{t("subtitleHighlight")}</span> {t("subtitleEnd")}
          </p>

          {/* CTA buttons */}
          <div className="animate-fade-in-up mt-12 flex flex-col sm:flex-row gap-4" style={{ animationDelay: "0.4s" }}>
            <div className="relative group">
              {/* Outer glow layer - placed outside the button to avoid being clipped by overflow-hidden */}
              <div className="absolute -inset-1 bg-gradient-to-r from-[#7dd3d8] to-[#4ab0be] dark:from-[#5ec8ce] dark:to-[#3a9ca8] rounded-full blur-lg opacity-50 group-hover:opacity-70 transition-opacity duration-500 pointer-events-none" />
              <Button
                asChild
                variant="gradient"
                size="xl"
                className="rounded-full relative overflow-hidden"
              >
                <Link href="/register">
                  <span className="relative z-10 flex items-center">
                    {t("startWriting")}
                    <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                  </span>
                  {/* Shimmer sweep effect */}
                  <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                </Link>
              </Button>
            </div>
            <Button
              variant="glass"
              size="xl"
              className="rounded-full group"
              onClick={scrollToShowcase}
            >
              <Play className="mr-2 h-4 w-4 transition-transform group-hover:scale-110" />
              {t("seeHowItWorks")}
            </Button>
          </div>

          {/* Feature pills */}
          <div className="animate-fade-in-up mt-16 flex flex-wrap items-center justify-center gap-4" style={{ animationDelay: "0.5s" }}>
            {features.map((feature) => (
              <div
                key={feature.labelKey}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--glass-bg-light)] backdrop-blur-sm border border-[var(--glass-border)] transition-all duration-300 hover:bg-[var(--glass-bg)] hover:shadow-glass hover:-translate-y-0.5"
              >
                <feature.icon className={`h-4 w-4 ${feature.color}`} />
                <span className="text-sm font-medium text-foreground/80">{t(feature.labelKey)}</span>
              </div>
            ))}
          </div>

          {/* Trust badges */}
          <div className="animate-fade-in-up mt-16 flex flex-col items-center gap-4" style={{ animationDelay: "0.6s" }}>
            <p className="text-sm text-muted-foreground">{t("trustedBy")}</p>
            <div className="flex items-center gap-8 opacity-70">
              <div className="flex flex-col items-center">
                <span className="text-2xl font-bold text-foreground">{t("latexMd")}</span>
                <span className="text-xs text-muted-foreground">{t("fullSupport")}</span>
              </div>
              <div className="h-10 w-px bg-border/50" />
              <div className="flex flex-col items-center">
                <span className="text-2xl font-bold text-foreground">{t("templatesCount")}</span>
                <span className="text-xs text-muted-foreground">{t("templates")}</span>
              </div>
              <div className="h-10 w-px bg-border/50" />
              <div className="flex flex-col items-center">
                <span className="text-2xl font-bold text-foreground">{t("unlimited")}</span>
                <span className="text-xs text-muted-foreground">{t("projects")}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
