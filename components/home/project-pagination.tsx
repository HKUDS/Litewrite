"use client";

import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useTranslations } from "@/lib/i18n";

interface ProjectPaginationProps {
  total: number;
  loaded: number;
  isLoading: boolean;
  onLoadMore: () => void;
}

export function ProjectPagination({
  total,
  loaded,
  isLoading,
  onLoadMore,
}: ProjectPaginationProps) {
  const { t } = useTranslations("home.pagination");

  const remaining = total - loaded;
  const hasMore = remaining > 0;

  if (total === 0) {
    return null;
  }

  return (
    <div className="flex flex-col items-center gap-2 py-6">
      {hasMore && (
        <Button
          variant="outline"
          onClick={onLoadMore}
          disabled={isLoading}
          className="min-w-[200px]"
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("loading")}
            </>
          ) : (
            t("showMore", { count: Math.min(remaining, 20) })
          )}
        </Button>
      )}

      <p className="text-sm text-gray-500 dark:text-gray-400">
        {t("showing", { loaded, total })}
      </p>
    </div>
  );
}
