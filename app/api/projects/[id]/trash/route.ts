import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths } from "@/lib/storage";
import { apiError, AUTH_ERRORS, GENERAL_ERRORS, PROJECT_ERRORS } from "@/lib/api-errors";

/**
 * POST /api/projects/[id]/trash - Move project to trash.
 * - Must be the project owner
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

    // Check project exists and user is the owner
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true, status: true },
    });

    if (!project) {
      return apiError(PROJECT_ERRORS.NOT_FOUND, 404);
    }

    if (project.ownerId !== session.user.id) {
      return apiError(PROJECT_ERRORS.OWNER_ONLY_DELETE, 403);
    }

    // A project already in trash cannot be trashed again
    if (project.status === "trashed") {
      return apiError(PROJECT_ERRORS.ALREADY_IN_TRASH, 400);
    }

    // Move to trash
    await prisma.project.update({
      where: { id: projectId },
      data: {
        status: "trashed",
        trashedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("Error trashing project:", error);
    return apiError(GENERAL_ERRORS.OPERATION_FAILED, 500);
  }
}

/**
 * PATCH /api/projects/[id]/trash - Restore project from trash.
 * - Must be the project owner
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const { id: projectId } = await params;

    // Check project exists and user is the owner
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true, status: true },
    });

    if (!project) {
      return apiError(PROJECT_ERRORS.NOT_FOUND, 404);
    }

    if (project.ownerId !== session.user.id) {
      return apiError(PROJECT_ERRORS.OWNER_ONLY_RESTORE, 403);
    }

    // Only trashed projects can be restored
    if (project.status !== "trashed") {
      return apiError(PROJECT_ERRORS.NOT_IN_TRASH, 400);
    }

    // Restore project
    await prisma.project.update({
      where: { id: projectId },
      data: {
        status: "active",
        trashedAt: null,
      },
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("Error restoring project:", error);
    return apiError(GENERAL_ERRORS.OPERATION_FAILED, 500);
  }
}

/**
 * DELETE /api/projects/[id]/trash - Permanently delete project.
 * - Must be the project owner
 * - Only trashed projects can be deleted
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const { id: projectId } = await params;

    // Check project exists and user is the owner
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true, status: true },
    });

    if (!project) {
      return apiError(PROJECT_ERRORS.NOT_FOUND, 404);
    }

    if (project.ownerId !== session.user.id) {
      return apiError(PROJECT_ERRORS.OWNER_ONLY_PERMANENT_DELETE, 403);
    }

    // Only trashed projects can be permanently deleted
    if (project.status !== "trashed") {
      return apiError(PROJECT_ERRORS.ONLY_TRASH_CAN_DELETE, 400);
    }

    // Get storage instance
    const storage = await getStorage();

    // Delete files from storage
    try {
      // Delete project files
      await storage.deletePrefix(StoragePaths.projectPrefix(projectId));
      // Delete compiled artifacts
      await storage.deletePrefix(StoragePaths.compiledPrefix(projectId));
      // Delete version snapshots
      await storage.deletePrefix(StoragePaths.versionsPrefix(projectId));
      // Delete Litewrite metadata (sessions, edits, shadow docs, deep-research)
      await storage.deletePrefix(StoragePaths.litewritePrefix(projectId));
    } catch (storageError) {
      console.warn("Warning: Could not delete project storage:", storageError);
    }

    // Delete database record
    await prisma.project.delete({
      where: { id: projectId },
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("Error permanently deleting project:", error);
    return apiError(GENERAL_ERRORS.OPERATION_FAILED, 500);
  }
}
