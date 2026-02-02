"use client";

import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslations } from "@/lib/i18n";
import { LogOut, Settings, Loader2 } from "lucide-react";
import { getUserColorById } from "@/lib/utils";

export function UserMenu() {
  const { t } = useTranslations();
  const { data: session, status } = useSession();

  // Loading
  if (status === "loading") {
    return (
      <Button variant="ghost" size="icon" disabled>
        <Loader2 className="h-5 w-5 animate-spin" />
      </Button>
    );
  }

  // Not logged in
  if (!session) {
    return (
      <div className="flex items-center gap-2">
        <Link href="/login">
          <Button variant="ghost" size="sm">
            {t("auth.login")}
          </Button>
        </Link>
        <Link href="/register">
          <Button size="sm">
            {t("auth.register")}
          </Button>
        </Link>
      </div>
    );
  }

  // Get stable color by user ID (consistent with collaborator avatar colors)
  const userColor = session.user.id ? getUserColorById(session.user.id) : "#6366f1";

  // Logged in
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          {session.user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={session.user.image}
              alt={session.user.name || "User"}
              className="h-8 w-8 rounded-full"
            />
          ) : (
            <div
              className="h-8 w-8 rounded-full flex items-center justify-center text-white font-medium"
              style={{ backgroundColor: userColor }}
            >
              {(session.user.name?.[0] || session.user.email?.[0] || "U").toUpperCase()}
            </div>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium">{session.user.name || t("common.user")}</p>
          <p className="text-xs text-muted-foreground truncate">
            {session.user.email}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings" className="flex items-center">
            <Settings className="mr-2 h-4 w-4" />
            {t("editor.settings")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            signOut({ callbackUrl: "/" });
          }}
          className="text-red-600 dark:text-red-400"
        >
          <LogOut className="mr-2 h-4 w-4" />
          {t("auth.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
