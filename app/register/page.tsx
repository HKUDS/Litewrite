"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { RegisterForm } from "@/components/auth/register-form";
import { useTranslations } from "@/lib/i18n";
import { GlassCard } from "@/components/ui/glass-card";

export default function RegisterPage() {
  const { t } = useTranslations();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-mesh" />
        <div className="absolute inset-0 bg-grid opacity-30" />

        {/* Animated blobs */}
        <div className="absolute top-1/3 right-1/4 w-[500px] h-[500px] bg-litewrite-teal/15 rounded-full blur-[100px] animate-blob" />
        <div className="absolute bottom-1/3 left-1/4 w-[400px] h-[400px] bg-litewrite-cyan/20 rounded-full blur-[100px] animate-blob" />
        <div className="absolute top-1/2 left-1/3 w-[300px] h-[300px] bg-ai-indigo/10 rounded-full blur-[80px] animate-blob" />
      </div>

      <div className="w-full max-w-md animate-fade-in-up">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-3 group">
            <div className="relative">
              <div className="absolute inset-0 blur-2xl bg-gradient-to-r from-litewrite-cyan/30 to-litewrite-teal/30 opacity-0 group-hover:opacity-100 transition-opacity duration-500 scale-150" />
              <Image src="/logo.svg" alt="Litewrite" width={56} height={56} className="relative h-14 w-14" />
            </div>
            <span className="text-3xl font-bold text-gradient">Litewrite</span>
          </Link>
          <p className="mt-3 text-muted-foreground">{t("auth.registerSubtitle")}</p>
        </div>

        {/* Register card */}
        <GlassCard variant="heavy" padding="lg" className="space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-semibold">{t("auth.createAccount")}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("auth.registerDescription")}
            </p>
          </div>

          {/* Email/password registration */}
          <RegisterForm callbackUrl={callbackUrl} />

          {/* Login link */}
          <div className="text-center text-sm">
            <span className="text-muted-foreground">{t("auth.haveAccount")} </span>
            <Link
              href={callbackUrl !== "/" ? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/login"}
              className="text-gradient font-medium hover:opacity-80 transition-opacity"
            >
              {t("auth.loginNow")}
            </Link>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
