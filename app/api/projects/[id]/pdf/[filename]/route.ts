import { NextRequest, NextResponse } from "next/server";
import { getStorage, StoragePaths } from "@/lib/storage";

/**
 * GET /api/projects/[id]/pdf/[filename] - fetch a compiled PDF file.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; filename: string }> }
) {
  try {
    const { id: projectId, filename } = await params;

    // Security check: ensure the filename is valid.
    if (!filename || filename.includes("..") || !filename.endsWith(".pdf")) {
      return NextResponse.json(
        { error: "Invalid filename" },
        { status: 400 }
      );
    }

    const storage = await getStorage();
    const key = StoragePaths.compiledFile(projectId, filename);

    // Check whether the file exists.
    const exists = await storage.exists(key);
    if (!exists) {
      return NextResponse.json(
        { error: "PDF not found" },
        { status: 404 }
      );
    }

    // Read and return the PDF file.
    const pdfBuffer = await storage.download(key);

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": pdfBuffer.length.toString(),
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("[PDF API] Error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve PDF" },
      { status: 500 }
    );
  }
}
