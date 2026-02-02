import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AUTH_ERRORS, SHARE_ERRORS, apiError, apiSuccess } from "@/lib/api-errors";

/**
 * POST /api/share/[token]/join - Join a project via share link
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    // Find project
    const project = await prisma.project.findUnique({
      where: { shareToken: token },
    });

    if (!project) {
      return apiError(SHARE_ERRORS.INVALID_OR_EXPIRED, 404);
    }

    // Check visibility
    if (project.visibility !== "shared" && project.visibility !== "public") {
      return apiError(SHARE_ERRORS.NOT_SUPPORTED, 403);
    }

    // If user is project owner, return success
    if (project.ownerId === session.user.id) {
      return apiSuccess({
        success: true,
        isOwner: true,
        projectId: project.id,
      });
    }

    // Check whether user is already a collaborator
    const existing = await prisma.projectCollaborator.findUnique({
      where: {
        projectId_userId: {
          projectId: project.id,
          userId: session.user.id,
        },
      },
    });

    if (existing) {
      return apiSuccess({
        success: true,
        alreadyCollaborator: true,
        projectId: project.id,
      });
    }

    // Add as collaborator (default: editor permission)
    await prisma.projectCollaborator.create({
      data: {
        projectId: project.id,
        userId: session.user.id,
        role: "editor",
      },
    });

    return apiSuccess({
      success: true,
      projectId: project.id,
    });
  } catch (error) {
    console.error("Error joining project:", error);
    return apiError(SHARE_ERRORS.JOIN_FAILED, 500);
  }
}
