import { NextRequest, NextResponse } from "next/server";
import { getStorage, StoragePaths } from "@/lib/storage";
import { USER_ERRORS, AVATAR_ERRORS, apiError } from "@/lib/api-errors";

/**
 * GET /api/user/avatar/[userId] - fetch the specified user's avatar.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;

    if (!userId) {
      return apiError(USER_ERRORS.INVALID_ID, 400);
    }

    const storage = await getStorage();

    // Try different file extensions.
    const extensions = ["jpg", "png", "gif", "webp"];
    let avatarBuffer: Buffer | null = null;
    let contentType = "image/jpeg";

    for (const ext of extensions) {
      const key = StoragePaths.avatar(userId, ext);
      if (await storage.exists(key)) {
        avatarBuffer = await storage.download(key);
        contentType = `image/${ext === "jpg" ? "jpeg" : ext}`;
        break;
      }
    }

    if (!avatarBuffer) {
      // Return default avatar (or 404).
      return apiError(AVATAR_ERRORS.NOT_FOUND, 404);
    }

    return new NextResponse(new Uint8Array(avatarBuffer), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("Error getting avatar:", error);
    return apiError(AVATAR_ERRORS.GET_FAILED, 500);
  }
}
