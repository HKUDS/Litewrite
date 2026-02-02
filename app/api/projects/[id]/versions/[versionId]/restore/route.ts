import { NextRequest, NextResponse } from "next/server";
import { auth, checkProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { merkleService } from "@/lib/storage/merkle";
import { downloadSnapshot } from "@/lib/storage/snapshot";
import { getStorage, StoragePaths, isTextFile } from "@/lib/storage";
import { getRedis } from "@/server/redis-client";
import { apiError, AUTH_ERRORS, GENERAL_ERRORS, PROJECT_ERRORS, VERSION_ERRORS } from "@/lib/api-errors";

export const runtime = "nodejs";

async function clearYjsPersistenceForProject(projectId: string): Promise<number> {
  // Web containers may not inject REDIS_URL by default; skip when not configured
  // (storage-layer restore can still complete without it).
  if (!process.env.REDIS_URL) return 0;

  try {
    const redis = await getRedis();
    if (!redis) return 0;
    let deleted = 0;

    // Use SCAN to avoid blocking Redis (DO NOT use KEYS)
    const patterns = [`yjs:${projectId}:*:updates`, `yjs:${projectId}:*:meta`];
    const count = 1000;

    for (const pattern of patterns) {
      let cursor = "0";
      do {
        const res = await redis.scan(cursor, "MATCH", pattern, "COUNT", count);
        cursor = res[0];
        const keys = res[1] as string[];
        if (keys.length > 0) {
          // ioredis DEL supports multiple keys
          deleted += await redis.del(...keys);
        }
      } while (cursor !== "0");
    }

    return deleted;
  } catch {
    // best-effort: don't fail restore on Redis issues
    return 0;
  }
}

async function clearWsInMemoryRoomsForProject(projectId: string): Promise<{
  clearedDocs?: number;
  closedClients?: number;
} | null> {
  const wsUrl = process.env.WS_SERVER_URL;
  const secret = process.env.INTERNAL_API_SECRET;
  if (!wsUrl || !secret) return null;

  try {
    const resp = await fetch(`${wsUrl}/admin/clear-project/${projectId}`, {
      method: "POST",
      headers: { "X-Internal-Secret": secret },
      // best-effort: don't hang restore on WS issues
      signal: AbortSignal.timeout(5000),
    });
    const text = await resp.text();
    if (!resp.ok) return null;
    return JSON.parse(text) as { clearedDocs?: number; closedClients?: number };
  } catch {
    return null;
  }
}

/**
 * POST /api/projects/[id]/versions/[versionId]/restore - Restore to a specific version.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const { id: projectId, versionId } = await params;
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    // Check permissions (requires edit access)
    const { hasAccess, role, project } = await checkProjectAccess(
      projectId,
      session.user.id
    );

    if (!hasAccess || !project) {
      return apiError(PROJECT_ERRORS.NO_ACCESS, 404);
    }

    // Only owner and editor can restore versions
    if (role !== "owner" && role !== "editor") {
      return apiError(GENERAL_ERRORS.NO_ACCESS, 403);
    }

    // Fetch version info
    const version = await prisma.projectVersion.findUnique({
      where: {
        id: versionId,
        projectId,
      },
    });

    if (!version) {
      return apiError(VERSION_ERRORS.NOT_FOUND, 404);
    }

    let restoredFileCount = 0;

    if (version.rootTreeHash) {
      // New format: restore via Merkle Tree
      restoredFileCount = await merkleService.restoreCommit(projectId, versionId);
    } else if (version.snapshotKey) {
      // Legacy format: restore from tar.gz
      const snapshotFiles = await downloadSnapshot(projectId, versionId);
      // downloadSnapshot returns Map<filePath, Buffer>
      const storage = await getStorage();
      const projectPrefix = StoragePaths.projectPrefix(projectId);

      // Delete current project files (keep dotfiles)
      const currentFiles = await storage.list(projectPrefix);
      for (const file of currentFiles) {
        const filename = file.key.split("/").pop() || "";
        if (!filename.startsWith(".")) {
          await storage.delete(file.key);
        }
      }

      // Restore files from snapshot
      for (const [filePath, content] of snapshotFiles.entries()) {
        const key = StoragePaths.projectFile(projectId, filePath);
        await storage.upload(key, content);
        restoredFileCount++;
      }
    } else {
      // Oldest format: read from database
      const snapshots = await prisma.fileSnapshot.findMany({
        where: { versionId },
      });

      if (snapshots.length === 0) {
        return apiError(VERSION_ERRORS.SNAPSHOT_EMPTY, 400);
      }

      const storage = await getStorage();
      const projectPrefix = StoragePaths.projectPrefix(projectId);

      // Delete current project files (keep dotfiles)
      const currentFiles = await storage.list(projectPrefix);
      for (const file of currentFiles) {
        const filename = file.key.split("/").pop() || "";
        if (!filename.startsWith(".")) {
          await storage.delete(file.key);
        }
      }

      // Restore files from snapshots
      for (const snapshot of snapshots) {
        const key = StoragePaths.projectFile(projectId, snapshot.filePath);
        await storage.upload(key, Buffer.from(snapshot.content, "utf8"));
        restoredFileCount++;
      }
    }

    // Clear Yjs Redis persistence (avoid editor continuing to show stale content)
    // Note: the collaborative editor restores Yjs docs from WS/Redis first; without clearing,
    // storage files may be restored but the editor can still show old Yjs content, leading to
    // the illusion of "no diff in compare but content not restored".
    const clearedYjsKeys = await clearYjsPersistenceForProject(projectId);
    const wsCleared = await clearWsInMemoryRoomsForProject(projectId);

    return NextResponse.json({
      success: true,
      versionName: version.name,
      restoredFileCount,
      clearedYjsKeys,
      wsCleared,
    });
  } catch (error) {
    console.error("Error restoring version:", error);

    // Handle specific errors
    if (error instanceof Error) {
      if (error.message === "VERSION_NOT_FOUND") {
        return apiError(VERSION_ERRORS.NOT_FOUND, 404);
      }
      if (error.message === "VERSION_FORMAT_UNSUPPORTED") {
        return apiError(VERSION_ERRORS.RESTORE_FAILED, 400);
      }
    }

    return apiError(VERSION_ERRORS.RESTORE_FAILED, 500);
  }
}
