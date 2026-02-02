/**
 * Deep Research Report API
 *
 * Fetch/delete a single report.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getReportById, deleteReportById } from "@/lib/deep-research-session";
import { apiError, AUTH_ERRORS, DEEP_RESEARCH_ERRORS } from "@/lib/api-errors";
import { getServerCapabilities } from "@/lib/capabilities";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const caps = getServerCapabilities();
    if (!caps.deepResearchEnabled) {
      return apiError({ code: "feature.disabled", message: caps.deepResearchReason }, 403);
    }

    const session = await auth();
    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");

    if (!projectId) {
      return apiError(DEEP_RESEARCH_ERRORS.PROJECT_ID_REQUIRED, 400);
    }

    const report = await getReportById(projectId, session.user.id, id);

    if (!report) {
      return apiError(DEEP_RESEARCH_ERRORS.REPORT_NOT_FOUND, 404);
    }

    return NextResponse.json({ report });
  } catch (error) {
    console.error("[deep-research/get] Error:", error);
    return apiError(DEEP_RESEARCH_ERRORS.GET_FAILED, 500);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const caps = getServerCapabilities();
    if (!caps.deepResearchEnabled) {
      return apiError({ code: "feature.disabled", message: caps.deepResearchReason }, 403);
    }

    const session = await auth();
    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");

    if (!projectId) {
      return apiError(DEEP_RESEARCH_ERRORS.PROJECT_ID_REQUIRED, 400);
    }

    const success = await deleteReportById(projectId, session.user.id, id);

    if (!success) {
      return apiError(DEEP_RESEARCH_ERRORS.DELETE_FAILED, 500);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[deep-research/delete] Error:", error);
    return apiError(DEEP_RESEARCH_ERRORS.DELETE_FAILED, 500);
  }
}
