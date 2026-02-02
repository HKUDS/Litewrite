import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AUTH_ERRORS, USER_ERRORS, LINKED_ACCOUNTS_ERRORS, apiError, apiSuccess } from "@/lib/api-errors";

/**
 * GET /api/user/linked-accounts - List linked accounts
 */
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    // Fetch user info and linked accounts
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        password: true,
        accounts: {
          select: {
            provider: true,
            providerAccountId: true,
          },
        },
      },
    });

    if (!user) {
      return apiError(USER_ERRORS.NOT_FOUND, 404);
    }

    return apiSuccess({
      accounts: user.accounts,
      hasPassword: !!user.password,
    });
  } catch (error) {
    console.error("Error getting linked accounts:", error);
    return apiError(LINKED_ACCOUNTS_ERRORS.GET_FAILED, 500);
  }
}

/**
 * DELETE /api/user/linked-accounts?provider=xxx - Unlink an account
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");

    if (!provider) {
      return apiError(LINKED_ACCOUNTS_ERRORS.SPECIFY_ACCOUNT, 400);
    }

    // Ensure user has another login method (password or another linked account)
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: {
        accounts: true,
      },
    });

    if (!user) {
      return apiError(USER_ERRORS.NOT_FOUND, 404);
    }

    // If there is no password and only one linked account, do not allow unlinking
    if (!user.password && user.accounts.length <= 1) {
      return apiError(LINKED_ACCOUNTS_ERRORS.ONLY_LOGIN_METHOD, 400);
    }

    // Delete linked account
    await prisma.account.deleteMany({
      where: {
        userId: session.user.id,
        provider,
      },
    });

    return apiSuccess({ success: true });
  } catch (error) {
    console.error("Error unlinking account:", error);
    return apiError(LINKED_ACCOUNTS_ERRORS.UNLINK_FAILED, 500);
  }
}
