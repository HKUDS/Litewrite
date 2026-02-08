/**
 * Internal API: Create Project
 * =============================
 *
 * Internal endpoint for nanobot to create a new Litewrite project.
 *
 * This is NOT exposed to the public - protected by INTERNAL_API_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths } from "@/lib/storage";

// Verify internal API secret
function verifyInternalAuth(request: NextRequest): boolean {
  const secret = request.headers.get("X-Internal-Secret");
  const expectedSecret = process.env.INTERNAL_API_SECRET;

  if (!expectedSecret) {
    console.warn("[Internal API] INTERNAL_API_SECRET not configured");
    return false;
  }

  return secret === expectedSecret;
}

// Default LaTeX template
const DEFAULT_TEMPLATE = `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{graphicx}

\\title{%TITLE%}
\\author{Author}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}

Start writing here...

\\end{document}`;

export async function POST(request: NextRequest) {
  // Verify authentication
  if (!verifyInternalAuth(request)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { name, ownerId, description, mainFileContent } = body as {
      name: string;
      ownerId: string;
      description?: string;
      mainFileContent?: string;
    };

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({
        success: false,
        error: "name is required",
      });
    }

    if (!ownerId || typeof ownerId !== "string") {
      return NextResponse.json({
        success: false,
        error: "ownerId is required",
      });
    }

    const projectId = uuidv4();

    // Create database record
    const project = await prisma.project.create({
      data: {
        id: projectId,
        name: name.trim(),
        description: description?.trim() || null,
        mainFile: "main.tex",
        ownerId,
        visibility: "private",
        status: "active",
      },
    });

    // Create files via storage
    const storage = await getStorage();

    // Create main.tex (use provided content or default template)
    const mainTexContent =
      mainFileContent || DEFAULT_TEMPLATE.replace("%TITLE%", name.trim());
    const mainTexKey = StoragePaths.projectFile(projectId, "main.tex");
    await storage.upload(mainTexKey, mainTexContent, "text/x-tex");

    // Create project.json (metadata)
    const meta = {
      id: projectId,
      name: name.trim(),
      description: description?.trim() || undefined,
      mainFile: "main.tex",
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      template: "nanobot",
    };
    const metaKey = StoragePaths.projectFile(projectId, "project.json");
    await storage.upload(metaKey, JSON.stringify(meta, null, 2), "application/json");

    console.log(
      `[Internal/CreateProject] Created project: ${projectId} "${name.trim()}" for owner ${ownerId}`
    );

    return NextResponse.json({
      success: true,
      data: {
        id: project.id,
        name: project.name,
        description: project.description,
        mainFile: project.mainFile,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("[Internal/CreateProject] Error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
