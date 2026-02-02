import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { AUTH_ERRORS, PASSWORD_ERRORS, apiError, apiSuccess } from "@/lib/api-errors";

// Ensure Node.js runtime (do not use Edge Runtime)
// bcryptjs requires Node.js APIs and does not support Edge Runtime
export const runtime = "nodejs";

/**
 * PUT /api/user/password - Change password
 * Body: { currentPassword: string, newPassword: string }
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const body = await request.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return apiError(PASSWORD_ERRORS.FILL_BOTH_PASSWORDS, 400);
    }

    if (newPassword.length < 6) {
      return apiError(PASSWORD_ERRORS.NEW_PASSWORD_TOO_SHORT, 400);
    }

    // Fetch current password hash
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { password: true },
    });

    // Verify current password
    const isValid = !!user?.password && await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      return apiError(PASSWORD_ERRORS.CURRENT_PASSWORD_WRONG, 400);
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await prisma.user.update({
      where: { id: session.user.id },
      data: { password: hashedPassword },
    });

    return apiSuccess({ success: true });
  } catch (error) {
    console.error("Error updating password:", error);
    return apiError(PASSWORD_ERRORS.CHANGE_FAILED, 500);
  }
}
