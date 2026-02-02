import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AUTH_ERRORS, TAG_ERRORS, apiError, apiSuccess } from "@/lib/api-errors";

/**
 * GET /api/tags - fetch all tags for the current user.
 */
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const tags = await prisma.tag.findMany({
      where: { userId: session.user.id },
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { projects: true }
        }
      }
    });

    return apiSuccess({
      tags: tags.map(t => ({
        id: t.id,
        name: t.name,
        color: t.color,
        projectCount: t._count.projects,
        createdAt: t.createdAt.toISOString(),
      }))
    });
  } catch (error) {
    console.error("Error getting tags:", error);
    return apiError(TAG_ERRORS.LIST_FAILED, 500);
  }
}

/**
 * POST /api/tags - create a new tag.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const body = await request.json();
    const { name, color } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return apiError(TAG_ERRORS.NAME_REQUIRED, 400);
    }

    // Check whether a tag with the same name already exists.
    const existingTag = await prisma.tag.findFirst({
      where: {
        userId: session.user.id,
        name: name.trim(),
      },
    });

    if (existingTag) {
      return apiError(TAG_ERRORS.NAME_EXISTS, 400);
    }

    const tag = await prisma.tag.create({
      data: {
        name: name.trim(),
        color: color || "#6B7280",
        userId: session.user.id,
      },
    });

    return apiSuccess({
      success: true,
      tag: {
        id: tag.id,
        name: tag.name,
        color: tag.color,
        projectCount: 0,
        createdAt: tag.createdAt.toISOString(),
      }
    });
  } catch (error) {
    console.error("Error creating tag:", error);
    return apiError(TAG_ERRORS.CREATE_FAILED, 500);
  }
}
