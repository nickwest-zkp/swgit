import { WalrusClient } from "@mysten/walrus";
import { access } from "node:fs/promises";

import type { AppConfig } from "./config.js";
import type { StoredBlob } from "./types.js";
import { createSigner, createSuiClient } from "./sui.js";
import { readBlobWithCli, storeBlobWithCli } from "./walrus-cli.js";

export function createWalrusClient(config: AppConfig): WalrusClient {
  return new WalrusClient({
    network: config.SUI_NETWORK === "mainnet" ? "mainnet" : "testnet",
    suiClient: createSuiClient(config)
  });
}

export async function storeBlob(config: AppConfig, bytes: Uint8Array): Promise<StoredBlob> {
  if (await shouldUseWalrusCli(config)) {
    return storeBlobWithCli(config, bytes);
  }

  const client = createWalrusClient(config);
  const signer = createSigner(config);
  const response = await client.writeBlob({
    blob: bytes,
    deletable: false,
    epochs: config.WALRUS_EPOCHS,
    signer
  });

  return {
    blobId: response.blobId,
    objectId: response.blobObject.id,
    endEpoch: response.blobObject.storage.end_epoch
  };
}

export async function readBlob(config: AppConfig, blobId: string): Promise<Uint8Array> {
  if (await shouldUseWalrusCli(config)) {
    try {
      return await readBlobWithCli(config, blobId);
    } catch {
      // Walrus testnet sometimes fails CLI reads for recently certified deletable blobs.
      // Fall back to the TS SDK read path when that happens.
    }
  }

  const client = createWalrusClient(config);
  return client.readBlob({ blobId });
}

async function shouldUseWalrusCli(config: AppConfig): Promise<boolean> {
  if (!config.WALRUS_CLI_PATH || !config.WALRUS_CONFIG_PATH || !config.SUI_WALLET_CONFIG_PATH) {
    return false;
  }

  try {
    await Promise.all([
      access(config.WALRUS_CLI_PATH),
      access(config.WALRUS_CONFIG_PATH),
      access(config.SUI_WALLET_CONFIG_PATH)
    ]);
    return true;
  } catch {
    return false;
  }
}
