/**
 * Internal API: Delete Project
 * =============================
 *
 * Internal endpoint for nanobot to delete a project.
 * Handles Merkle Tree blob ref cleanup, DB cascade delete, and storage cleanup.
 * Protected by INTERNAL_API_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths } from "@/lib/storage";
import { merkleService } from "@/lib/storage/merkle";

function verifyInternalAuth(request: NextRequest): boolean {
  const secret = request.headers.get("X-Internal-Secret");
  const expectedSecret = process.env.INTERNAL_API_SECRET;
  if (!expectedSecret) {
    console.warn("[Internal API] INTERNAL_API_SECRET not configured");
    return false;
  }
  return secret === expectedSecret;
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
    const { projectId } = body as { projectId: string };

    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json(
        { success: false, error: "Project ID is required" },
        { status: 400 }
      );
    }

    // Verify project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    });

    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }

    // Handle blob refcounts for Merkle Tree versions
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
            // Ignore; garbage collection will eventually clean up
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
      await storage.deletePrefix(StoragePaths.projectPrefix(projectId));
      await storage.deletePrefix(StoragePaths.compiledPrefix(projectId));
      await storage.deletePrefix(StoragePaths.versionsPrefix(projectId));
    } catch {
      console.warn("[Internal/DeleteProject] Failed to delete storage files:", projectId);
    }

    console.log(`[Internal/DeleteProject] Deleted project "${project.name}" (${projectId})`);

    return NextResponse.json({
      success: true,
      data: { projectId, name: project.name },
    });
  } catch (error) {
    console.error("[Internal/DeleteProject] Error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
