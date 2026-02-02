import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths } from "@/lib/storage";
import { apiError, AUTH_ERRORS, PROJECT_ERRORS } from "@/lib/api-errors";

// Default LaTeX template - Chinese (ctex)
const DEFAULT_TEMPLATE_ZH = `\\documentclass{article}
\\usepackage{ctex}
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

// Default LaTeX template - English
const DEFAULT_TEMPLATE_EN = `\\documentclass{article}
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

// Get default template by locale
function getDefaultTemplate(locale: string): string {
  return locale === "zh" ? DEFAULT_TEMPLATE_ZH : DEFAULT_TEMPLATE_EN;
}

/**
 * GET /api/projects - Get project list.
 *
 * Query params:
 * - filter: "all" | "owned" | "shared" | "archived" | "trashed"
 * - search: search keyword
 * - sort: "name" | "updatedAt" | "createdAt"
 * - order: "asc" | "desc"
 * - page: page number (starting from 1)
 * - limit: page size
 * - tag: tag ID
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    // Return an empty list for unauthenticated users
    if (!session?.user?.id) {
      return NextResponse.json({ projects: [], total: 0, page: 1, limit: 20 });
    }

    const { searchParams } = new URL(request.url);
    const filter = searchParams.get("filter") || "all";
    const search = searchParams.get("search") || "";
    const sort = searchParams.get("sort") || "updatedAt";
    const order = searchParams.get("order") || "desc";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const tagId = searchParams.get("tag");

    // Build where condition
    // eslint-disable-next-line
    const where: any = {};

    // Build base conditions based on filter
    switch (filter) {
      case "owned":
        where.ownerId = session.user.id;
        where.status = "active";
        break;
      case "shared":
        where.collaborators = { some: { userId: session.user.id } };
        where.status = "active";
        break;
      case "archived":
        where.ownerId = session.user.id;
        where.status = "archived";
        break;
      case "trashed":
        where.ownerId = session.user.id;
        where.status = "trashed";
        break;
      case "all":
      default:
        where.OR = [
          { ownerId: session.user.id },
          { collaborators: { some: { userId: session.user.id } } },
        ];
        where.status = { not: "trashed" };
        break;
    }

    // Search conditions
    if (search) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { name: { contains: search } },
            { description: { contains: search } },
          ],
        },
      ];
    }

    // Tag filter
    if (tagId) {
      where.tags = { some: { tagId } };
    }

    // Build ordering
    // eslint-disable-next-line
    let orderBy: any;
    switch (sort) {
      case "name":
        orderBy = { name: order };
        break;
      case "createdAt":
        orderBy = { createdAt: order };
        break;
      case "updatedAt":
      default:
        orderBy = { updatedAt: order };
        break;
    }

    // Get total count
    const total = await prisma.project.count({ where });

    // Fetch project list
    const dbProjects = await prisma.project.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        collaborators: {
          select: {
            user: { select: { id: true, name: true, email: true } },
            role: true
          }
        },
        tags: {
          include: {
            tag: { select: { id: true, name: true, color: true } }
          }
        },
      },
    });

    const projects = dbProjects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      visibility: p.visibility,
      status: p.status || "active",
      updatedAt: p.updatedAt.toISOString(),
      createdAt: p.createdAt.toISOString(),
      trashedAt: p.trashedAt?.toISOString() || null,
      isOwner: p.ownerId === session.user.id,
      owner: p.owner,
      collaboratorCount: p.collaborators.length,
      collaborators: p.collaborators.map(c => ({
        id: c.user.id,
        name: c.user.name,
        email: c.user.email,
        role: c.role,
      })),
      tags: (p.tags || []).map(t => ({
        id: t.tag.id,
        name: t.tag.name,
        color: t.tag.color,
      })),
    }));

    return NextResponse.json({
      projects,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Error getting projects:", error);
    return apiError(PROJECT_ERRORS.LIST_FAILED, 500);
  }
}

/**
 * POST /api/projects - Create a new project.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const body = await request.json();
    const { name, description, template, locale = "en" } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return apiError(PROJECT_ERRORS.NAME_REQUIRED, 400);
    }

    const projectId = uuidv4();

    // Create database record
    const project = await prisma.project.create({
      data: {
        id: projectId,
        name: name.trim(),
        description: description?.trim() || null,
        mainFile: "main.tex",
        ownerId: session.user.id,
        visibility: "private",
        status: "active",
      },
    });

    // Create files via the storage abstraction
    const storage = await getStorage();

    // Create default main.tex (choose template based on user locale)
    const mainTexContent = getDefaultTemplate(locale).replace("%TITLE%", name.trim());
    const mainTexKey = StoragePaths.projectFile(projectId, "main.tex");
    await storage.upload(mainTexKey, mainTexContent, "text/x-tex");

    // Create project.json (metadata backup)
    const meta = {
      id: projectId,
      name: name.trim(),
      description: description?.trim() || undefined,
      mainFile: "main.tex",
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      template: template || "blank",
    };
    const metaKey = StoragePaths.projectFile(projectId, "project.json");
    await storage.upload(metaKey, JSON.stringify(meta, null, 2), "application/json");

    return NextResponse.json({
      success: true,
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        visibility: project.visibility,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      }
    });
  } catch (error) {
    console.error("Error creating project:", error);
    return apiError(PROJECT_ERRORS.CREATE_FAILED, 500);
  }
}
