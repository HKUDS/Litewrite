import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiError, AUTH_ERRORS, GENERAL_ERRORS, PROJECT_ERRORS } from "@/lib/api-errors";

/**
 * POST /api/projects/[id]/archive - Archive/unarchive a project
 * - Requires project owner
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const { id: projectId } = await params;

    // Check whether the project exists and the user is the owner
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true, status: true },
    });

    if (!project) {
      return apiError(PROJECT_ERRORS.NOT_FOUND, 404);
    }

    if (project.ownerId !== session.user.id) {
      return apiError(PROJECT_ERRORS.OWNER_ONLY_ARCHIVE, 403);
    }

    // Projects in trash cannot be archived directly
    if (project.status === "trashed") {
      return apiError(PROJECT_ERRORS.RESTORE_FIRST, 400);
    }

    // Toggle archive status
    const newStatus = project.status === "archived" ? "active" : "archived";

    await prisma.project.update({
      where: { id: projectId },
      data: { status: newStatus },
    });

    return NextResponse.json({
      success: true,
      status: newStatus,
    });
  } catch (error) {
    console.error("Error archiving project:", error);
    return apiError(GENERAL_ERRORS.OPERATION_FAILED, 500);
  }
}
