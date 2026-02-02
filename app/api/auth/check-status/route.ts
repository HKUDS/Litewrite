import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AUTH_ERRORS, apiError } from "@/lib/api-errors";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/email";

/**
 * Get client IP address
 */
function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }
  return "unknown";
}

/**
 * POST /api/auth/check-status - Check user status (pre-login)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return apiError(AUTH_ERRORS.EMAIL_REQUIRED, 400);
    }

    // Rate limit check (by IP)
    const clientIp = getClientIp(request);
    const rateLimitResult = await checkRateLimit("login", clientIp, RATE_LIMITS.LOGIN);

    if (!rateLimitResult.allowed) {
      const retryAfter = rateLimitResult.lockoutRemaining || 60;
      return NextResponse.json(
        {
          error: {
            code: "auth.tooManyAttempts",
            message: `Too many login attempts. Please try again in ${retryAfter} seconds.`,
            retryAfter,
          }
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfter),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(rateLimitResult.resetTime),
          }
        }
      );
    }

    // Normalize email: lowercase + trim whitespace
    const normalizedEmail = normalizeEmail(email);

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        status: true,
        emailVerified: true,
      },
    });

    // Do not return specific info when user does not exist (avoid information leakage)
    if (!user) {
      return NextResponse.json({ ok: true });
    }

    // Check user status
    if (user.status === "disabled") {
      return apiError(AUTH_ERRORS.ACCOUNT_DISABLED, 403);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Check status error:", error);
    return apiError(AUTH_ERRORS.CHECK_FAILED, 500);
  }
}
