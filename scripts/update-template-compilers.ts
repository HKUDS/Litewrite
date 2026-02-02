/**
 * Update local template.json files (templates/<template>/template.json) with inferred compiler.
 *
 * Usage:
 *   npx tsx scripts/update-template-compilers.ts
 *   npx tsx scripts/update-template-compilers.ts --check
 *
 * - Writes `compiler` field into each template.json (idempotent).
 * - Does NOT touch S3/DB.
 */

import * as fs from "fs";
import * as path from "path";
import { Compiler, VALID_COMPILERS, inferTemplateCompilerFromTex } from "@/lib/compiler-utils";

function parseArgs(argv: string[]) {
  return {
    check: argv.includes("--check"),
  };
}

async function main() {
  const { check } = parseArgs(process.argv.slice(2));
  const templatesDir = path.join(process.cwd(), "templates");

  if (!fs.existsSync(templatesDir)) {
    console.error(`[update-template-compilers] templates/ not found at ${templatesDir}`);
    process.exit(1);
  }

  const folders = fs.readdirSync(templatesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  const problems: string[] = [];

  for (const folder of folders) {
    const templatePath = path.join(templatesDir, folder);
    const configPath = path.join(templatePath, "template.json");
    if (!fs.existsSync(configPath)) {
      skipped++;
      continue;
    }

    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;
      const mainFile = (typeof config.mainFile === "string" && config.mainFile) ? config.mainFile : "main.tex";
      const mainPath = path.join(templatePath, mainFile);

      if (!fs.existsSync(mainPath)) {
        problems.push(`${folder}: main file not found (${mainFile})`);
        skipped++;
        continue;
      }

      const texContent = fs.readFileSync(mainPath, "utf-8");
      const inferred = inferTemplateCompilerFromTex(texContent);

      const existing = (typeof config.compiler === "string" ? config.compiler : undefined) as Compiler | undefined;
      const nextCompiler: Compiler = (existing && VALID_COMPILERS.has(existing)) ? existing : inferred;

      const shouldWrite = existing !== nextCompiler;
      if (shouldWrite) {
        if (check) {
          updated++;
          continue;
        }
        config.compiler = nextCompiler;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
        updated++;
      } else {
        unchanged++;
      }
    } catch (e) {
      problems.push(`${folder}: ${e instanceof Error ? e.message : String(e)}`);
      skipped++;
    }
  }

  console.log("========================================");
  console.log("[update-template-compilers] Done");
  console.log(`  updated:   ${updated}${check ? " (would update)" : ""}`);
  console.log(`  unchanged: ${unchanged}`);
  console.log(`  skipped:   ${skipped}`);
  if (problems.length) {
    console.log("  problems:");
    for (const p of problems.slice(0, 50)) console.log(`    - ${p}`);
    if (problems.length > 50) console.log(`    ... (${problems.length - 50} more)`);
  }
  console.log("========================================");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
