"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslations } from "@/lib/i18n";
import { Loader2, Mail, Lock } from "lucide-react";

interface LoginFormProps {
  callbackUrl?: string;
}

export function LoginForm({ callbackUrl = "/" }: LoginFormProps) {
  const { t } = useTranslations();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Client-side validation
    const email = formData.email.trim();
    const password = formData.password;

    // Email validation
    if (!email) {
      setError(t("auth.emailRequired"));
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError(t("auth.invalidEmail"));
      return;
    }

    // Password validation
    if (!password) {
      setError(t("auth.passwordRequired"));
      return;
    }
    if (password.length < 6) {
      setError(t("auth.passwordTooShort"));
      return;
    }

    setIsLoading(true);

    try {
      // Check user status first
      const checkRes = await fetch("/api/auth/check-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const checkData = await checkRes.json();

      if (!checkRes.ok) {
        if (checkData.error?.code === "auth.tooManyAttempts") {
          const retryAfter = checkData.error?.retryAfter || 60;
          setError(t("auth.tooManyAttempts", { seconds: retryAfter }));
          setIsLoading(false);
          return;
        }
        if (checkData.error?.code === "auth.accountDisabled") {
          setError(t("auth.accountDisabled"));
          setIsLoading(false);
          return;
        }
      }

      // Status OK; continue login
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      // Record login attempt result (for rate limiting)
      try {
        await fetch("/api/auth/record-attempt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ success: !result?.error }),
        });
      } catch {
        // Ignore failures; do not block login flow
      }

      if (result?.error) {
        setError(t("auth.invalidCredentials"));
      } else {
        router.push(callbackUrl);
        router.refresh();
      }
    } catch {
      setError(t("auth.loginError"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg">
          {error}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="email">{t("auth.email")}</Label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="email"
            type="email"
            placeholder="name@example.com"
            className="pl-10"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            required
            disabled={isLoading}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">{t("auth.password")}</Label>
        </div>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            className="pl-10"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            required
            disabled={isLoading}
            minLength={6}
          />
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {t("auth.login")}
      </Button>
    </form>
  );
}
