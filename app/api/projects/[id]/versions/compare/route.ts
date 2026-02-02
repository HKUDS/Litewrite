import { NextRequest, NextResponse } from "next/server";
import { auth, checkProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths, isTextFile } from "@/lib/storage";
import { merkleService, type DiffLine, type FileDiff } from "@/lib/storage/merkle";
import { createHash } from "crypto";
// Keep legacy snapshot import for backward compatibility
import { downloadSnapshot, readProjectFilesFromStorage } from "@/lib/storage/snapshot";
import { apiError, PROJECT_ERRORS, VERSION_ERRORS } from "@/lib/api-errors";

// Extended FileDiff type including line-level diff
interface FileDiffWithLines extends FileDiff {
  diff: DiffLine[];
}

/**
 * Get a version's Tree hash and file contents.
 */
async function getVersionData(
  projectId: string,
  versionId: string | null,
  session: { user?: { name?: string | null } } | null
): Promise<{
  rootTreeHash: string | null;
  files: Map<string, string>;
  version: { id: string; name: string; createdAt: Date; user: { name: string | null } };
}> {
  if (versionId === "current" || versionId === null) {
    // Working directory: read files from storage
    const files = await readProjectFilesFromStorage(projectId);
    return {
      rootTreeHash: null, // Current version has no tree hash
      files,
      version: {
        id: "current",
        name: "__CURRENT_VERSION__", // Special marker; frontend translates it
        createdAt: new Date(),
        user: { name: session?.user?.name || null },
      },
    };
  }

  // Fetch version from database
  const version = await prisma.projectVersion.findUnique({
    where: { id: versionId, projectId },
    include: {
      snapshots: true,
      user: { select: { name: true } },
    },
  });

  if (!version) {
    throw new Error("VERSION_NOT_FOUND");
  }

  let files: Map<string, string>;

  if (version.rootTreeHash) {
    // Merkle Tree version
    const treeFiles = await merkleService.getTreeFiles(version.rootTreeHash);
    files = new Map();
    for (const f of treeFiles) {
      // Load content only for text files (for diff)
      // For binary files, store a hash for comparison (format: [binary:HASH])
      if (isTextFile(f.path)) {
        const content = await merkleService.downloadBlob(f.hash);
        files.set(f.path, content.toString("utf8"));
      } else {
        // Binary files: use blob hash as a unique identifier for comparison
        files.set(f.path, `[binary:${f.hash.substring(0, 16)}]`);
      }
    }
  } else if (version.snapshotKey) {
    // Legacy tar.gz version
    const snapshotFiles = await downloadSnapshot(projectId, versionId);
    files = new Map();
    for (const [path, content] of snapshotFiles) {
      if (isTextFile(path)) {
        files.set(path, content.toString("utf8"));
      } else {
        // Binary files: compute content hash for version comparison
        const hash = createHash("sha256").update(content).digest("hex").substring(0, 16);
        files.set(path, `[binary:${hash}]`);
      }
    }
  } else {
    // Oldest format: read from database
    files = new Map();
    for (const snapshot of version.snapshots) {
      files.set(snapshot.filePath, snapshot.content);
    }
  }

  return {
    rootTreeHash: version.rootTreeHash,
    files,
    version: {
      id: version.id,
      name: version.name,
      createdAt: version.createdAt,
      user: version.user,
    },
  };
}

/**
 * POST /api/projects/[id]/versions/compare - Compare two versions.
 *
 * - For Merkle Tree versions, use an efficient Tree comparison algorithm
 * - For legacy versions, fall back to file-level comparison
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const session = await auth();

    // Check access
    const { hasAccess, project } = await checkProjectAccess(
      projectId,
      session?.user?.id || null
    );

    if (!hasAccess || !project) {
      return apiError(PROJECT_ERRORS.NO_ACCESS, 404);
    }

    const body = await request.json();
    const { fromVersionId, toVersionId } = body;

    if (!fromVersionId && !toVersionId) {
      return apiError(VERSION_ERRORS.SPECIFY_TWO_VERSIONS, 400);
    }

    // Get data for both versions
    const [fromData, toData] = await Promise.all([
      getVersionData(projectId, fromVersionId, session),
      getVersionData(projectId, toVersionId, session),
    ]);

    let fileDiffs: FileDiff[];

    // If both versions are Merkle Tree versions, use efficient tree comparison
    if (fromData.rootTreeHash && toData.rootTreeHash) {
      fileDiffs = await merkleService.compareTrees(
        fromData.rootTreeHash,
        toData.rootTreeHash
      );
    } else {
      // Fall back to file-level comparison
      const allPaths = new Set([...fromData.files.keys(), ...toData.files.keys()]);
      fileDiffs = [];

      for (const filePath of allPaths) {
        const fromContent = fromData.files.get(filePath);
        const toContent = toData.files.get(filePath);

        let status: FileDiff["status"];
        if (fromContent === undefined) {
          status = "added";
        } else if (toContent === undefined) {
          status = "removed";
        } else if (fromContent === toContent) {
          status = "unchanged";
        } else {
          status = "modified";
        }

        // For non-Merkle versions, do not set hashes (later fetch content via files Map)
        fileDiffs.push({
          filePath,
          status,
        });
      }
    }

    // Compute line-level diff
    const diffsWithLines: FileDiffWithLines[] = await Promise.all(
      fileDiffs.map(async (fd) => {
        if (fd.status === "unchanged") {
          return { ...fd, diff: [] };
        }

        // Do not compute line-level diff for binary files
        if (!isTextFile(fd.filePath)) {
          return {
            ...fd,
            diff: [{
              type: "unchanged" as const,
              content: `[Binary file ${fd.status === "added" ? "added" : fd.status === "removed" ? "removed" : "modified"}]`,
            }],
          };
        }

        let oldContent: string | null = null;
        let newContent: string | null = null;

        if (fd.oldHash) {
          const content = await merkleService.downloadBlob(fd.oldHash);
          oldContent = content.toString("utf8");
        } else if (fd.status !== "added") {
          oldContent = fromData.files.get(fd.filePath) ?? null;
        }

        if (fd.newHash) {
          const content = await merkleService.downloadBlob(fd.newHash);
          newContent = content.toString("utf8");
        } else if (fd.status !== "removed") {
          newContent = toData.files.get(fd.filePath) ?? null;
        }

        const diff = merkleService.computeLineDiff(oldContent, newContent);

        return { ...fd, diff };
      })
    );

    // Sort by status and path
    diffsWithLines.sort((a, b) => {
      const statusOrder = { added: 0, removed: 1, modified: 2, unchanged: 3 };
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[a.status] - statusOrder[b.status];
      }
      return a.filePath.localeCompare(b.filePath);
    });

    // Stats
    const stats = {
      added: diffsWithLines.filter(d => d.status === "added").length,
      removed: diffsWithLines.filter(d => d.status === "removed").length,
      modified: diffsWithLines.filter(d => d.status === "modified").length,
      unchanged: diffsWithLines.filter(d => d.status === "unchanged").length,
    };

    return NextResponse.json({
      fromVersion: {
        id: fromData.version.id,
        name: fromData.version.name,
        createdAt: fromData.version.createdAt.toISOString(),
        userName: fromData.version.user.name,
        rootTreeHash: fromData.rootTreeHash,
      },
      toVersion: {
        id: toData.version.id,
        name: toData.version.name,
        createdAt: toData.version.createdAt.toISOString(),
        userName: toData.version.user.name,
        rootTreeHash: toData.rootTreeHash,
      },
      stats,
      diffs: diffsWithLines,
    });
  } catch (error) {
    console.error("Error comparing versions:", error);
    if (error instanceof Error && error.message === "VERSION_NOT_FOUND") {
      return apiError(VERSION_ERRORS.NOT_FOUND, 404);
    }
    return apiError(VERSION_ERRORS.COMPARE_FAILED, 500);
  }
}
