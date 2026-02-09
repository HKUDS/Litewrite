/**
 * Internal API: Rename/Update Project
 * =====================================
 *
 * Internal endpoint for nanobot to rename or update a project's metadata.
 * Protected by INTERNAL_API_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths } from "@/lib/storage";
import type { ProjectMeta } from "@/types";

function verifyInternalAuth(request: NextRequest): boolean {
  const secret = request.headers.get("X-Internal-Secret");
  const expectedSecret = process.env.INTERNAL_API_SECRET;
  if (!expectedSecret) {
    console.warn("[Internal API] INTERNAL_API_SECRET not configured");
    return false;
  }
  return secret === expectedSecret;
}

async function writeProjectMeta(projectId: string, meta: ProjectMeta): Promise<void> {
  try {
    const storage = await getStorage();
    const metaKey = StoragePaths.projectFile(projectId, "project.json");
    await storage.upload(metaKey, JSON.stringify(meta, null, 2), "application/json");
  } catch {
    console.log(`Note: Could not write project.json for ${projectId} (S3 backup)`);
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
    const { projectId, name, description } = body as {
      projectId: string;
      name?: string;
      description?: string;
    };

    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json(
        { success: false, error: "Project ID is required" },
        { status: 400 }
      );
    }

    // Verify project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });

    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }

    // Build update payload
    const updateData: {
      name?: string;
      description?: string | null;
      updatedAt: Date;
    } = {
      updatedAt: new Date(),
    };

    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        return NextResponse.json(
          { success: false, error: "Project name cannot be empty" },
          { status: 400 }
        );
      }
      updateData.name = name.trim();
    }

    if (description !== undefined) {
      updateData.description = description?.trim() || null;
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

    console.log(`[Internal/RenameProject] Updated project ${projectId}: name="${updatedProject.name}"`);

    return NextResponse.json({
      success: true,
      data: {
        project: {
          id: updatedProject.id,
          name: updatedProject.name,
          description: updatedProject.description,
          createdAt: updatedProject.createdAt.toISOString(),
          updatedAt: updatedProject.updatedAt.toISOString(),
        },
      },
    });
  } catch (error) {
    console.error("[Internal/RenameProject] Error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
