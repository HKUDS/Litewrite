import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { v4 as uuidv4 } from "uuid";
import { getStorage, StoragePaths } from "@/lib/storage";
/**
 * POST /api/projects/[id]/copy - Copy a project.
 * - Requires project access (owner or collaborator)
 * - The copied project belongs to the current user
 * - The project name will be suffixed (provided by the frontend, i18n-friendly)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { id: projectId } = await params;

    // Read suffixes from request body (i18n-friendly)
    let suffix = "Copy";
    let suffixNumbered = "Copy {number}";
    try {
      const body = await request.json();
      if (body.suffix) suffix = body.suffix;
      if (body.suffixNumbered) suffixNumbered = body.suffixNumbered;
    } catch {
      // Use defaults when request body is empty
    }

    // Fetch source project
    const sourceProject = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        collaborators: true,
      },
    });

    if (!sourceProject) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    // Check access (owner or collaborator can copy)
    const isOwner = sourceProject.ownerId === session.user.id;
    const isCollaborator = sourceProject.collaborators.some(
      c => c.userId === session.user.id
    );

    if (!isOwner && !isCollaborator && sourceProject.visibility !== "public") {
      return NextResponse.json(
        { error: "Permission denied" },
        { status: 403 }
      );
    }

    // Generate a new project name (using suffix provided by frontend)
    let newName = `${sourceProject.name} (${suffix})`;

    // If a project with the same name already exists, add a numbered suffix
    const existingProjects = await prisma.project.findMany({
      where: {
        ownerId: session.user.id,
        name: {
          startsWith: sourceProject.name,
        },
      },
      select: { name: true },
    });

    const existingNames = existingProjects.map(p => p.name);
    let copyNumber = 1;
    while (existingNames.includes(newName)) {
      copyNumber++;
      // Use the numbered suffix template and replace the {number} placeholder
      const numberedSuffix = suffixNumbered.replace("{number}", String(copyNumber));
      newName = `${sourceProject.name} (${numberedSuffix})`;
    }

    // Create new project
    const newProjectId = uuidv4();
    const now = new Date();

    const newProject = await prisma.project.create({
      data: {
        id: newProjectId,
        name: newName,
        description: sourceProject.description,
        mainFile: sourceProject.mainFile,
        ownerId: session.user.id,
        visibility: "private", // Copied projects default to private
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    });

    // Copy files in storage
    const storage = await getStorage();
    const sourcePrefix = StoragePaths.projectPrefix(projectId);
    const targetPrefix = StoragePaths.projectPrefix(newProjectId);

    try {
      const files = await storage.list(sourcePrefix);

      for (const fileInfo of files) {
        const relativePath = fileInfo.key.replace(sourcePrefix, "");
        const targetKey = StoragePaths.projectFile(newProjectId, relativePath);

        // Copy file
        const content = await storage.download(fileInfo.key);

        // If this is project.json, update its metadata
        if (relativePath === "project.json") {
          try {
            const meta = JSON.parse(content.toString("utf8"));
        meta.id = newProjectId;
        meta.name = newName;
        meta.createdAt = now.toISOString();
        meta.updatedAt = now.toISOString();
            await storage.upload(targetKey, JSON.stringify(meta, null, 2), "application/json");
      } catch {
            // If parsing fails, copy as-is
            await storage.upload(targetKey, content);
      }
        } else {
          await storage.upload(targetKey, content);
        }
      }
    } catch (copyError) {
      console.error("Error copying project files:", copyError);
      // If file copy fails, delete the DB record that was just created
      try {
        await prisma.project.delete({
          where: { id: newProjectId },
        });
      } catch (deleteError) {
        console.error("Error cleaning up project after copy failure:", deleteError);
      }
      return NextResponse.json(
        { error: "Failed to copy project files" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      project: {
        id: newProject.id,
        name: newProject.name,
        description: newProject.description,
        status: newProject.status,
        createdAt: newProject.createdAt.toISOString(),
        updatedAt: newProject.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Error copying project:", error);
    return NextResponse.json(
      { error: "Failed to copy project" },
      { status: 500 }
    );
  }
}
