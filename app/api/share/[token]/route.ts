import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { SHARE_ERRORS, apiError, apiSuccess } from "@/lib/api-errors";

/**
 * GET /api/share/[token] - fetch project info via a share link token.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    // Find the project by share token.
    const project = await prisma.project.findUnique({
      where: { shareToken: token },
      include: {
        owner: {
          select: { id: true, name: true, email: true, image: true },
        },
      },
    });

    if (!project) {
      return apiError(SHARE_ERRORS.INVALID_OR_EXPIRED, 404);
    }

    // Check share visibility.
    if (project.visibility !== "shared" && project.visibility !== "public") {
      return apiError(SHARE_ERRORS.NOT_SUPPORTED, 403);
    }

    return apiSuccess({
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        owner: project.owner,
      },
    });
  } catch (error) {
    console.error("Error getting shared project:", error);
    return apiError(SHARE_ERRORS.GET_FAILED, 500);
  }
}
