import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths, getMimeType } from "@/lib/storage";
import { apiError, AUTH_ERRORS, FILE_ERRORS, PROJECT_ERRORS } from "@/lib/api-errors";

/**
 * POST /api/projects/[id]/files/upload - Upload files to a project.
 *
 * Request format: multipart/form-data
 * - files: uploaded files (supports multiple)
 * - parentPath: target directory path (optional; defaults to project root)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const { id: projectId } = await params;

    // Validate project access
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { ownerId: session.user.id },
          { collaborators: { some: { userId: session.user.id } } },
        ],
      },
    });

    if (!project) {
      return apiError(PROJECT_ERRORS.NO_ACCESS, 404);
    }

    // Parse FormData
    const formData = await request.formData();
    const parentPath = (formData.get("parentPath") as string) || "";
    const files = formData.getAll("files") as File[];

    if (!files || files.length === 0) {
      return apiError(FILE_ERRORS.SELECT_FILES_TO_UPLOAD, 400);
    }

    // Security: validate parentPath to prevent path traversal
    if (parentPath.includes("..") || parentPath.startsWith("/")) {
      return apiError(FILE_ERRORS.INVALID_PATH, 400);
    }

    const storage = await getStorage();
    const uploadedFiles: string[] = [];
    const errors: string[] = [];

    for (const file of files) {
      try {
        const fileName = file.name;

        // Security: prevent path traversal
        if (fileName.includes("..") || fileName.startsWith("/")) {
          errors.push(`Invalid filename: ${fileName}`);
          continue;
        }

        // Build storage path
        const filePath = parentPath ? `${parentPath}/${fileName}` : fileName;
        const key = StoragePaths.projectFile(projectId, filePath);

        // Read file contents
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Upload to storage
        await storage.upload(key, buffer, getMimeType(fileName));
        uploadedFiles.push(fileName);
      } catch (err) {
        console.error(`Error uploading file ${file.name}:`, err);
        errors.push(`Upload failed: ${file.name}`);
      }
    }

    // Update project's updatedAt timestamp
    await prisma.project.update({
      where: { id: projectId },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json({
      success: true,
      uploadedFiles,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Error uploading files:", error);
    return apiError(FILE_ERRORS.UPLOAD_FAILED, 500);
  }
}
