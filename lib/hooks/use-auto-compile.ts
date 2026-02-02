"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslations } from "@/lib/i18n";
import type { CompileStatus, CompileResult, CompileErrorCode } from "@/types";

interface UseCompileOptions {
  projectId: string;
  autoSaveVersion?: boolean; // Auto-save a version after successful compilation
}

interface UseCompileReturn {
  compileStatus: CompileStatus;
  compileResult: CompileResult | null;
  compile: () => Promise<void>;
  lastCompileTime: Date | null;
  compileProgress: number;  // Compile progress percentage (0-100)
  compileStage: string;     // Current compile stage description
}

/**
 * Manual compilation hook.
 *
 * Compilation can be triggered via:
 * 1) Clicking the compile button
 * 2) Pressing Ctrl+S / Cmd+S to save & compile
 *
 * On page load, it checks whether there is a cached compiled PDF.
 *
 * After a successful compile (if autoSaveVersion is true), it automatically saves a history version.
 */
export function useCompile({
  projectId,
  autoSaveVersion = true,
}: UseCompileOptions): UseCompileReturn {
  const { t } = useTranslations("compile");
  const { t: tHistory } = useTranslations("history");
  const [compileStatus, setCompileStatus] = useState<CompileStatus>("idle");
  const [compileResult, setCompileResult] = useState<CompileResult | null>(null);
  const [lastCompileTime, setLastCompileTime] = useState<Date | null>(null);
  const [compileProgress, setCompileProgress] = useState(0);
  const [compileStage, setCompileStage] = useState("");

  const isCompilingRef = useRef(false);
  const hasCheckedCacheRef = useRef(false);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // On page load, check whether there is a cached compiled PDF
  useEffect(() => {
    if (hasCheckedCacheRef.current) return;
    hasCheckedCacheRef.current = true;

    const checkCachedPdf = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/compile/cached`);
        if (response.ok) {
          const data = await response.json();
          if (data.cached && data.pdfUrl) {
            console.log("[Compile] Found cached compiled PDF:", data.pdfUrl);
            setCompileResult({
              success: true,
              pdfUrl: data.pdfUrl,
            });
            setCompileStatus("success");
            if (data.compiledAt) {
              setLastCompileTime(new Date(data.compiledAt));
            }
          }
        }
      } catch (error) {
        console.error("[Compile] Failed to check PDF cache:", error);
      }
    };

    checkCachedPdf();
  }, [projectId]);

  // Clear progress timer
  const clearProgressInterval = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }, []);

  // Simulate compile progress (regular API can't provide real-time progress)
  const startProgressSimulation = useCallback(() => {
    setCompileProgress(0);
    setCompileStage(t("stages.starting"));

    const stages = [
      { progress: 10, stage: t("stages.starting") },
      { progress: 30, stage: t("stages.processing") },
      { progress: 50, stage: t("stages.processing") },
      { progress: 70, stage: t("stages.generatingPdf") },
      { progress: 85, stage: t("stages.generatingPdf") },
    ];

    let stageIndex = 0;
    progressIntervalRef.current = setInterval(() => {
      if (stageIndex < stages.length) {
        setCompileProgress(stages[stageIndex].progress);
        setCompileStage(stages[stageIndex].stage);
        stageIndex++;
      }
    }, 800);
  }, [t]);

  // Run compilation
  const compile = useCallback(async () => {
    if (isCompilingRef.current) {
      console.log("[Compile] Compilation already in progress; skipping");
      return;
    }

    isCompilingRef.current = true;
    setCompileStatus("compiling");
    startProgressSimulation();
    console.log("[Compile] Starting compilation...");

    try {
      // Use project compile API (reads all files from server filesystem, including binaries)
      const response = await fetch(`/api/projects/${projectId}/compile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      // Timeout (504 Gateway Timeout)
      if (response.status === 504) {
        setCompileStatus("error");
        setCompileResult({
          success: false,
          errors: [
            {
              message: t("error.timeout"),
              code: "COMPILE_TIMEOUT" as CompileErrorCode,
              severity: "error",
            },
          ],
        });
        return;
      }

      // Queue full (429 Too Many Requests)
      if (response.status === 429) {
        const errorJson = await response.json().catch(() => ({}));
        const errorCode = errorJson.errorCode || "QUEUE_FULL";
        setCompileStatus("error");
        setCompileResult({
          success: false,
          errors: [
            {
              message: errorCode === "QUEUE_FULL" ? t("error.queueFull") : t("error.serverError", { status: 429 }),
              code: errorCode as CompileErrorCode,
              severity: "error",
            },
          ],
        });
        return;
      }

      // Queue timeout (408 Request Timeout)
      if (response.status === 408) {
        setCompileStatus("error");
        setCompileResult({
          success: false,
          errors: [
            {
              message: t("error.queueTimeout"),
              code: "QUEUE_TIMEOUT" as CompileErrorCode,
              severity: "error",
            },
          ],
        });
        return;
      }

      // Other HTTP errors
      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = t("error.serverError", { status: response.status });
        let errorCode = "SERVER_ERROR";
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error || errorJson.message || errorMessage;
          errorCode = errorJson.errorCode || errorCode;
        } catch {
          // Not JSON; may be an HTML error page
        }
        setCompileStatus("error");
        setCompileResult({
          success: false,
          errors: [
            {
              message: errorMessage,
              code: errorCode as CompileErrorCode,
              severity: "error",
            },
          ],
        });
        return;
      }

      const result = await response.json();

      // Stop progress simulation and set to 100%
      clearProgressInterval();
      setCompileProgress(100);
      setCompileStage(result.success ? t("stages.done") : t("stages.error"));

      setCompileResult(result);
      setCompileStatus(result.success ? "success" : "error");
      setLastCompileTime(new Date());

      console.log("[Compile] Compilation finished:", result.success ? "success" : "failed");
      if (result.parsedLogs) {
        console.log("[Compile] Log stats:", result.logStats);
      }

      // Auto-save version after successful compile
      if (result.success && autoSaveVersion) {
        try {
          const versionResponse = await fetch(`/api/projects/${projectId}/versions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              auto: true,
              autoNamePrefix: tHistory("compileSuccess"),
            }),
          });
          const versionResult = await versionResponse.json();
          if (versionResult.success) {
            if (versionResult.skipped) {
              console.log("[Compile] Auto-save version: no changes; skipped");
            } else {
              console.log("[Compile] Auto-save version succeeded:", versionResult.version?.name);
            }
          }
        } catch (versionError) {
          // Version save failure should not affect compile result
          console.error("[Compile] Auto-save version failed:", versionError);
        }
      }
    } catch (error) {
      console.error("[Compile] Compile error:", error);
      setCompileStatus("error");
      setCompileResult({
        success: false,
        errors: [
          {
            message: error instanceof Error ? error.message : t("error.requestFailed"),
            code: "COMPILE_REQUEST_FAILED" as CompileErrorCode,
            severity: "error",
          },
        ],
      });
    } finally {
      isCompilingRef.current = false;
      clearProgressInterval();
    }
  }, [projectId, autoSaveVersion, startProgressSimulation, clearProgressInterval, t]);

  // Cleanup timer
  useEffect(() => {
    return () => {
      clearProgressInterval();
    };
  }, [clearProgressInterval]);

  return {
    compileStatus,
    compileResult,
    compile,
    lastCompileTime,
    compileProgress,
    compileStage,
  };
}

// Keep legacy function name as an alias for backward compatibility
export const useAutoCompile = useCompile;
