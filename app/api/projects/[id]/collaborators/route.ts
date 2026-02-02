import { NextRequest, NextResponse } from "next/server";
import { auth, checkProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiError, AUTH_ERRORS, COLLABORATOR_ERRORS, PROJECT_ERRORS } from "@/lib/api-errors";

/**
 * GET /api/projects/[id]/collaborators - Get collaborator list.
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

    // Fetch collaborator list
    const collaborators = await prisma.projectCollaborator.findMany({
      where: { projectId },
      include: {
        user: {
          select: { id: true, name: true, email: true, image: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Fetch project owner info
    const owner = await prisma.user.findUnique({
      where: { id: project.ownerId },
      select: { id: true, name: true, email: true, image: true },
    });

    return NextResponse.json({
      owner,
      collaborators: collaborators.map((c) => ({
        id: c.id,
        user: c.user,
        role: c.role,
        createdAt: c.createdAt.toISOString(),
      })),
      canManage: role === "owner",
    });
  } catch (error) {
    console.error("Error getting collaborators:", error);
    return apiError(COLLABORATOR_ERRORS.LIST_FAILED, 500);
  }
}

/**
 * POST /api/projects/[id]/collaborators - Add collaborator.
 * Body: { email: string, role?: "editor" | "viewer" }
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

    const { hasAccess, role: userRole, project } = await checkProjectAccess(
      projectId,
      session.user.id
    );

    if (!hasAccess || !project) {
      return apiError(PROJECT_ERRORS.NO_ACCESS, 404);
    }

    if (userRole !== "owner") {
      return apiError(COLLABORATOR_ERRORS.OWNER_ONLY_ADD, 403);
    }

    const body = await request.json();
    const { email, role = "editor" } = body;

    if (!email) {
      return apiError(COLLABORATOR_ERRORS.EMAIL_REQUIRED, 400);
    }

    if (!["editor", "viewer"].includes(role)) {
      return apiError(COLLABORATOR_ERRORS.INVALID_ROLE, 400);
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return apiError(COLLABORATOR_ERRORS.USER_NOT_REGISTERED, 404);
    }

    // Cannot add yourself
    if (user.id === session.user.id) {
      return apiError(COLLABORATOR_ERRORS.CANNOT_ADD_SELF, 400);
    }

    // Check whether already a collaborator
    const existing = await prisma.projectCollaborator.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: user.id,
        },
      },
    });

    if (existing) {
      // Update role
      const oldRole = existing.role;
      const updated = await prisma.projectCollaborator.update({
        where: { id: existing.id },
        data: { role },
        include: {
          user: { select: { id: true, name: true, email: true, image: true } },
        },
      });

      return NextResponse.json({
        success: true,
        collaborator: {
          id: updated.id,
          user: updated.user,
          role: updated.role,
          createdAt: updated.createdAt.toISOString(),
        },
      });
    }

    // Add new collaborator
    const collaborator = await prisma.projectCollaborator.create({
      data: {
        projectId,
        userId: user.id,
        role,
      },
      include: {
        user: { select: { id: true, name: true, email: true, image: true } },
      },
    });

    return NextResponse.json({
      success: true,
      collaborator: {
        id: collaborator.id,
        user: collaborator.user,
        role: collaborator.role,
        createdAt: collaborator.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Error adding collaborator:", error);
    return apiError(COLLABORATOR_ERRORS.ADD_FAILED, 500);
  }
}

/**
 * DELETE /api/projects/[id]/collaborators - Remove collaborator.
 * Query: ?userId=xxx
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

    const { hasAccess, role: userRole, project } = await checkProjectAccess(
      projectId,
      session.user.id
    );

    if (!hasAccess || !project) {
      return apiError(PROJECT_ERRORS.NO_ACCESS, 404);
    }

    const { searchParams } = new URL(request.url);
    let userId = searchParams.get("userId");

    if (!userId) {
      return apiError(COLLABORATOR_ERRORS.USER_ID_REQUIRED, 400);
    }

    // If userId is \"me\", replace it with current user ID
    if (userId === "me") {
      userId = session.user.id;
    }

    // Collaborators can remove themselves; owners can remove anyone
    if (userRole !== "owner" && userId !== session.user.id) {
      return apiError(COLLABORATOR_ERRORS.OWNER_ONLY_REMOVE, 403);
    }

    // Delete collaborator
    await prisma.projectCollaborator.deleteMany({
      where: {
        projectId,
        userId,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing collaborator:", error);
    return apiError(COLLABORATOR_ERRORS.REMOVE_FAILED, 500);
  }
}
