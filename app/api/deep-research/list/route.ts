/**
 * Deep Research List API
 *
 * List a user's Deep Research reports.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listUserReports } from "@/lib/deep-research-session";
import { apiError, AUTH_ERRORS, DEEP_RESEARCH_ERRORS } from "@/lib/api-errors";
import { getServerCapabilities } from "@/lib/capabilities";

export async function GET(req: NextRequest) {
  try {
    const caps = getServerCapabilities();
    if (!caps.deepResearchEnabled) {
      return apiError({ code: "feature.disabled", message: caps.deepResearchReason }, 403);
    }

    const session = await auth();
    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");

    if (!projectId) {
      return apiError(DEEP_RESEARCH_ERRORS.PROJECT_ID_REQUIRED, 400);
    }

    const reports = await listUserReports(projectId, session.user.id);

    return NextResponse.json({ reports });
  } catch (error) {
    console.error("[deep-research/list] Error:", error);
    return apiError(DEEP_RESEARCH_ERRORS.LIST_FAILED, 500);
  }
}
