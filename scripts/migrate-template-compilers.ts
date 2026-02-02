/**
 * Backfill Template.defaultCompiler for existing templates (production-safe).
 *
 * Key property: does NOT compile, does NOT upload template files, only reads main tex and updates DB.
 *
 * Usage:
 *   # Dry-run (default)
 *   npx tsx scripts/migrate-template-compilers.ts
 *   npx tsx scripts/migrate-template-compilers.ts --dry-run
 *
 *   # Apply updates
 *   npx tsx scripts/migrate-template-compilers.ts --apply
 *
 * Options:
 *   --limit 200        process at most N templates (for batching)
 *   --cursor <id>      start after Template.id (for resume)
 *   --source system    default: system
 */

import { PrismaClient } from "@prisma/client";
import { getStorage, StoragePaths } from "@/lib/storage";
import * as fs from "fs";
import * as path from "path";
import { Compiler, VALID_COMPILERS, inferTemplateCompilerFromTex } from "@/lib/compiler-utils";

function parseArgs(argv: string[]) {
  const out: {
    dryRun: boolean;
    apply: boolean;
    limit: number;
    cursor?: string;
    source: "system" | "user" | "all";
  } = {
    dryRun: true,
    apply: false,
    limit: Number.POSITIVE_INFINITY,
    source: "system",
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") {
      out.apply = true;
      out.dryRun = false;
      continue;
    }
    if (a === "--dry-run") {
      out.dryRun = true;
      out.apply = false;
      continue;
    }
    if (a === "--limit") {
      const v = argv[i + 1];
      if (v) {
        out.limit = Math.max(1, parseInt(v, 10));
        i++;
      }
      continue;
    }
    if (a === "--cursor") {
      const v = argv[i + 1];
      if (v) {
        out.cursor = v;
        i++;
      }
      continue;
    }
    if (a === "--source") {
      const v = argv[i + 1] as "system" | "user" | "all" | undefined;
      if (v === "system" || v === "user" || v === "all") {
        out.source = v;
        i++;
      }
      continue;
    }
  }

  return out;
}

async function main() {
  const { dryRun, apply, limit, cursor, source } = parseArgs(process.argv.slice(2));

  console.log("========================================");
  console.log("[migrate-template-compilers]");
  console.log(`  mode:   ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`  source: ${source}`);
  console.log(`  limit:  ${Number.isFinite(limit) ? limit : "∞"}`);
  if (cursor) console.log(`  cursor: ${cursor}`);
  console.log("========================================");

  const prisma = new PrismaClient();
  const storage = await getStorage();

  const where =
    source === "all" ? {} :
      { source };

  // Snapshot old values for rollback (only when applying)
  const snapshot: Array<{ id: string; filesPath: string; oldDefaultCompiler: string }> = [];
  const changes: Array<{ id: string; filesPath: string; mainFile: string; from: string; to: string }> = [];
  const errors: Array<{ id: string; filesPath: string; error: string }> = [];

  let processed = 0;
  let pageCursor: string | undefined = cursor;

  while (processed < limit) {
    const take = Math.min(200, limit - processed);
    const batch = await prisma.template.findMany({
      where,
      orderBy: { id: "asc" },
      take,
      ...(pageCursor ? { cursor: { id: pageCursor }, skip: 1 } : {}),
      select: {
        id: true,
        filesPath: true,
        mainFile: true,
        defaultCompiler: true,
        source: true,
      },
    });

    if (batch.length === 0) break;

    for (const t of batch) {
      processed++;
      pageCursor = t.id;

      try {
        const storageKey = StoragePaths.templateFile(t.filesPath, t.mainFile || "main.tex");
        const buf = await storage.download(storageKey);
        const tex = buf.toString("utf-8");

        const inferred = inferTemplateCompilerFromTex(tex);
        const current = (typeof t.defaultCompiler === "string" ? t.defaultCompiler : "pdflatex");
        const normalizedCurrent = VALID_COMPILERS.has(current as Compiler) ? current : "pdflatex";

        if (normalizedCurrent !== inferred) {
          changes.push({
            id: t.id,
            filesPath: t.filesPath,
            mainFile: t.mainFile,
            from: normalizedCurrent,
            to: inferred,
          });

          if (apply) {
            snapshot.push({ id: t.id, filesPath: t.filesPath, oldDefaultCompiler: normalizedCurrent });
            await prisma.template.update({
              where: { id: t.id },
              data: { defaultCompiler: inferred },
            });
          }
        }
      } catch (e) {
        errors.push({
          id: t.id,
          filesPath: t.filesPath,
          error: e instanceof Error ? e.message : String(e),
        });
      }

      if (processed >= limit) break;
    }
  }

  // Write snapshot (apply only)
  if (apply) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const outDir = path.join(process.cwd(), "tmp");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `template-compiler-snapshot-${ts}.json`);
    fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + "\n", "utf-8");
    console.log(`[migrate-template-compilers] Wrote rollback snapshot: ${outPath}`);
  }

  console.log("========================================");
  console.log("[migrate-template-compilers] Summary");
  console.log(`  processed: ${processed}`);
  console.log(`  changes:   ${changes.length}${apply ? " (applied)" : " (would apply)"}`);
  console.log(`  errors:    ${errors.length}`);

  if (changes.length) {
    console.log("  sample changes:");
    for (const c of changes.slice(0, 20)) {
      console.log(`    - ${c.filesPath} (${c.mainFile}): ${c.from} -> ${c.to}`);
    }
    if (changes.length > 20) console.log(`    ... (${changes.length - 20} more)`);
  }

  if (errors.length) {
    console.log("  sample errors:");
    for (const er of errors.slice(0, 20)) {
      console.log(`    - ${er.filesPath}: ${er.error}`);
    }
    if (errors.length > 20) console.log(`    ... (${errors.length - 20} more)`);
  }
  console.log("========================================");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
