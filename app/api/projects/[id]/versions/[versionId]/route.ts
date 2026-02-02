import { NextRequest, NextResponse } from "next/server";
import { auth, checkProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths, isTextFile } from "@/lib/storage";
import { merkleService } from "@/lib/storage/merkle";
// Keep legacy snapshot import for backward compatibility
import { downloadSnapshot } from "@/lib/storage/snapshot";
import { apiError, AUTH_ERRORS, PROJECT_ERRORS, VERSION_ERRORS } from "@/lib/api-errors";

/**
 * GET /api/projects/[id]/versions/[versionId] - Get version details.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const { id: projectId, versionId } = await params;
    const session = await auth();

    // Check permissions
    const { hasAccess, project } = await checkProjectAccess(
      projectId,
      session?.user?.id || null
    );

    if (!hasAccess || !project) {
      return apiError(PROJECT_ERRORS.NO_ACCESS, 404);
    }

    // Fetch version details
    const version = await prisma.projectVersion.findUnique({
      where: {
        id: versionId,
        projectId, // Ensure the version belongs to the project
      },
      include: {
        user: { select: { id: true, name: true, email: true, image: true } },
        snapshots: {
          select: {
            id: true,
            filePath: true,
            content: true,
          },
          orderBy: { filePath: "asc" },
        },
      },
    });

    if (!version) {
      return apiError(VERSION_ERRORS.NOT_FOUND, 404);
    }

    // Build file list
    // For text files, return UTF-8 content; for binary files, return base64-encoded content
    let files: Array<{
      id: string;
      path: string;
      content: string;
      size?: number;
      isBinary?: boolean;  // Whether the file is binary
    }>;

    if (version.rootTreeHash) {
      // New format: Merkle Tree
      try {
        const treeFiles = await merkleService.getTreeFiles(version.rootTreeHash);
        files = await Promise.all(
          treeFiles.map(async (f, index) => {
            const content = await merkleService.downloadBlob(f.hash);
            const isBinary = !isTextFile(f.path);
            return {
              id: `tree-${index}`,
              path: f.path,
              // Use UTF-8 for text files, base64 for binary files
              content: isBinary ? content.toString("base64") : content.toString("utf8"),
              size: f.size,
              isBinary,
            };
          })
        );
      } catch (error) {
        console.error("Error reading tree files:", error);
        return apiError(VERSION_ERRORS.CANNOT_READ_FILE, 500);
      }
    } else if (version.snapshotKey) {
      // Legacy format: download from tar.gz (compatibility)
      try {
        const snapshotFiles = await downloadSnapshot(projectId, versionId);
        files = Array.from(snapshotFiles).map(([path, content], index) => {
          const isBinary = !isTextFile(path);
          return {
            id: `s3-${index}`,
            path,
            content: isBinary ? content.toString("base64") : content.toString("utf8"),
            isBinary,
          };
        });
      } catch (error) {
        console.error("Error downloading snapshot:", error);
        return apiError(VERSION_ERRORS.CANNOT_READ_SNAPSHOT, 500);
      }
    } else {
      // Oldest format: read from DB (legacy versions are all text files)
      files = version.snapshots.map(s => ({
        id: s.id,
        path: s.filePath,
        content: s.content,
        isBinary: false,
      }));
    }

    return NextResponse.json({
      version: {
        id: version.id,
        name: version.name,
        description: version.description,
        user: version.user,
        fileCount: version.fileCount || files.length,
        totalSize: version.totalSize || 0,
        rootTreeHash: version.rootTreeHash,
        parentHash: version.parentHash,
        createdAt: version.createdAt.toISOString(),
        files,
      },
    });
  } catch (error) {
    console.error("Error getting version details:", error);
    return apiError(VERSION_ERRORS.DETAIL_FAILED, 500);
  }
}

/**
 * DELETE /api/projects/[id]/versions/[versionId] - Delete a version.
 *
 * For Merkle Tree versions, decrement Blob reference counts (cleaned up by GC).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const { id: projectId, versionId } = await params;
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    // Check permissions (only the owner can delete versions)
    const { hasAccess, role, project } = await checkProjectAccess(
      projectId,
      session.user.id
    );

    if (!hasAccess || !project) {
      return apiError(PROJECT_ERRORS.NO_ACCESS, 404);
    }

    if (role !== "owner") {
      return apiError(VERSION_ERRORS.OWNER_ONLY_DELETE, 403);
    }

    // Check whether the version exists
    const version = await prisma.projectVersion.findUnique({
      where: {
        id: versionId,
        projectId,
      },
    });

    if (!version) {
      return apiError(VERSION_ERRORS.NOT_FOUND, 404);
    }

    // Handle different version storage formats
    if (version.rootTreeHash) {
      // Merkle Tree version: decrement Blob reference counts
      try {
        const files = await merkleService.getTreeFiles(version.rootTreeHash);
        for (const file of files) {
          await merkleService.decrementBlobRef(file.hash);
        }
      } catch (error) {
        console.warn("Failed to decrement blob refs:", error);
        // Continue deleting the version record
      }
    } else if (version.snapshotKey) {
      // Legacy tar.gz version: delete snapshot from storage
      try {
        const storage = await getStorage();
        await storage.delete(version.snapshotKey);
      } catch (error) {
        console.warn("Failed to delete snapshot from storage:", error);
        // Continue deleting the DB record
      }
    }

    // Delete the version (cascades to FileSnapshot and TreeEntry)
    await prisma.projectVersion.delete({
      where: { id: versionId },
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("Error deleting version:", error);
    return apiError(VERSION_ERRORS.DELETE_FAILED, 500);
  }
}
