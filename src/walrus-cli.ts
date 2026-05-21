import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { AppConfig } from "./config.js";
import type { StoredBlob } from "./types.js";

const execFileAsync = promisify(execFile);

type WalrusStoreCliResult = Array<{
  blobStoreResult: {
    newlyCreated?: {
      blobObject: {
        id: string;
        blobId: string;
        storage: {
          endEpoch: number;
        };
      };
    };
    alreadyCertified?: {
      blobId: string;
      object?: string;
      endEpoch?: number;
      blobObject?: {
        id: string;
        storage: {
          endEpoch: number;
        };
      };
    };
  };
  path: string;
}>;

export async function storeBlobWithCli(config: AppConfig, bytes: Uint8Array): Promise<StoredBlob> {
  const cliPath = requireConfiguredPath(config.WALRUS_CLI_PATH, "WALRUS_CLI_PATH");
  const walrusConfig = requireConfiguredPath(config.WALRUS_CONFIG_PATH, "WALRUS_CONFIG_PATH");
  const walletConfig = requireConfiguredPath(config.SUI_WALLET_CONFIG_PATH, "SUI_WALLET_CONFIG_PATH");

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "swgit-walrus-store-"));
  const inputFile = path.join(tempDir, "blob.bin");

  try {
    await writeFile(inputFile, bytes);
    const { stdout } = await execFileAsync(cliPath, [
      "store",
      inputFile,
      "--epochs",
      String(config.WALRUS_EPOCHS),
      "--config",
      walrusConfig,
      "--wallet",
      walletConfig,
      "--json"
    ]);

    const result = JSON.parse(stdout.trim()) as WalrusStoreCliResult;
    const entry = result[0];
    const newlyCreated = entry?.blobStoreResult.newlyCreated;
    if (newlyCreated) {
      return {
        blobId: newlyCreated.blobObject.blobId,
        objectId: newlyCreated.blobObject.id,
        endEpoch: newlyCreated.blobObject.storage.endEpoch
      };
    }

    const alreadyCertified = entry?.blobStoreResult.alreadyCertified;
    if (alreadyCertified) {
      return {
        blobId: alreadyCertified.blobId,
        objectId: alreadyCertified.object ?? alreadyCertified.blobObject?.id,
        endEpoch: alreadyCertified.endEpoch ?? alreadyCertified.blobObject?.storage.endEpoch
      };
    }

    throw new Error("Unexpected walrus store output");
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

export async function readBlobWithCli(config: AppConfig, blobId: string): Promise<Uint8Array> {
  const cliPath = requireConfiguredPath(config.WALRUS_CLI_PATH, "WALRUS_CLI_PATH");
  const walrusConfig = requireConfiguredPath(config.WALRUS_CONFIG_PATH, "WALRUS_CONFIG_PATH");
  const walletConfig = requireConfiguredPath(config.SUI_WALLET_CONFIG_PATH, "SUI_WALLET_CONFIG_PATH");

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "swgit-walrus-read-"));
  const outputFile = path.join(tempDir, "blob.bin");

  try {
    await execFileAsync(cliPath, [
      "read",
      blobId,
      "--out",
      outputFile,
      "--skip-consistency-check",
      "--config",
      walrusConfig,
      "--wallet",
      walletConfig
    ]);
    return new Uint8Array(await readFile(outputFile));
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

function requireConfiguredPath(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required config value: ${name}`);
  }

  return path.resolve(value);
}
