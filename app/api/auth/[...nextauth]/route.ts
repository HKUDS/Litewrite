import { handlers } from "@/lib/auth";

// Ensure we use the Node.js runtime (not Edge Runtime).
// bcryptjs relies on Node.js APIs and does not support Edge Runtime.
export const runtime = "nodejs";

export const { GET, POST } = handlers;
