"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslations } from "@/lib/i18n";
import { Loader2, Mail, Lock, User } from "lucide-react";
import { getApiErrorMessage } from "@/lib/api-error-handler";

interface RegisterFormProps {
  callbackUrl?: string;
}

export function RegisterForm({ callbackUrl = "/" }: RegisterFormProps) {
  const { t } = useTranslations();
  const router = useRouter();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    // Frontend validation (avoid native browser validation UI language)
    const email = formData.email.trim();
    const password = formData.password;
    const confirmPassword = formData.confirmPassword;

    if (!email) {
      setError(t("apiErrors.auth.emailRequired"));
      setIsLoading(false);
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError(t("apiErrors.auth.invalidEmail"));
      setIsLoading(false);
      return;
    }

    if (!password) {
      setError(t("apiErrors.auth.passwordRequired"));
      setIsLoading(false);
      return;
    }
    if (password.length < 6) {
      setError(t("apiErrors.auth.passwordTooShort"));
      setIsLoading(false);
      return;
    }

    if (!confirmPassword) {
      setError(t("apiErrors.auth.confirmPasswordRequired"));
      setIsLoading(false);
      return;
    }

    // Validate that passwords match.
    if (password !== confirmPassword) {
      setError(t("auth.passwordMismatch"));
      setIsLoading(false);
      return;
    }

    try {
      // Register the user.
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          email: email,
          password: formData.password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        const errorMessage = getApiErrorMessage(data, t, "auth.registerError");
        setError(errorMessage);
        return;
      }

      // OSS: no email verification, go to login
      router.push("/login?registered=true");
    } catch {
      setError(t("auth.registerError"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    // Disable native browser validation UI (it uses the user's browser language).
    // We rely on our own validation + translated error messages instead.
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {error && (
        <div className="p-3 text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg">
          {error}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="name">{t("auth.name")}</Label>
        <div className="relative">
          <User className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="name"
            type="text"
            placeholder={t("auth.namePlaceholder")}
            className="pl-10"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            disabled={isLoading}
          />
        </div>
      </div>

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
            disabled={isLoading}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">{t("auth.password")}</Label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            className="pl-10"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            disabled={isLoading}
          />
        </div>
        <p className="text-xs text-muted-foreground">{t("auth.passwordHint")}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmPassword">{t("auth.confirmPassword")}</Label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="confirmPassword"
            type="password"
            placeholder="••••••••"
            className="pl-10"
            value={formData.confirmPassword}
            onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
            disabled={isLoading}
          />
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {t("auth.register")}
      </Button>
    </form>
  );
}
