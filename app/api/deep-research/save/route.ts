/**
 * Deep Research Save API
 *
 * Save/update a Deep Research report.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { saveReport } from "@/lib/deep-research-session";
import type { DeepResearchProcessStep } from "@/types/ask";
import { apiError, AUTH_ERRORS, DEEP_RESEARCH_ERRORS } from "@/lib/api-errors";
import { getServerCapabilities } from "@/lib/capabilities";

interface SaveRequest {
  projectId: string;
  query: string;
  report: string;
  bibtex: string;
  references: string;
  processSteps?: DeepResearchProcessStep[];
  reportId?: string;  // Used to update an existing report
}

export async function POST(req: NextRequest) {
  try {
    const caps = getServerCapabilities();
    if (!caps.deepResearchEnabled) {
      return apiError({ code: "feature.disabled", message: caps.deepResearchReason }, 403);
    }

    const session = await auth();
    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const body: SaveRequest = await req.json();
    const { projectId, query, report, bibtex, references, processSteps, reportId } = body;

    if (!projectId) {
      return apiError(DEEP_RESEARCH_ERRORS.PROJECT_ID_REQUIRED, 400);
    }
    if (!query) {
      return apiError(DEEP_RESEARCH_ERRORS.QUERY_REQUIRED, 400);
    }

    const savedReport = await saveReport(
      projectId,
      session.user.id,
      query,
      report || "",
      bibtex || "",
      references || "",
      processSteps,
      reportId
    );

    return NextResponse.json({ success: true, report: savedReport });
  } catch (error) {
    console.error("[deep-research/save] Error:", error);
    return apiError(DEEP_RESEARCH_ERRORS.SAVE_FAILED, 500);
  }
}
