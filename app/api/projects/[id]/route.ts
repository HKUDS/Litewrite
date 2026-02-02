import { NextRequest, NextResponse } from "next/server";
import { auth, checkProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths } from "@/lib/storage";
import { merkleService } from "@/lib/storage/merkle";
import { VALID_COMPILERS, Compiler } from "@/lib/compiler-utils";
import type { ProjectMeta } from "@/types";
import { apiError, AUTH_ERRORS, GENERAL_ERRORS, PROJECT_ERRORS } from "@/lib/api-errors";

// Write project metadata to storage (optional backup)
async function writeProjectMeta(projectId: string, meta: ProjectMeta): Promise<void> {
  try {
    const storage = await getStorage();
    const metaKey = StoragePaths.projectFile(projectId, "project.json");
    await storage.upload(metaKey, JSON.stringify(meta, null, 2), "application/json");
  } catch {
    // If writing fails, ignore silently (DB is the source of truth)
    console.log(`Note: Could not write project.json for ${projectId} (S3 backup)`);
  }
}

/**
 * GET /api/projects/[id] - Get a single project's info.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const session = await auth();

    // Check access
    const { hasAccess, role, project } = await checkProjectAccess(
      projectId,
      session?.user?.id || null
    );

    if (!hasAccess || !project) {
      return apiError(PROJECT_ERRORS.NO_ACCESS, 404);
    }

    // Fetch project details
    const projectWithDetails = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        owner: { select: { id: true, name: true, email: true, image: true } },
        collaborators: {
          include: {
            user: { select: { id: true, name: true, email: true, image: true } },
          },
        },
      },
    });

    return NextResponse.json({
      project: {
        ...projectWithDetails,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      },
      role,
    });
  } catch (error) {
    console.error("Error getting project:", error);
    return apiError(PROJECT_ERRORS.INFO_FAILED, 500);
  }
}

/**
 * PATCH /api/projects/[id] - Update project info.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    // Check access (only owner can update project info)
    const { hasAccess, role, project } = await checkProjectAccess(
      projectId,
      session.user.id
    );

    if (!hasAccess || !project) {
      return apiError(PROJECT_ERRORS.NO_ACCESS, 404);
    }

    if (role !== "owner") {
      return apiError(PROJECT_ERRORS.OWNER_ONLY, 403);
    }

    const body = await request.json();
    const { name, description, visibility, compiler } = body;

    // Build update payload
    const updateData: {
      name?: string;
      description?: string | null;
      visibility?: string;
      compiler?: string | null;
      updatedAt: Date;
    } = {
      updatedAt: new Date(),
    };

    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        return apiError(PROJECT_ERRORS.NAME_REQUIRED, 400);
      }
      updateData.name = name.trim();
    }

    if (description !== undefined) {
      updateData.description = description?.trim() || null;
    }

    if (visibility !== undefined) {
      if (!["private", "shared", "public"].includes(visibility)) {
        return apiError(GENERAL_ERRORS.INVALID_VISIBILITY, 400);
      }
      updateData.visibility = visibility;
    }

    // Project-level compiler setting: allow null to clear (fallback to user settings)
    if (compiler !== undefined) {
      if (compiler === null) {
        updateData.compiler = null;
      } else if (typeof compiler === "string" && VALID_COMPILERS.has(compiler as Compiler)) {
        updateData.compiler = compiler;
      } else {
        return apiError(PROJECT_ERRORS.INVALID_COMPILER, 400);
      }
    }

    // Update database
    const updatedProject = await prisma.project.update({
      where: { id: projectId },
      data: updateData,
    });

    // Sync update to project.json in storage
    const meta: ProjectMeta = {
      id: projectId,
      name: updatedProject.name,
      description: updatedProject.description || undefined,
      mainFile: updatedProject.mainFile,
      compiler: updatedProject.compiler || undefined,
      createdAt: updatedProject.createdAt.toISOString(),
      updatedAt: updatedProject.updatedAt.toISOString(),
    };
    await writeProjectMeta(projectId, meta);

    return NextResponse.json({
      success: true,
      project: {
        ...updatedProject,
        createdAt: updatedProject.createdAt.toISOString(),
        updatedAt: updatedProject.updatedAt.toISOString(),
      }
    });
  } catch (error) {
    console.error("Error updating project:", error);
    return apiError(PROJECT_ERRORS.UPDATE_FAILED, 500);
  }
}

/**
 * DELETE /api/projects/[id] - Delete a project.
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

    // Check access (only owner can delete project)
    const { hasAccess, role, project } = await checkProjectAccess(
      projectId,
      session.user.id
    );

    if (!hasAccess || !project) {
      return apiError(PROJECT_ERRORS.NO_ACCESS, 404);
    }

    if (role !== "owner") {
      return apiError(PROJECT_ERRORS.OWNER_ONLY_DELETE, 403);
    }

    // Before deleting DB records, handle blob refcounts for Merkle Tree versions
    try {
      const merkleVersions = await prisma.projectVersion.findMany({
        where: {
          projectId,
          rootTreeHash: { not: null },
        },
        select: { rootTreeHash: true },
      });

      for (const version of merkleVersions) {
        if (version.rootTreeHash) {
          try {
            const files = await merkleService.getTreeFiles(version.rootTreeHash);
            for (const file of files) {
              await merkleService.decrementBlobRef(file.hash);
            }
          } catch {
            // Ignore errors; garbage collection will eventually clean up
          }
        }
      }
    } catch {
      // Ignore errors
    }

    // Delete database record (cascades collaborators, versions, etc.)
    await prisma.project.delete({
      where: { id: projectId },
    });

    // Delete project files from storage
    try {
      const storage = await getStorage();
      // Delete project files
      await storage.deletePrefix(StoragePaths.projectPrefix(projectId));
      // Delete compiled artifacts
      await storage.deletePrefix(StoragePaths.compiledPrefix(projectId));
      // Delete version snapshots (legacy format)
      await storage.deletePrefix(StoragePaths.versionsPrefix(projectId));
    } catch {
      // Ignore storage deletion errors
      console.warn("Failed to delete project files from storage:", projectId);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting project:", error);
    return apiError(PROJECT_ERRORS.DELETE_FAILED, 500);
  }
}
