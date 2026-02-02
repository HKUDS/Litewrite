import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths, getStorageConfig } from "@/lib/storage";
import { AUTH_ERRORS, AVATAR_ERRORS, FILE_ERRORS, apiError, apiSuccess } from "@/lib/api-errors";

// Allowed image MIME types
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_SIZE = 2 * 1024 * 1024; // 2MB

// MIME type to extension mapping
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

/**
 * POST /api/user/avatar - Upload avatar.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const formData = await request.formData();
    const file = formData.get("avatar") as File | null;

    if (!file) {
      return apiError(AVATAR_ERRORS.SELECT_FILE, 400);
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return apiError(AVATAR_ERRORS.UNSUPPORTED_FORMAT, 400);
    }

    // Validate file size
    if (file.size > MAX_SIZE) {
      return apiError(FILE_ERRORS.SIZE_TOO_LARGE, 400);
    }

    // Get file extension
    const ext = MIME_TO_EXT[file.type] || "jpg";

    // Read file contents
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Upload to storage
    const storage = await getStorage();
    const key = StoragePaths.avatar(session.user.id, ext);

    // Delete old avatars with other extensions to avoid GET returning stale files
    const allExtensions = ["jpg", "png", "gif", "webp"];
    const deletePromises = allExtensions
      .filter((e) => e !== ext)
      .map((e) => {
        const oldKey = StoragePaths.avatar(session.user.id, e);
        return storage.delete(oldKey).catch(() => {
          // Ignore delete failures (file may not exist)
        });
      });
    await Promise.all(deletePromises);

    await storage.upload(key, buffer, file.type);

    // Generate avatar URL
    const config = getStorageConfig();
    let imageUrl: string;

    if (config.provider === "s3") {
      // S3 storage: use API route or signed URL
      // We use the API route here for consistency
      imageUrl = `/api/user/avatar/${session.user.id}?t=${Date.now()}`;
    } else {
      // Local storage: use the same API route path
      imageUrl = `/api/user/avatar/${session.user.id}?t=${Date.now()}`;
    }

    // Update user's avatar URL
    await prisma.user.update({
      where: { id: session.user.id },
      data: { image: imageUrl },
    });

    return apiSuccess({ image: imageUrl });
  } catch (error) {
    console.error("Error uploading avatar:", error);
    return apiError(AVATAR_ERRORS.UPLOAD_FAILED, 500);
  }
}

/**
 * GET /api/user/avatar - Get current user's avatar.
 */
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const storage = await getStorage();

    // Try different extensions
    const extensions = ["jpg", "png", "gif", "webp"];
    let avatarBuffer: Buffer | null = null;
    let contentType = "image/jpeg";

    for (const ext of extensions) {
      const key = StoragePaths.avatar(session.user.id, ext);
      if (await storage.exists(key)) {
        avatarBuffer = await storage.download(key);
        contentType = `image/${ext === "jpg" ? "jpeg" : ext}`;
        break;
      }
    }

    if (!avatarBuffer) {
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
