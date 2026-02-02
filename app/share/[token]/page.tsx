"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AnimatedLogo } from "@/components/ui/animated-logo";
import { useTranslations } from "@/lib/i18n";
import { getApiErrorMessage } from "@/lib/api-error-handler";
import { FileText, AlertCircle, LogIn } from "lucide-react";

interface SharePageProps {
  params: Promise<{ token: string }>;
}

export default function SharePage({ params }: SharePageProps) {
  const { t } = useTranslations();
  const router = useRouter();
  const { data: session, status } = useSession();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<{
    id: string;
    name: string;
    owner: { name: string; email: string };
  } | null>(null);

  useEffect(() => {
    const loadProject = async () => {
      try {
        const { token } = await params;
        const res = await fetch(`/api/share/${token}`);
        const data = await res.json();

        if (!res.ok) {
          setError(getApiErrorMessage(data, t, "share.invalidLink"));
          return;
        }

        setProject(data.project);

        // If logged in, try to auto-join as collaborator and redirect to the editor
        if (session?.user?.id && data.project?.id) {
          // Auto-join as collaborator
          await fetch(`/api/share/${token}/join`, {
            method: "POST",
          });
          // Redirect to editor
          router.push(`/editor/${data.project.id}`);
        }
      } catch {
        setError(t("share.loadError"));
      } finally {
        setIsLoading(false);
      }
    };

    if (status !== "loading") {
      loadProject();
    }
  }, [params, session, status, router, t]);

  // Loading
  if (isLoading || status === "loading") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
        <AnimatedLogo
          width={360}
          height={189}
          duration={1.5}
          pauseDuration={500}
        />
        <div className="mt-8 flex gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-litewrite-cyan animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-litewrite-cyan animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-litewrite-teal animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4">
        <div className="max-w-md w-full bg-card rounded-xl shadow-lg p-6 text-center">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">{t("share.errorTitle")}</h1>
          <p className="text-muted-foreground mb-6">{error}</p>
          <Link href="/">
            <Button>{t("common.back")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Not logged in
  if (!session && project) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4">
        <div className="max-w-md w-full bg-card rounded-xl shadow-lg p-6">
          {/* Logo */}
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-primary rounded-xl flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-bold">{t("share.inviteTitle")}</h1>
          </div>

          {/* Project info */}
          <div className="bg-muted/50 rounded-lg p-4 mb-6">
            <p className="text-sm text-muted-foreground mb-1">{t("share.projectName")}</p>
            <p className="font-semibold text-lg">{project.name}</p>
            <p className="text-sm text-muted-foreground mt-2">
              {t("share.sharedBy")} {project.owner.name || project.owner.email}
            </p>
          </div>

          {/* Login prompt */}
          <p className="text-center text-muted-foreground mb-4">
            {t("share.loginToAccess")}
          </p>

          {/* Login buttons */}
          <div className="space-y-3">
            <Link href={`/login?callbackUrl=/share/${encodeURIComponent(window.location.pathname.split("/").pop() || "")}`} className="block">
              <Button className="w-full gap-2">
                <LogIn className="h-4 w-4" />
                {t("auth.login")}
              </Button>
            </Link>
            <Link href={`/register?callbackUrl=/share/${encodeURIComponent(window.location.pathname.split("/").pop() || "")}`} className="block">
              <Button variant="outline" className="w-full">
                {t("auth.register")}
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Logged in, redirecting
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <AnimatedLogo
        width={360}
        height={189}
        duration={1.5}
        pauseDuration={500}
      />
      <div className="mt-8 flex gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-litewrite-cyan animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-litewrite-cyan animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-litewrite-teal animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  );
}
