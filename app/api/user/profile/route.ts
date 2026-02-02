import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AUTH_ERRORS, USER_ERRORS, GENERAL_ERRORS, apiError, apiSuccess } from "@/lib/api-errors";

/**
 * GET /api/user/profile - fetch the current user's profile.
 */
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        emailVerified: true,
        createdAt: true,
      },
    });

    if (!user) {
      return apiError(USER_ERRORS.NOT_FOUND, 404);
    }

    return apiSuccess({ user });
  } catch (error) {
    console.error("Error getting user profile:", error);
    return apiError(USER_ERRORS.PROFILE_FAILED, 500);
  }
}

/**
 * PUT /api/user/profile - update the current user's profile.
 * Body: { name?: string }
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const body = await request.json();
    const updateData: { name?: string } = {};

    if (typeof body.name === "string") {
      updateData.name = body.name.trim();
    }

    if (Object.keys(updateData).length === 0) {
      return apiError(GENERAL_ERRORS.NO_VALID_UPDATE_ITEMS, 400);
    }

    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
      },
    });

    return apiSuccess({ user });
  } catch (error) {
    console.error("Error updating user profile:", error);
    return apiError(USER_ERRORS.UPDATE_PROFILE_FAILED, 500);
  }
}
