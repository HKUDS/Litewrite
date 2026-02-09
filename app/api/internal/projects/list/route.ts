/**
 * Internal API: List Projects
 * ============================
 *
 * Internal endpoint for nanobot to list projects.
 * Supports filtering by owner and searching by name.
 *
 * This is NOT exposed to the public - protected by INTERNAL_API_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Verify internal API secret
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
  // Verify authentication
  if (!verifyInternalAuth(request)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { ownerId, search, limit = 50 } = body as {
      ownerId?: string;
      search?: string;
      limit?: number;
    };

    // Security: ownerId is required to prevent cross-tenant data leakage
    if (!ownerId || typeof ownerId !== "string" || ownerId.trim().length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "ownerId is required for security reasons",
        },
        { status: 400 }
      );
    }

    // Build where clause
    const where: Record<string, unknown> = {
      status: { not: "trashed" },
      ownerId: ownerId.trim(),
    };

    // Search by name (case-insensitive via Prisma contains)
    if (search) {
      where.AND = [
        {
          OR: [
            { name: { contains: search } },
            { description: { contains: search } },
          ],
        },
      ];
    }

    // Fetch projects
    const projects = await prisma.project.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: Math.min(limit, 100),
      select: {
        id: true,
        name: true,
        description: true,
        mainFile: true,
        compiler: true,
        updatedAt: true,
        createdAt: true,
        ownerId: true,
      },
    });

    const result = projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      mainFile: p.mainFile,
      compiler: p.compiler,
      updatedAt: p.updatedAt.toISOString(),
      createdAt: p.createdAt.toISOString(),
      ownerId: p.ownerId,
    }));

    console.log(
      `[Internal/ListProjects] Found ${result.length} projects` +
        ` for owner ${ownerId}` +
        (search ? ` matching "${search}"` : "")
    );

    return NextResponse.json({
      success: true,
      data: {
        projects: result,
        count: result.length,
      },
    });
  } catch (error) {
    console.error("[Internal/ListProjects] Error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
