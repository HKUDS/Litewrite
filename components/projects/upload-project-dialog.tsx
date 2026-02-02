"use client";

import { useState, useRef, useCallback } from "react";
import { Loader2, Upload, FileArchive, X, Github, FileText, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslations } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface UploadProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

// Supported file types
const SUPPORTED_EXTENSIONS = [".zip", ".tar.gz", ".tgz", ".tar", ".tex", ".bib"];

export function UploadProjectDialog({
  open,
  onOpenChange,
  onSuccess,
}: UploadProjectDialogProps) {
  const { t } = useTranslations("project.upload");
  const { t: tCommon } = useTranslations("common");
  const { t: tErrors } = useTranslations("errors");
  const { t: tApiErrors } = useTranslations("apiErrors");

  const [activeTab, setActiveTab] = useState("file");
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // GitHub/GitLab import
  const [gitUrl, setGitUrl] = useState("");

  // arXiv import
  const [arxivId, setArxivId] = useState("");

  // Check whether a file type is supported
  const isValidFileType = (fileName: string): boolean => {
    const lowerName = fileName.toLowerCase();
    return SUPPORTED_EXTENSIONS.some(ext => lowerName.endsWith(ext));
  };

  // Handle file selection
  const handleFileChange = useCallback((selectedFiles: FileList | null) => {
    if (!selectedFiles || selectedFiles.length === 0) return;

    const validFiles: File[] = [];
    const invalidFiles: string[] = [];

    Array.from(selectedFiles).forEach(file => {
      if (isValidFileType(file.name)) {
        validFiles.push(file);
      } else {
        invalidFiles.push(file.name);
      }
    });

    if (invalidFiles.length > 0) {
      setError(t("invalidFileTypes", { files: invalidFiles.join(", ") }));
    } else {
      setError("");
    }

    if (validFiles.length > 0) {
      setFiles(validFiles);
      // If project name is empty, use the first file name
      if (!name.trim()) {
        const firstFile = validFiles[0];
        let projectName = firstFile.name;
        // Strip extension
        SUPPORTED_EXTENSIONS.forEach(ext => {
          if (projectName.toLowerCase().endsWith(ext)) {
            projectName = projectName.slice(0, -ext.length);
          }
        });
        setName(projectName);
      }
    }
  }, [name, t]);

  // Drag-and-drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileChange(e.dataTransfer.files);
  }, [handleFileChange]);

  // Handle file upload
  const handleFileUpload = async () => {
    if (files.length === 0) {
      setError(t("selectFile"));
      return;
    }

    setIsUploading(true);
    setError("");

    try {
      const formData = new FormData();

      // Single file or multiple files
      if (files.length === 1) {
        formData.append("file", files[0]);
      } else {
        files.forEach(file => {
          formData.append("files", file);
        });
      }

      if (name.trim()) {
        formData.append("name", name.trim());
      }
      if (description.trim()) {
        formData.append("description", description.trim());
      }

      const response = await fetch("/api/projects/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || tErrors("uploadProjectFailed"));
      }

      handleReset();
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : tErrors("uploadProjectFailed"));
    } finally {
      setIsUploading(false);
    }
  };

  // Handle GitHub import
  const handleGitHubImport = async () => {
    if (!gitUrl.trim()) {
      setError(t("github.urlRequired"));
      return;
    }

    setIsUploading(true);
    setError("");

    try {
      const response = await fetch("/api/projects/import/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: gitUrl.trim(),
          name: name.trim() || undefined,
          description: description.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Handle error code returned by API
        const errorCode = data.error?.code;
        if (errorCode) {
          // Translate the error code via apiErrors namespace
          setError(tApiErrors(errorCode));
        } else {
          setError(data.error?.message || t("github.importFailed"));
        }
        return;
      }

      handleReset();
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("github.importFailed"));
    } finally {
      setIsUploading(false);
    }
  };

  // Handle arXiv import
  const handleArxivImport = async () => {
    if (!arxivId.trim()) {
      setError(t("arxiv.idRequired"));
      return;
    }

    setIsUploading(true);
    setError("");

    try {
      const response = await fetch("/api/projects/import/arxiv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          arxivId: arxivId.trim(),
          name: name.trim() || undefined,
          description: description.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Handle error code returned by API
        const errorCode = data.error?.code;
        if (errorCode) {
          // Translate the error code via apiErrors namespace
          setError(tApiErrors(errorCode));
        } else {
          setError(data.error?.message || t("arxiv.importFailed"));
        }
        return;
      }

      handleReset();
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("arxiv.importFailed"));
    } finally {
      setIsUploading(false);
    }
  };

  // Handle submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    switch (activeTab) {
      case "file":
        await handleFileUpload();
        break;
      case "github":
        await handleGitHubImport();
        break;
      case "arxiv":
        await handleArxivImport();
        break;
    }
  };

  // Reset form
  const handleReset = () => {
    setFiles([]);
    setName("");
    setDescription("");
    setError("");
    setGitUrl("");
    setArxivId("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      handleReset();
    }
    onOpenChange(open);
  };

  // Remove a selected file
  const handleRemoveFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1024 / 1024).toFixed(2) + " MB";
  };

  // Check whether submit is allowed
  const canSubmit = () => {
    if (isUploading) return false;
    switch (activeTab) {
      case "file":
        return files.length > 0;
      case "github":
        return gitUrl.trim().length > 0;
      case "arxiv":
        return arxivId.trim().length > 0;
      default:
        return false;
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="file" className="gap-2">
                <Upload className="h-4 w-4" />
                {t("tabs.file")}
              </TabsTrigger>
              <TabsTrigger value="github" className="gap-2">
                <Github className="h-4 w-4" />
                {t("tabs.github")}
              </TabsTrigger>
              <TabsTrigger value="arxiv" className="gap-2">
                <FileText className="h-4 w-4" />
                {t("tabs.arxiv")}
              </TabsTrigger>
            </TabsList>

            {/* File upload */}
            <TabsContent value="file" className="mt-4 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {t("fileLabel")} <span className="text-destructive">*</span>
                </label>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept={SUPPORTED_EXTENSIONS.join(",")}
                  multiple
                  className="hidden"
                  aria-label={t("fileLabel")}
                  onChange={(e) => handleFileChange(e.target.files)}
                />

                {files.length > 0 ? (
                  // Selected file list
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {files.map((file, index) => (
                      <div key={index} className="flex items-center gap-3 p-2 border rounded-lg bg-muted/50">
                        <FileArchive className="h-6 w-6 text-primary flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{file.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(file.size)}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 flex-shrink-0"
                          onClick={() => handleRemoveFile(index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {t("addMoreFiles")}
                    </Button>
                  </div>
                ) : (
                  // Drag-and-drop area
                  <div
                    className={cn(
                      "flex flex-col items-center justify-center gap-2 p-8 border-2 border-dashed rounded-lg cursor-pointer transition-colors",
                      isDragging
                        ? "border-primary bg-primary/5"
                        : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50"
                    )}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <Upload className="h-10 w-10 text-muted-foreground" />
                    <div className="text-center">
                      <p className="text-sm font-medium">{t("dropzone.title")}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("dropzone.hint")}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Overleaf import hint */}
              <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg">
                <p className="font-medium mb-1">{t("overleafHint.title")}</p>
                <ol className="list-decimal list-inside space-y-0.5">
                  <li>{t("overleafHint.step1")}</li>
                  <li>{t("overleafHint.step2")}</li>
                  <li>{t("overleafHint.step3")}</li>
                </ol>
              </div>
            </TabsContent>

            {/* GitHub import */}
            <TabsContent value="github" className="mt-4 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {t("github.urlLabel")} <span className="text-destructive">*</span>
                </label>
                <Input
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                  placeholder={t("github.urlPlaceholder")}
                  disabled={isUploading}
                />
                <p className="text-xs text-muted-foreground">
                  {t("github.urlHint")}
                </p>
              </div>

              <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg">
                <p className="font-medium mb-1">{t("github.supportedFormats")}</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>https://github.com/user/repo</li>
                  <li>https://github.com/user/repo/tree/branch</li>
                  <li>https://gitlab.com/user/repo</li>
                </ul>
                <p className="mt-2 text-amber-600 dark:text-amber-400">
                  {t("github.publicOnly")}
                </p>
              </div>
            </TabsContent>

            {/* arXiv import */}
            <TabsContent value="arxiv" className="mt-4 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {t("arxiv.idLabel")} <span className="text-destructive">*</span>
                </label>
                <Input
                  value={arxivId}
                  onChange={(e) => setArxivId(e.target.value)}
                  placeholder={t("arxiv.idPlaceholder")}
                  disabled={isUploading}
                />
                <p className="text-xs text-muted-foreground">
                  {t("arxiv.idHint")}
                </p>
              </div>

              <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg">
                <p className="font-medium mb-1">{t("arxiv.supportedFormats")}</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>2410.05779</li>
                  <li>https://arxiv.org/abs/2410.05779</li>
                </ul>
                <p className="mt-2 text-amber-600 dark:text-amber-400">
                  {t("arxiv.sourceNote")}
                </p>
              </div>
            </TabsContent>
          </Tabs>

          {/* Shared fields: project name and description */}
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium">
                {t("nameLabel")}
              </label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("namePlaceholder")}
                disabled={isUploading}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="description" className="text-sm font-medium">
                {t("descriptionLabel")}
              </label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("descriptionPlaceholder")}
                disabled={isUploading}
              />
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isUploading}
            >
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit()}>
              {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {activeTab === "file" && t("submit")}
              {activeTab === "github" && t("github.import")}
              {activeTab === "arxiv" && t("arxiv.import")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
