/**
 * Internal API: Create Project Version
 * =======================================
 *
 * Internal endpoint for nanobot to save the current project state as a version.
 * Uses Merkle Tree content-addressed storage.
 * Protected by INTERNAL_API_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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
    const { projectId, userId, name, description } = body as {
      projectId: string;
      userId?: string;
      name?: string;
      description?: string;
    };

    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json(
        { success: false, error: "Project ID is required" },
        { status: 400 }
      );
    }

    // Verify project exists and get owner
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, ownerId: true },
    });

    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }

    // Generate version name if not provided
    const now = new Date();
    const dateStr = now.toISOString().replace("T", " ").slice(0, 19);
    const versionName = name?.trim() || `Saved - ${dateStr}`;
    const saveUserId = userId || project.ownerId;

    try {
      const result = await merkleService.createCommit(
        projectId,
        versionName,
        saveUserId,
        description?.trim()
      );

      // Fetch created version details
      const version = await prisma.projectVersion.findUnique({
        where: { id: result.id },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });

      console.log(
        `[Internal/CreateVersion] Saved version "${versionName}" (${result.id}) for project "${project.name}"`
      );

      return NextResponse.json({
        success: true,
        data: {
          version: {
            id: version!.id,
            name: version!.name,
            description: version!.description,
            user: version!.user,
            fileCount: result.fileCount,
            totalSize: result.totalSize,
            createdAt: version!.createdAt.toISOString(),
          },
        },
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "NO_CHANGES_DETECTED") {
          return NextResponse.json({
            success: true,
            skipped: true,
            message: "No changes detected since the last saved version.",
          });
        }
        if (error.message === "NO_FILES_TO_SAVE") {
          return NextResponse.json(
            { success: false, error: "No files found in the project to save" },
            { status: 400 }
          );
        }
      }
      throw error;
    }
  } catch (error) {
    console.error("[Internal/CreateVersion] Error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
