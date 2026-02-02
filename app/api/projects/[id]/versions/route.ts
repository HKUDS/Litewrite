import { NextRequest, NextResponse } from "next/server";
import { auth, checkProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { merkleService } from "@/lib/storage/merkle";
import { apiError, AUTH_ERRORS, PROJECT_ERRORS, VERSION_ERRORS } from "@/lib/api-errors";

/**
 * GET /api/projects/[id]/versions - Get version list.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const session = await auth();

    // Check permissions
    const { hasAccess, project } = await checkProjectAccess(
      projectId,
      session?.user?.id || null
    );

    if (!hasAccess || !project) {
      return apiError(PROJECT_ERRORS.NO_ACCESS, 404);
    }

    // Fetch version list
    const versions = await prisma.projectVersion.findMany({
      where: { projectId },
      include: {
        user: { select: { id: true, name: true, email: true, image: true } },
        _count: { select: { snapshots: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      versions: versions.map(v => ({
        id: v.id,
        name: v.name,
        description: v.description,
        user: v.user,
        fileCount: v.fileCount || v._count.snapshots,
        totalSize: v.totalSize || 0,
        // Mark version type (new)
        rootTreeHash: v.rootTreeHash,
        parentHash: v.parentHash,
        // Backward compatibility for legacy versions
        snapshotKey: v.snapshotKey,
        createdAt: v.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Error getting versions:", error);
    return apiError(VERSION_ERRORS.LIST_FAILED, 500);
  }
}

/**
 * POST /api/projects/[id]/versions - Create a new version.
 *
 * Uses Merkle Tree content-addressed storage.
 *
 * Body:
 * - name: string (required in manual mode)
 * - description?: string
 * - auto?: boolean (auto-save mode, called after successful compile)
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

    // Check permissions
    const { hasAccess, project } = await checkProjectAccess(
      projectId,
      session.user.id
    );

    if (!hasAccess || !project) {
      return apiError(PROJECT_ERRORS.NO_ACCESS, 404);
    }

    const body = await request.json();
    const { name, description, auto, autoNamePrefix } = body;

    // Auto-save mode: generate version name
    let versionName: string;
    if (auto) {
      const now = new Date();
      const dateStr = now.toISOString().replace("T", " ").slice(0, 19);
      // Use translated prefix from the frontend; default to "Auto-saved"
      const prefix = autoNamePrefix || "Auto-saved";
      versionName = `${prefix} - ${dateStr}`;
    } else {
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return apiError(VERSION_ERRORS.NAME_REQUIRED, 400);
      }
      versionName = name.trim();
    }

    try {
      // Create version via Merkle Tree
      const result = await merkleService.createCommit(
        projectId,
        versionName,
        session.user.id,
        description?.trim()
      );

      // Fetch created version details
      const version = await prisma.projectVersion.findUnique({
        where: { id: result.id },
        include: {
          user: { select: { id: true, name: true, email: true, image: true } },
        },
      });

      return NextResponse.json({
        success: true,
        version: {
          id: version!.id,
          name: version!.name,
          description: version!.description,
          user: version!.user,
          fileCount: result.fileCount,
          totalSize: result.totalSize,
          rootTreeHash: result.rootTreeHash,
          createdAt: version!.createdAt.toISOString(),
        },
      });
    } catch (error) {
      // Handle specific errors
      if (error instanceof Error) {
        if (error.message === "NO_CHANGES_DETECTED") {
          // Auto-save mode: return success silently when there are no changes
          if (auto) {
            return NextResponse.json({
              success: true,
              skipped: true,
            });
          }
          // Manual mode: return an error message
          return apiError(VERSION_ERRORS.NO_CHANGES, 400);
        }
        if (error.message === "NO_FILES_TO_SAVE") {
          return apiError(VERSION_ERRORS.NO_FILES, 400);
        }
      }
      throw error;
    }
  } catch (error) {
    console.error("Error creating version:", error);
    return apiError(VERSION_ERRORS.CREATE_FAILED, 500);
  }
}
