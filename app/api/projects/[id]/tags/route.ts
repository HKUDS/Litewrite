import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiError, AUTH_ERRORS, PROJECT_ERRORS, TAG_ERRORS } from "@/lib/api-errors";

/**
 * GET /api/projects/[id]/tags - Get tags of a project
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const { id: projectId } = await params;

    // Check whether the project exists and the user has access
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { ownerId: session.user.id },
          { collaborators: { some: { userId: session.user.id } } },
        ],
      },
      include: {
        tags: {
          include: {
            tag: true
          }
        }
      }
    });

    if (!project) {
      return apiError(PROJECT_ERRORS.NO_ACCESS, 404);
    }

    return NextResponse.json({
      tags: project.tags.map(pt => ({
        id: pt.tag.id,
        name: pt.tag.name,
        color: pt.tag.color,
      }))
    });
  } catch (error) {
    console.error("Error getting project tags:", error);
    return apiError(TAG_ERRORS.PROJECT_TAGS_FAILED, 500);
  }
}

/**
 * POST /api/projects/[id]/tags - Add a tag to a project
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const { id: projectId } = await params;
    const body = await request.json();
    const { tagId } = body;

    if (!tagId) {
      return apiError(TAG_ERRORS.ID_REQUIRED, 400);
    }

    // Check whether the project exists and the user is the owner
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    });

    if (!project) {
      return apiError(PROJECT_ERRORS.NOT_FOUND, 404);
    }

    if (project.ownerId !== session.user.id) {
      return apiError(PROJECT_ERRORS.OWNER_ONLY_TAGS, 403);
    }

    // Check whether the tag exists and belongs to the current user
    const tag = await prisma.tag.findFirst({
      where: {
        id: tagId,
        userId: session.user.id,
      },
    });

    if (!tag) {
      return apiError(TAG_ERRORS.NOT_FOUND, 404);
    }

    // Check whether it has already been added
    const existingProjectTag = await prisma.projectTag.findUnique({
      where: {
        projectId_tagId: {
          projectId,
          tagId,
        },
      },
    });

    if (existingProjectTag) {
      return apiError(TAG_ERRORS.ALREADY_ADDED, 400);
    }

    // Add the tag
    await prisma.projectTag.create({
      data: {
        projectId,
        tagId,
      },
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("Error adding tag to project:", error);
    return apiError(TAG_ERRORS.ADD_FAILED, 500);
  }
}

/**
 * DELETE /api/projects/[id]/tags - Remove a tag from a project
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const { id: projectId } = await params;
    const { searchParams } = new URL(request.url);
    const tagId = searchParams.get("tagId");

    if (!tagId) {
      return apiError(TAG_ERRORS.ID_REQUIRED, 400);
    }

    // Check whether the project exists and the user is the owner
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    });

    if (!project) {
      return apiError(PROJECT_ERRORS.NOT_FOUND, 404);
    }

    if (project.ownerId !== session.user.id) {
      return apiError(PROJECT_ERRORS.OWNER_ONLY_TAGS, 403);
    }

    // Delete project-tag association
    await prisma.projectTag.deleteMany({
      where: {
        projectId,
        tagId,
      },
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("Error removing tag from project:", error);
    return apiError(TAG_ERRORS.REMOVE_FAILED, 500);
  }
}
