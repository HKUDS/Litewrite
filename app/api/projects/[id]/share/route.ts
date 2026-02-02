import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { auth, checkProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiError, AUTH_ERRORS, PROJECT_ERRORS, SHARE_ERRORS } from "@/lib/api-errors";

/**
 * POST /api/projects/[id]/share - Generate or refresh a share link
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    // Check permission (only the owner can generate a share link)
    const { hasAccess, role } = await checkProjectAccess(projectId, session.user.id);

    if (!hasAccess) {
      return apiError(PROJECT_ERRORS.NO_ACCESS, 404);
    }

    if (role !== "owner") {
      return apiError(SHARE_ERRORS.OWNER_ONLY_GENERATE, 403);
    }

    // Generate a new share token
    const shareToken = uuidv4();

    // Update project
    const project = await prisma.project.update({
      where: { id: projectId },
      data: {
        shareToken,
        visibility: "shared",
      },
    });

    // Build share URL
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const shareUrl = `${baseUrl}/share/${shareToken}`;

    return NextResponse.json({
      success: true,
      shareToken,
      shareUrl,
    });
  } catch (error) {
    console.error("Error generating share link:", error);
    return apiError(SHARE_ERRORS.GENERATE_FAILED, 500);
  }
}

/**
 * GET /api/projects/[id]/share - Get share info
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const { hasAccess, role, project } = await checkProjectAccess(
      projectId,
      session.user.id
    );

    if (!hasAccess || !project) {
      return apiError(PROJECT_ERRORS.NO_ACCESS, 404);
    }

    if (role !== "owner") {
      return apiError(SHARE_ERRORS.OWNER_ONLY_VIEW, 403);
    }

    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const shareUrl = project.shareToken
      ? `${baseUrl}/share/${project.shareToken}`
      : null;

    return NextResponse.json({
      visibility: project.visibility,
      shareToken: project.shareToken,
      shareUrl,
    });
  } catch (error) {
    console.error("Error getting share info:", error);
    return apiError(SHARE_ERRORS.GET_FAILED, 500);
  }
}

/**
 * DELETE /api/projects/[id]/share - Cancel share link
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const { hasAccess, role } = await checkProjectAccess(projectId, session.user.id);

    if (!hasAccess) {
      return apiError(PROJECT_ERRORS.NO_ACCESS, 404);
    }

    if (role !== "owner") {
      return apiError(SHARE_ERRORS.OWNER_ONLY_CANCEL, 403);
    }

    // Clear share token and set to private
    await prisma.project.update({
      where: { id: projectId },
      data: {
        shareToken: null,
        visibility: "private",
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error canceling share:", error);
    return apiError(SHARE_ERRORS.CANCEL_FAILED, 500);
  }
}
