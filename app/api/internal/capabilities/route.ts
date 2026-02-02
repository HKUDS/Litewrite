import { NextResponse } from "next/server";
import { getServerCapabilities } from "@/lib/capabilities";

/**
 * GET /api/internal/capabilities
 *
 * Exposes a minimal, safe set of feature capability flags to the frontend.
 * No secrets are returned.
 */
export async function GET() {
  const caps = getServerCapabilities();
  return NextResponse.json({
    aiEnabled: caps.aiEnabled,
    aiReason: caps.aiReason,
    deepResearchEnabled: caps.deepResearchEnabled,
    deepResearchReason: caps.deepResearchReason,
    redisEnabled: caps.redisEnabled,
    storage: caps.storage,
  });
}
