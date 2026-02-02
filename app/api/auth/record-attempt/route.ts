import { NextRequest, NextResponse } from "next/server";
import { recordAttempt, RATE_LIMITS } from "@/lib/rate-limit";

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
 * POST /api/auth/record-attempt - Record login attempt result
 *
 * Used to record the result (success/failure) after NextAuth completes.
 * This allows us to use Redis in Node.js Runtime and avoid Edge Runtime compatibility issues.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { success } = body;

    const clientIp = getClientIp(request);

    // Record attempt result
    await recordAttempt("login", clientIp, RATE_LIMITS.LOGIN, success === true);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Record attempt error:", error);
    // Return success even if recording fails; do not block login flow
    return NextResponse.json({ ok: true });
  }
}
