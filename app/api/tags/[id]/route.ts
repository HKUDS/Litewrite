import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AUTH_ERRORS, TAG_ERRORS, apiError, apiSuccess } from "@/lib/api-errors";

/**
 * PATCH /api/tags/[id] - Update tag
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const { id: tagId } = await params;
    const body = await request.json();
    const { name, color } = body;

    // Check whether the tag exists and belongs to the current user
    const tag = await prisma.tag.findUnique({
      where: { id: tagId },
    });

    if (!tag) {
      return apiError(TAG_ERRORS.NOT_FOUND, 404);
    }

    if (tag.userId !== session.user.id) {
      return apiError(TAG_ERRORS.NO_EDIT_PERMISSION, 403);
    }

    // If updating name, check for duplicates among the user's other tags
    if (name && name.trim() !== tag.name) {
      const existingTag = await prisma.tag.findFirst({
        where: {
          userId: session.user.id,
          name: name.trim(),
          id: { not: tagId },
        },
      });

      if (existingTag) {
        return apiError(TAG_ERRORS.NAME_EXISTS, 400);
      }
    }

    const updatedTag = await prisma.tag.update({
      where: { id: tagId },
      data: {
        ...(name && { name: name.trim() }),
        ...(color && { color }),
      },
      include: {
        _count: {
          select: { projects: true }
        }
      }
    });

    return apiSuccess({
      success: true,
      tag: {
        id: updatedTag.id,
        name: updatedTag.name,
        color: updatedTag.color,
        projectCount: updatedTag._count.projects,
        createdAt: updatedTag.createdAt.toISOString(),
      }
    });
  } catch (error) {
    console.error("Error updating tag:", error);
    return apiError(TAG_ERRORS.UPDATE_FAILED, 500);
  }
}

/**
 * DELETE /api/tags/[id] - Delete tag
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

    const { id: tagId } = await params;

    // Check whether the tag exists and belongs to the current user
    const tag = await prisma.tag.findUnique({
      where: { id: tagId },
    });

    if (!tag) {
      return apiError(TAG_ERRORS.NOT_FOUND, 404);
    }

    if (tag.userId !== session.user.id) {
      return apiError(TAG_ERRORS.NO_DELETE_PERMISSION, 403);
    }

    // Save tag name for analytics
    const tagName = tag.name;

    // Delete tag (related ProjectTag records will be removed via cascade)
    await prisma.tag.delete({
      where: { id: tagId },
    });

    return apiSuccess({
      success: true,
    });
  } catch (error) {
    console.error("Error deleting tag:", error);
    return apiError(TAG_ERRORS.DELETE_FAILED, 500);
  }
}
