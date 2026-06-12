import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Command } from "commander";

import { loadConfig } from "../config.js";
import {
  createPromptPackageTemplate,
  exportPromptPackageToWalrus,
  fetchPromptPackage,
  loadPromptManifest,
  publishPromptPackage,
  renderPromptPackage
} from "../prompt.js";

export function createPromptCommand(): Command {
  const command = new Command("prompt");

  command
    .command("init")
    .description("Create a complete prompt package template")
    .argument("<directory>", "Directory to create")
    .option("--name <name>", "Prompt package name")
    .action(async (directory: string, options: { name?: string }) => {
      const outputPath = path.resolve(directory);
      const name = options.name ?? path.basename(outputPath);
      const files = createPromptPackageTemplate(name);

      await mkdir(outputPath, { recursive: true });
      for (const [filePath, content] of Object.entries(files)) {
        const targetPath = path.join(outputPath, filePath);
        await mkdir(path.dirname(targetPath), { recursive: true });
        await writeFile(targetPath, content);
      }

      process.stdout.write(`${outputPath}\n`);
    });

  command
    .command("pack")
    .description("Upload a prompt package directory to Walrus and print its manifest blob")
    .argument("<directory>", "Prompt package directory")
    .action(async (directory: string) => {
      const config = loadConfig();
      const result = await exportPromptPackageToWalrus(config, { packagePath: directory });
      process.stdout.write(
        `${JSON.stringify(
          {
            manifestBlobId: result.manifestBlobId,
            manifestObjectId: result.manifestObjectId,
            packageName: result.manifest.package.name,
            fileCount: result.manifest.fileCount
          },
          null,
          2
        )}\n`
      );
    });

  command
    .command("publish")
    .description("Upload a prompt package and update a prompt ref on Sui")
    .argument("<directory>", "Prompt package directory")
    .option("--repo <objectId>", "Override repo object ID")
    .option("--ref <refName>", "Prompt ref to update", "refs/prompts/main")
    .action(async (directory: string, options: { repo?: string; ref: string }) => {
      const config = loadConfig();
      const repoObjectId = options.repo ?? config.SUI_REPO_OBJECT_ID;
      if (!repoObjectId) {
        throw new Error("Missing repo object ID. Pass --repo or set SUI_REPO_OBJECT_ID.");
      }

      const result = await publishPromptPackage(config, {
        repoObjectId,
        packagePath: directory,
        refName: options.ref
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    });

  command
    .command("fetch")
    .description("Download a prompt package from a Sui prompt ref")
    .requiredOption("--out <directory>", "Output directory")
    .option("--repo <objectId>", "Override repo object ID")
    .option("--ref <refName>", "Prompt ref to fetch", "refs/prompts/main")
    .action(async (options: { out: string; repo?: string; ref: string }) => {
      const config = loadConfig();
      const repoObjectId = options.repo ?? config.SUI_REPO_OBJECT_ID;
      if (!repoObjectId) {
        throw new Error("Missing repo object ID. Pass --repo or set SUI_REPO_OBJECT_ID.");
      }

      const result = await fetchPromptPackage(config, {
        repoObjectId,
        refName: options.ref,
        outputPath: options.out
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    });

  command
    .command("render")
    .description("Render a complete agent prompt from a prompt package ref")
    .option("--repo <objectId>", "Override repo object ID")
    .option("--ref <refName>", "Prompt ref to render", "refs/prompts/main")
    .option("--var <key=value...>", "Prompt variable values", collectValues, [])
    .action(async (options: { repo?: string; ref: string; var: string[] }) => {
      const config = loadConfig();
      const repoObjectId = options.repo ?? config.SUI_REPO_OBJECT_ID;
      if (!repoObjectId) {
        throw new Error("Missing repo object ID. Pass --repo or set SUI_REPO_OBJECT_ID.");
      }

      const result = await renderPromptPackage(config, {
        repoObjectId,
        refName: options.ref,
        variables: parseVariables(options.var)
      });
      process.stdout.write(result.rendered);
    });

  command
    .command("show")
    .description("Read and print a prompt manifest by Walrus blob ID")
    .argument("<manifestBlobId>", "Prompt manifest blob ID")
    .action(async (manifestBlobId: string) => {
      const config = loadConfig();
      const manifest = await loadPromptManifest(config, manifestBlobId);
      process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    });

  return command;
}

function collectValues(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function parseVariables(values: string[]): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const value of values) {
    const separator = value.indexOf("=");
    if (separator < 1) {
      throw new Error(`Invalid --var value, expected key=value: ${value}`);
    }
    variables[value.slice(0, separator)] = value.slice(separator + 1);
  }
  return variables;
}
