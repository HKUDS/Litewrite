import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ApiErrorCodes, apiError } from "@/lib/api-errors";
import { normalizeEmail } from "@/lib/email";

// Ensure Node.js runtime (bcryptjs requires it)
export const runtime = "nodejs";

/**
 * POST /api/auth/register - Create a credentials user.
 *
 * OSS variant:
 * - No invite codes
 * - No email blacklist checks
 * - No email verification
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, name } = body ?? {};

    if (!email || !password) {
      return apiError(ApiErrorCodes.AUTH_EMAIL_AND_PASSWORD_REQUIRED, 400);
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return apiError(ApiErrorCodes.AUTH_INVALID_EMAIL, 400);
    }

    const normalizedEmail = normalizeEmail(email);

    if (typeof password !== "string" || password.length < 6) {
      return apiError(ApiErrorCodes.AUTH_PASSWORD_TOO_SHORT, 400);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    let user;
    try {
      user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          password: hashedPassword,
          name:
            typeof name === "string" && name.trim()
              ? name.trim()
              : normalizedEmail.split("@")[0],
          emailVerified: new Date(),
        },
        select: { id: true, email: true, name: true },
      });
    } catch (e: any) {
      // Prisma unique constraint
      if (e?.code === "P2002") {
        return apiError(ApiErrorCodes.AUTH_EMAIL_ALREADY_REGISTERED, 400);
      }
      throw e;
    }

    return NextResponse.json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("Register error:", error);
    return apiError(ApiErrorCodes.AUTH_REGISTER_FAILED, 500);
  }
}
