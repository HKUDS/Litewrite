/**
 * Internal API: Restore Project Version
 * ========================================
 *
 * Internal endpoint for nanobot to restore a project to a specific version.
 * Handles Merkle Tree, tar.gz, and DB snapshot formats.
 * Clears Yjs Redis persistence and WS server in-memory rooms.
 * Protected by INTERNAL_API_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { merkleService } from "@/lib/storage/merkle";
import { downloadSnapshot } from "@/lib/storage/snapshot";
import { getStorage, StoragePaths } from "@/lib/storage";
import { getRedis } from "@/server/redis-client";

export const runtime = "nodejs";

function verifyInternalAuth(request: NextRequest): boolean {
  const secret = request.headers.get("X-Internal-Secret");
  const expectedSecret = process.env.INTERNAL_API_SECRET;
  if (!expectedSecret) {
    console.warn("[Internal API] INTERNAL_API_SECRET not configured");
    return false;
  }
  return secret === expectedSecret;
}

async function clearYjsPersistenceForProject(projectId: string): Promise<number> {
  if (!process.env.REDIS_URL) return 0;

  try {
    const redis = await getRedis();
    if (!redis) return 0;
    let deleted = 0;

    const patterns = [`yjs:${projectId}:*:updates`, `yjs:${projectId}:*:meta`];
    const count = 1000;

    for (const pattern of patterns) {
      let cursor = "0";
      do {
        const res = await redis.scan(cursor, "MATCH", pattern, "COUNT", count);
        cursor = res[0];
        const keys = res[1] as string[];
        if (keys.length > 0) {
          deleted += await redis.del(...keys);
        }
      } while (cursor !== "0");
    }

    return deleted;
  } catch {
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
      signal: AbortSignal.timeout(5000),
    });
    const text = await resp.text();
    if (!resp.ok) return null;
    return JSON.parse(text) as { clearedDocs?: number; closedClients?: number };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  if (!verifyInternalAuth(request)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { projectId, versionId } = body as {
      projectId: string;
      versionId: string;
    };

    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json(
        { success: false, error: "Project ID is required" },
        { status: 400 }
      );
    }

    if (!versionId || typeof versionId !== "string") {
      return NextResponse.json(
        { success: false, error: "Version ID is required" },
        { status: 400 }
      );
    }

    // Fetch version info
    const version = await prisma.projectVersion.findUnique({
      where: {
        id: versionId,
        projectId,
      },
    });

    if (!version) {
      return NextResponse.json(
        { success: false, error: "Version not found" },
        { status: 404 }
      );
    }

    let restoredFileCount = 0;

    if (version.rootTreeHash) {
      // New format: restore via Merkle Tree
      restoredFileCount = await merkleService.restoreCommit(projectId, versionId);
    } else if (version.snapshotKey) {
      // Legacy format: restore from tar.gz
      const snapshotFiles = await downloadSnapshot(projectId, versionId);
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
        return NextResponse.json(
          { success: false, error: "Version snapshot is empty" },
          { status: 400 }
        );
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

    // Clear Yjs Redis persistence and WS in-memory rooms
    const clearedYjsKeys = await clearYjsPersistenceForProject(projectId);
    const wsCleared = await clearWsInMemoryRoomsForProject(projectId);

    console.log(
      `[Internal/RestoreVersion] Restored project ${projectId} to version "${version.name}" (${versionId}), ` +
        `${restoredFileCount} files restored, ${clearedYjsKeys} Yjs keys cleared`
    );

    return NextResponse.json({
      success: true,
      data: {
        versionId,
        versionName: version.name,
        restoredFileCount,
        clearedYjsKeys,
        wsCleared,
      },
    });
  } catch (error) {
    console.error("[Internal/RestoreVersion] Error:", error);

    if (error instanceof Error) {
      if (error.message === "VERSION_NOT_FOUND") {
        return NextResponse.json(
          { success: false, error: "Version not found" },
          { status: 404 }
        );
      }
    }

    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
