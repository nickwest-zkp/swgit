import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitObjectType = "blob" | "tree" | "commit" | "tag";

export type GitObjectPayload = {
  oid: string;
  type: GitObjectType;
  size: number;
  bytes: Uint8Array;
};

export type GitManifestObject = {
  oid: string;
  type: GitObjectType;
  size: number;
  blobId: string;
};

export type GitManifest = {
  version: 1;
  kind: "swgit-manifest";
  rootOid: string;
  sourceRef: string;
  exportedAt: string;
  objectCount: number;
  objects: GitManifestObject[];
};

export async function readObjectFile(objectPath: string): Promise<Uint8Array> {
  const fullPath = path.resolve(objectPath);
  const file = await readFile(fullPath);
  return new Uint8Array(file);
}

export async function exportGitRef(repoPath: string, sourceRef: string): Promise<{
  repoPath: string;
  rootOid: string;
  objects: GitObjectPayload[];
}> {
  const resolvedRepoPath = path.resolve(repoPath);
  await ensureGitRepository(resolvedRepoPath);

  const rootOid = await git(resolvedRepoPath, ["rev-parse", sourceRef]);
  const objectIds = await listReachableObjects(resolvedRepoPath, rootOid);
  const objects: GitObjectPayload[] = [];

  for (const oid of objectIds) {
    const type = (await git(resolvedRepoPath, ["cat-file", "-t", oid])) as GitObjectType;
    const [sizeText, bytes] = await Promise.all([
      git(resolvedRepoPath, ["cat-file", "-s", oid]),
      gitBinary(resolvedRepoPath, ["cat-file", type, oid])
    ]);

    objects.push({
      oid,
      type,
      size: Number.parseInt(sizeText, 10),
      bytes
    });
  }

  return {
    repoPath: resolvedRepoPath,
    rootOid,
    objects
  };
}

export async function importGitManifest(options: {
  repoPath: string;
  manifest: GitManifest;
  loadObjectBytes: (blobId: string) => Promise<Uint8Array>;
  localRef?: string;
}): Promise<{
  repoPath: string;
  rootOid: string;
  localRef: string;
  importedObjects: number;
}> {
  const repoPath = path.resolve(options.repoPath);
  await ensureGitRepository(repoPath, { initializeIfMissing: true });

  for (const object of options.manifest.objects) {
    const bytes = await options.loadObjectBytes(object.blobId);
    const writtenOid = await hashObjectToRepo(repoPath, object.type, bytes);
    if (writtenOid !== object.oid) {
      throw new Error(`Git object OID mismatch for ${object.oid}, wrote ${writtenOid}`);
    }
  }

  const localRef = options.localRef ?? defaultLocalRef(options.manifest.sourceRef);
  await git(repoPath, ["update-ref", localRef, options.manifest.rootOid]);

  return {
    repoPath,
    rootOid: options.manifest.rootOid,
    localRef,
    importedObjects: options.manifest.objects.length
  };
}

export function encodeGitManifest(input: {
  rootOid: string;
  sourceRef: string;
  objects: GitManifestObject[];
}): Uint8Array {
  const manifest: GitManifest = {
    version: 1,
    kind: "swgit-manifest",
    rootOid: input.rootOid,
    sourceRef: input.sourceRef,
    exportedAt: new Date().toISOString(),
    objectCount: input.objects.length,
    objects: input.objects
  };

  return new TextEncoder().encode(JSON.stringify(manifest, null, 2));
}

export function parseGitManifest(bytes: Uint8Array): GitManifest {
  const manifest = JSON.parse(Buffer.from(bytes).toString("utf8")) as GitManifest;
  if (manifest.kind !== "swgit-manifest" || manifest.version !== 1 || !Array.isArray(manifest.objects)) {
    throw new Error("Blob does not contain a valid swgit manifest");
  }

  return manifest;
}

export async function ensureGitRepository(
  repoPath: string,
  options: { initializeIfMissing?: boolean } = {}
): Promise<void> {
  try {
    await git(repoPath, ["rev-parse", "--git-dir"]);
  } catch (error) {
    if (!options.initializeIfMissing) {
      throw error;
    }

    await mkdir(repoPath, { recursive: true });
    await execFileAsync("git", ["init", repoPath], { encoding: "utf8" });
  }
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function defaultLocalRef(sourceRef: string): string {
  const normalized = sourceRef.replace(/^refs\//, "").replaceAll("/", "_");
  return `refs/swgit/${normalized}`;
}

async function listReachableObjects(repoPath: string, rootOid: string): Promise<string[]> {
  const stdout = await git(repoPath, ["rev-list", "--objects", rootOid]);
  const ids = new Set<string>();

  for (const line of stdout.split(/\r?\n/)) {
    const oid = line.trim().split(" ", 1)[0];
    if (oid) {
      ids.add(oid);
    }
  }

  return [...ids];
}

async function git(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], { encoding: "utf8" });
  return stdout.trim();
}

async function gitBinary(repoPath: string, args: string[]): Promise<Uint8Array> {
  const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 });
  return new Uint8Array(stdout);
}

async function hashObjectToRepo(repoPath: string, type: GitObjectType, bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", repoPath, "hash-object", "-w", "--stdin", "-t", type], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `git hash-object failed with code ${code}`));
        return;
      }

      resolve(Buffer.concat(stdout).toString("utf8").trim());
    });

    child.stdin.end(Buffer.from(bytes));
  });
}
