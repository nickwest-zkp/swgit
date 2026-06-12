import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AppConfig } from "./config.js";
import { getRepoDetails, waitForRefVisibility } from "./repository.js";
import { createSigner, createSuiClient, updateRepoRef } from "./sui.js";
import type {
  PromptFetchResult,
  PromptManifest,
  PromptManifestFile,
  PromptPackageSpec,
  PromptPublishResult,
  PromptRenderResult
} from "./types.js";
import { readBlob, storeBlob } from "./walrus.js";

const defaultPromptRef = "refs/prompts/main";
const manifestFileName = "manifest.json";

export async function exportPromptPackageToWalrus(
  config: AppConfig,
  input: { packagePath: string }
): Promise<{
  manifest: PromptManifest;
  manifestBlobId: string;
  manifestObjectId?: string;
}> {
  const packagePath = path.resolve(input.packagePath);
  const spec = await readPromptPackageSpec(packagePath);
  const filePaths = await listPromptPackageFiles(packagePath);
  const files: PromptManifestFile[] = [];

  for (const relativePath of filePaths) {
    const fullPath = path.join(packagePath, relativePath);
    const bytes = new Uint8Array(await readFile(fullPath));
    const stored = await storeBlob(config, bytes);
    files.push({
      path: normalizePath(relativePath),
      size: bytes.byteLength,
      sha256: sha256(bytes),
      blobId: stored.blobId,
      objectId: stored.objectId
    });
  }

  const manifest: PromptManifest = {
    kind: "swgit-prompt-manifest",
    version: 1,
    package: spec,
    packagePath,
    exportedAt: new Date().toISOString(),
    fileCount: files.length,
    files
  };
  const manifestBytes = encodePromptManifest(manifest);
  const manifestStored = await storeBlob(config, manifestBytes);

  return {
    manifest,
    manifestBlobId: manifestStored.blobId,
    manifestObjectId: manifestStored.objectId
  };
}

export async function publishPromptPackage(
  config: AppConfig,
  input: {
    repoObjectId: string;
    packagePath: string;
    refName?: string;
    writeRef?: boolean;
  }
): Promise<PromptPublishResult> {
  const exported = await exportPromptPackageToWalrus(config, { packagePath: input.packagePath });
  const refName = input.refName ?? defaultPromptRef;
  let digest: string | undefined;

  if (input.writeRef ?? true) {
    const client = createSuiClient(config);
    const signer = createSigner(config);
    digest = await updateRepoRef(client, signer, config, {
      repoObjectId: input.repoObjectId,
      refName,
      blobId: exported.manifestBlobId
    });
    await waitForRefVisibility(client, input.repoObjectId, refName, exported.manifestBlobId);
  }

  return {
    repoObjectId: input.repoObjectId,
    refName,
    manifestBlobId: exported.manifestBlobId,
    manifestObjectId: exported.manifestObjectId,
    packageName: exported.manifest.package.name,
    fileCount: exported.manifest.fileCount,
    digest
  };
}

export async function fetchPromptPackage(
  config: AppConfig,
  input: {
    repoObjectId: string;
    refName?: string;
    outputPath: string;
  }
): Promise<PromptFetchResult> {
  const refName = input.refName ?? defaultPromptRef;
  const manifestBlobId = await resolvePromptManifestBlobId(config, input.repoObjectId, refName);
  const manifest = await loadPromptManifest(config, manifestBlobId);
  const outputPath = path.resolve(input.outputPath);

  await mkdir(outputPath, { recursive: true });
  for (const file of manifest.files) {
    const bytes = await readBlob(config, file.blobId);
    const actualHash = sha256(bytes);
    if (actualHash !== file.sha256) {
      throw new Error(`Prompt file hash mismatch for ${file.path}`);
    }

    const targetPath = path.join(outputPath, file.path);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, bytes);
  }

  return {
    repoObjectId: input.repoObjectId,
    refName,
    manifestBlobId,
    packageName: manifest.package.name,
    outputPath,
    fileCount: manifest.fileCount
  };
}

export async function renderPromptPackage(
  config: AppConfig,
  input: {
    repoObjectId: string;
    refName?: string;
    variables?: Record<string, string>;
  }
): Promise<PromptRenderResult> {
  const refName = input.refName ?? defaultPromptRef;
  const manifestBlobId = await resolvePromptManifestBlobId(config, input.repoObjectId, refName);
  const manifest = await loadPromptManifest(config, manifestBlobId);
  const fileContents = await loadPromptFiles(config, manifest);
  const rendered = renderPromptManifest(manifest, fileContents, input.variables ?? {});

  return {
    repoObjectId: input.repoObjectId,
    refName,
    manifestBlobId,
    packageName: manifest.package.name,
    rendered
  };
}

export async function loadPromptManifest(config: AppConfig, manifestBlobId: string): Promise<PromptManifest> {
  return parsePromptManifest(await readBlob(config, manifestBlobId));
}

export function encodePromptManifest(manifest: PromptManifest): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(manifest, null, 2));
}

export function parsePromptManifest(bytes: Uint8Array): PromptManifest {
  const manifest = JSON.parse(Buffer.from(bytes).toString("utf8")) as PromptManifest;
  if (manifest.kind !== "swgit-prompt-manifest" || manifest.version !== 1 || !Array.isArray(manifest.files)) {
    throw new Error("Blob does not contain a valid swgit prompt manifest");
  }
  return manifest;
}

export function createPromptPackageTemplate(name: string): Record<string, string> {
  const spec: PromptPackageSpec = {
    kind: "swgit-prompt-package",
    version: 1,
    name,
    description: "Generate a complete software project from a complete prompt package.",
    modelHints: ["gpt-5"],
    variables: [
      {
        name: "app_name",
        required: true,
        description: "Application name to use in generated files."
      },
      {
        name: "stack",
        required: true,
        description: "Implementation stack, for example Next.js + SQLite."
      }
    ],
    entrypoints: {
      system: "system.md",
      developer: "developer.md",
      task: "task.md"
    },
    requiredOutputs: ["complete file tree", "all source files", "install command", "build command", "test command"],
    acceptanceChecks: ["No placeholders or omitted implementations", "Every file in file-tree.md is emitted"]
  };

  return {
    [manifestFileName]: `${JSON.stringify(spec, null, 2)}\n`,
    "system.md": "You are a coding agent that outputs complete, runnable software projects.\n",
    "developer.md":
      "Follow the requested stack exactly. Prefer simple, maintainable architecture. Do not omit files or implementation details.\n",
    "task.md": "Create {{app_name}} using {{stack}}. The generated project must satisfy every acceptance check.\n",
    "architecture.md": "Describe the main modules, data flow, and persistence choices before generating files.\n",
    "file-tree.md": "List the complete file tree that must be generated.\n",
    "output-format.md":
      "Emit every file with this exact format:\n\n```file path/to/file.ext\n<complete file content>\n```\n\nAfter all files, include install, dev, build, and test commands.\n",
    "acceptance.md": "The project installs, builds, and contains no placeholder code.\n",
    "test-plan.md": "Provide the exact commands that verify the generated project.\n",
    "self-check.md": "Before final output, check that every required file is present and every required output is included.\n"
  };
}

async function readPromptPackageSpec(packagePath: string): Promise<PromptPackageSpec> {
  const manifestPath = path.join(packagePath, manifestFileName);
  const spec = JSON.parse(await readFile(manifestPath, "utf8")) as PromptPackageSpec;
  if (spec.kind !== "swgit-prompt-package" || spec.version !== 1 || !spec.name) {
    throw new Error(`${manifestFileName} must be a swgit-prompt-package v1 with a name`);
  }
  return spec;
}

async function listPromptPackageFiles(packagePath: string): Promise<string[]> {
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".DS_Store") {
        continue;
      }

      const fullPath = path.join(directory, entry.name);
      const relativePath = path.relative(packagePath, fullPath);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }

  await visit(packagePath);
  return files.sort((left, right) => normalizePath(left).localeCompare(normalizePath(right)));
}

async function resolvePromptManifestBlobId(config: AppConfig, repoObjectId: string, refName: string): Promise<string> {
  const client = createSuiClient(config);
  const repo = await getRepoDetails(client, repoObjectId);
  const ref = repo.refs.find((entry) => entry.name === refName);
  if (!ref) {
    throw new Error(`Prompt ref not found: ${refName}`);
  }
  return ref.blobId;
}

async function loadPromptFiles(config: AppConfig, manifest: PromptManifest): Promise<Map<string, string>> {
  const contents = new Map<string, string>();
  for (const file of manifest.files) {
    const bytes = await readBlob(config, file.blobId);
    const actualHash = sha256(bytes);
    if (actualHash !== file.sha256) {
      throw new Error(`Prompt file hash mismatch for ${file.path}`);
    }
    contents.set(file.path, Buffer.from(bytes).toString("utf8"));
  }
  return contents;
}

function renderPromptManifest(
  manifest: PromptManifest,
  fileContents: Map<string, string>,
  variables: Record<string, string>
): string {
  const spec = manifest.package;
  const sections: string[] = [
    `# ${spec.name}`,
    spec.description ? spec.description : "",
    "This is a complete prompt package. Generate a complete software project from it.",
    renderVariables(spec, variables)
  ].filter(Boolean);

  const entrypoints = spec.entrypoints ?? {};
  for (const [label, filePath] of Object.entries(entrypoints)) {
    const content = fileContents.get(filePath);
    if (content) {
      sections.push(renderSection(`${label.toUpperCase()} PROMPT`, applyVariables(content, variables)));
    }
  }

  const remainingFiles = [...fileContents.entries()].filter(([filePath]) => !Object.values(entrypoints).includes(filePath));
  for (const [filePath, content] of remainingFiles) {
    sections.push(renderSection(filePath, applyVariables(content, variables)));
  }

  if (spec.requiredOutputs?.length) {
    sections.push(renderSection("REQUIRED OUTPUTS", spec.requiredOutputs.map((item) => `- ${item}`).join("\n")));
  }
  if (spec.acceptanceChecks?.length) {
    sections.push(renderSection("ACCEPTANCE CHECKS", spec.acceptanceChecks.map((item) => `- ${item}`).join("\n")));
  }

  sections.push(
    renderSection(
      "COMPLETENESS RULES",
      [
        "- Output a complete project, not a summary.",
        "- Do not omit files.",
        "- Do not use placeholders such as TODO, omitted, or implementation left out.",
        "- Every file named by the package must be emitted with complete contents.",
        "- End with exact install, dev, build, and test commands."
      ].join("\n")
    )
  );

  return `${sections.join("\n\n")}\n`;
}

function renderVariables(spec: PromptPackageSpec, variables: Record<string, string>): string {
  if (!spec.variables?.length) {
    return "";
  }

  const missing = spec.variables.filter((variable) => variable.required && !variables[variable.name] && !variable.default);
  if (missing.length) {
    throw new Error(`Missing required prompt variables: ${missing.map((variable) => variable.name).join(", ")}`);
  }

  return renderSection(
    "VARIABLES",
    spec.variables
      .map((variable) => {
        const value = variables[variable.name] ?? variable.default ?? "";
        return `- ${variable.name}: ${value}`;
      })
      .join("\n")
  );
}

function renderSection(title: string, content: string): string {
  return `## ${title}\n\n${content.trim()}`;
}

function applyVariables(content: string, variables: Record<string, string>): string {
  return content.replaceAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, name: string) => variables[name] ?? "");
}

function normalizePath(value: string): string {
  return value.replaceAll(path.sep, "/");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
