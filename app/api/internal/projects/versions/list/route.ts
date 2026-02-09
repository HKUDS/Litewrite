/**
 * Internal API: List Project Versions
 * =====================================
 *
 * Internal endpoint for nanobot to list all versions/history of a project.
 * Protected by INTERNAL_API_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

    // Fetch version list
    const versions = await prisma.projectVersion.findMany({
      where: { projectId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        _count: { select: { snapshots: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const result = versions.map((v) => ({
      id: v.id,
      name: v.name,
      description: v.description,
      user: v.user,
      fileCount: v.fileCount || v._count.snapshots,
      totalSize: v.totalSize || 0,
      createdAt: v.createdAt.toISOString(),
    }));

    console.log(
      `[Internal/ListVersions] Found ${result.length} versions for project "${project.name}" (${projectId})`
    );

    return NextResponse.json({
      success: true,
      data: {
        projectName: project.name,
        versions: result,
        count: result.length,
      },
    });
  } catch (error) {
    console.error("[Internal/ListVersions] Error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
