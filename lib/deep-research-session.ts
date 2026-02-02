/**
 * Deep Research Session Manager
 * =============================
 *
 * Manages Deep Research reports separately from Ask/Agent sessions.
 * Each report is a one-time run result, not a chat session.
 *
 * Storage structure (S3/Local Storage):
 *   litewrite/{projectId}/deep-research/{userId}/{reportId}.json
 */

import { getStorage } from "@/lib/storage";
import type { DeepResearchReport, DeepResearchReportSummary, DeepResearchProcessStep } from "@/types/ask";

// ============================================================================
// Storage Paths
// ============================================================================

/**
 * Get the S3 key for a report file
 */
function getReportKey(projectId: string, userId: string, reportId: string): string {
  return `litewrite/${projectId}/deep-research/${userId}/${reportId}.json`;
}

/**
 * Get the S3 key prefix for listing user reports
 */
function getUserReportPrefix(projectId: string, userId: string): string {
  return `litewrite/${projectId}/deep-research/${userId}/`;
}

// ============================================================================
// Report ID Generation
// ============================================================================

/**
 * Generate unique report ID
 */
export function generateReportId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `dr_${timestamp}_${random}`;
}

// ============================================================================
// Report CRUD
// ============================================================================

/**
 * Save or update a Deep Research report
 * If reportId is provided, updates existing report; otherwise creates new one
 */
export async function saveReport(
  projectId: string,
  userId: string,
  query: string,
  report: string,
  bibtex: string,
  references: string,
  processSteps?: DeepResearchProcessStep[],
  reportId?: string  // Optional: used to update an existing report
): Promise<DeepResearchReport> {
  const storage = await getStorage();
  const isUpdate = !!reportId;
  const finalReportId = reportId || generateReportId();
  const key = getReportKey(projectId, userId, finalReportId);

  // If updating, try to reuse the original createdAt.
  let createdAt = Date.now();
  if (isUpdate) {
    try {
      const existingBuffer = await storage.download(key);
      const existing = JSON.parse(existingBuffer.toString("utf-8")) as DeepResearchReport;
      createdAt = existing.createdAt;
    } catch {
      // File does not exist; use a new createdAt.
    }
  }

  const reportData: DeepResearchReport = {
    id: finalReportId,
    projectId,
    userId,
    query,
    report,
    bibtex,
    references,
    processSteps: processSteps?.map(step => ({
      ...step,
      timestamp: step.timestamp instanceof Date ? step.timestamp.toISOString() : step.timestamp,
    })),
    createdAt,
  };

  await storage.upload(key, JSON.stringify(reportData, null, 2), "application/json");

  return reportData;
}

/**
 * Get report by ID
 */
export async function getReportById(
  projectId: string,
  userId: string,
  reportId: string
): Promise<DeepResearchReport | null> {
  try {
    const storage = await getStorage();
    const key = getReportKey(projectId, userId, reportId);
    const buffer = await storage.download(key);
    const content = buffer.toString("utf-8");
    const report = JSON.parse(content) as DeepResearchReport;

    // Verify ownership
    if (report.userId !== userId) {
      console.error(`[getReportById] Ownership mismatch`);
      return null;
    }

    return report;
  } catch (error) {
    console.error(`[getReportById] Failed to load report:`, error);
    return null;
  }
}

/**
 * Delete report by ID
 */
export async function deleteReportById(
  projectId: string,
  userId: string,
  reportId: string
): Promise<boolean> {
  try {
    const storage = await getStorage();
    const key = getReportKey(projectId, userId, reportId);
    await storage.delete(key);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Report Listing
// ============================================================================

/**
 * List all reports for a user in a project
 * Returns summaries sorted by createdAt (newest first)
 */
export async function listUserReports(
  projectId: string,
  userId: string
): Promise<DeepResearchReportSummary[]> {
  const reports: DeepResearchReportSummary[] = [];

  try {
    const storage = await getStorage();
    const prefix = getUserReportPrefix(projectId, userId);
    console.log("[listUserReports] Listing with prefix:", prefix);

    const files = await storage.list(prefix);
    console.log("[listUserReports] Found files:", files.length, files.map(f => f.key));

    for (const file of files) {
      if (!file.key.endsWith(".json")) continue;

      try {
        const buffer = await storage.download(file.key);
        const content = buffer.toString("utf-8");
        const report = JSON.parse(content) as DeepResearchReport;

        reports.push({
          id: report.id,
          query: report.query,
          // Truncate query for display
          queryPreview: report.query.length > 50
            ? report.query.substring(0, 50) + "..."
            : report.query,
          createdAt: report.createdAt,
        });
        console.log("[listUserReports] Loaded report:", report.id);
      } catch (e) {
        console.error("[listUserReports] Failed to load file:", file.key, e);
      }
    }

    // Sort by createdAt descending (newest first)
    reports.sort((a, b) => b.createdAt - a.createdAt);
  } catch (e) {
    console.error("[listUserReports] Error listing reports:", e);
  }

  console.log("[listUserReports] Returning", reports.length, "reports");
  return reports;
}

// ============================================================================
// Export
// ============================================================================

const deepResearchManager = {
  generateReportId,
  saveReport,
  getReportById,
  deleteReportById,
  listUserReports,
};

export default deepResearchManager;
