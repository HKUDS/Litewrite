/**
 * Template seeding script (deprecated).
 *
 * ⚠️ Note: This script only creates database records and does not upload files to S3.
 *
 * For S3 storage, use the API endpoint:
 *   POST /api/templates/seed (admin)
 *
 * This API will:
 * 1. Read the local templates/ directory
 * 2. Upload all template files to S3
 * 3. Create/update database records
 *
 * This script is only intended for development environments using local storage
 * (STORAGE_PROVIDER=local).
 *
 * @deprecated Use the /api/templates/seed API instead.
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

interface TemplateConfig {
  name: string;
  description: string;
  category: string;
  tags: string;
  license: string;
  authorName: string;
  authorUrl: string;
  mainFile: string;
  source: string;
}

async function seedTemplates() {
  const templatesDir = path.join(process.cwd(), "templates");

  // Check whether templates directory exists
  if (!fs.existsSync(templatesDir)) {
    console.log("No templates directory found. Skipping seed.");
    return;
  }

  const templateFolders = fs.readdirSync(templatesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  console.log(`Found ${templateFolders.length} template folders`);

  for (const folder of templateFolders) {
    const templatePath = path.join(templatesDir, folder);
    const configPath = path.join(templatePath, "template.json");

    // Check whether template.json exists
    if (!fs.existsSync(configPath)) {
      console.log(`Skipping ${folder}: no template.json found`);
      continue;
    }

    try {
      const configContent = fs.readFileSync(configPath, "utf-8");
      const config: TemplateConfig = JSON.parse(configContent);

      // Check whether template already exists (by filesPath)
      const existingTemplate = await prisma.template.findFirst({
        where: { filesPath: folder },
      });

      // Check whether preview image exists
      const previewPath = path.join(process.cwd(), "public", "template-previews", `${folder}.png`);
      const thumbnailUrl = fs.existsSync(previewPath) ? `/template-previews/${folder}.png` : null;

      if (existingTemplate) {
        // Update existing template
        await prisma.template.update({
          where: { id: existingTemplate.id },
          data: {
            name: config.name,
            description: config.description,
            category: config.category,
            tags: config.tags,
            license: config.license,
            authorName: config.authorName,
            authorUrl: config.authorUrl,
            mainFile: config.mainFile,
            source: config.source || "system",
            thumbnailUrl,
          },
        });
        console.log(`Updated template: ${config.name}${thumbnailUrl ? ' (with preview)' : ''}`);
      } else {
        // Create new template
        await prisma.template.create({
          data: {
            name: config.name,
            description: config.description,
            category: config.category,
            tags: config.tags,
            license: config.license,
            authorName: config.authorName,
            authorUrl: config.authorUrl,
            mainFile: config.mainFile,
            filesPath: folder,
            source: config.source || "system",
            isPublic: true,
            thumbnailUrl,
          },
        });
        console.log(`Created template: ${config.name}${thumbnailUrl ? ' (with preview)' : ''}`);
      }
    } catch (error) {
      console.error(`Error processing ${folder}:`, error);
    }
  }

  console.log("Template seeding completed!");
}

// Run the script directly
seedTemplates()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { seedTemplates };
