"use client";

import { useState } from "react";
import { Search, Archive, Trash2, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslations } from "@/lib/i18n";

interface ProjectToolbarProps {
  search: string;
  onSearchChange: (search: string) => void;
  sort: string;
  order: string;
  onSortChange: (sort: string, order: string) => void;
  selectedCount: number;
  onBatchArchive: () => void;
  onBatchTrash: () => void;
  onBatchTag: () => void;
  onClearSelection: () => void;
  currentFilter: string;
}

export function ProjectToolbar({
  search,
  onSearchChange,
  sort,
  order,
  onSortChange,
  selectedCount,
  onBatchArchive,
  onBatchTrash,
  onBatchTag,
  onClearSelection,
  currentFilter,
}: ProjectToolbarProps) {
  const { t } = useTranslations("home.toolbar");
  const [searchInput, setSearchInput] = useState(search);

  // Submit search
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearchChange(searchInput);
  };

  // Clear search
  const handleClearSearch = () => {
    setSearchInput("");
    onSearchChange("");
  };

  // Sort option change
  const handleSortChange = (value: string) => {
    const [newSort, newOrder] = value.split("-");
    onSortChange(newSort, newOrder);
  };

  return (
    <div className="flex items-center justify-between gap-4 mb-4">
      {/* Left: search box */}
      <div className="flex-1 max-w-md">
        <form onSubmit={handleSearchSubmit} className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            type="text"
            placeholder={t("searchPlaceholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-10 pr-10 bg-background/50 border-border/50 focus-visible:bg-background"
          />
          {searchInput && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label="Clear search"
              title="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </form>
      </div>

      {/* Right: sort and batch actions */}
      <div className="flex items-center gap-2">
        {/* Batch actions (shown when projects are selected) */}
        {selectedCount > 0 && (
          <div className="flex items-center gap-2 mr-2 px-3 py-1 bg-emerald-50 dark:bg-emerald-900/20 rounded-md">
            <span className="text-sm text-primary dark:text-primary">
              {t("selected", { count: selectedCount })}
            </span>

            {currentFilter !== "trashed" && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onBatchTag}
                  className="h-7 px-2"
                >
                  <Tag className="h-3.5 w-3.5 mr-1" />
                  {t("tag")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onBatchArchive}
                  className="h-7 px-2"
                >
                  <Archive className="h-3.5 w-3.5 mr-1" />
                  {t("archive")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onBatchTrash}
                  className="h-7 px-2 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  {t("trash")}
                </Button>
              </>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={onClearSelection}
              className="h-7 px-2"
              aria-label="Clear selection"
              title="Clear selection"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {/* Sort dropdown */}
        <Select value={`${sort}-${order}`} onValueChange={handleSortChange}>
          <SelectTrigger className="w-[140px] bg-background/50 border-border/50">
            <SelectValue placeholder={t("sortBy")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updatedAt-desc">{t("sortLastModifiedDesc")}</SelectItem>
            <SelectItem value="updatedAt-asc">{t("sortLastModifiedAsc")}</SelectItem>
            <SelectItem value="name-asc">{t("sortNameAsc")}</SelectItem>
            <SelectItem value="name-desc">{t("sortNameDesc")}</SelectItem>
            <SelectItem value="createdAt-desc">{t("sortCreatedDesc")}</SelectItem>
            <SelectItem value="createdAt-asc">{t("sortCreatedAsc")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
