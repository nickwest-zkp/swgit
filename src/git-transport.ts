import type { AppConfig } from "./config.js";
import {
  encodeGitManifest,
  exportGitRef,
  importGitManifest,
  parseGitManifest,
  type GitManifestObject
} from "./git.js";
import { getRepoDetails, waitForRefVisibility } from "./repository.js";
import { createSigner, createSuiClient, updateRepoRef } from "./sui.js";
import type { GitExportResult, GitFetchResult, GitPushResult } from "./types.js";
import { readBlob, storeBlob } from "./walrus.js";

export async function exportGitRefToWalrus(
  config: AppConfig,
  input: {
    repoPath: string;
    sourceRef: string;
  }
): Promise<GitExportResult> {
  const exported = await exportGitRef(input.repoPath, input.sourceRef);
  const manifestObjects: GitManifestObject[] = [];

  for (const object of exported.objects) {
    const stored = await storeBlob(config, object.bytes);
    manifestObjects.push({
      oid: object.oid,
      type: object.type,
      size: object.size,
      blobId: stored.blobId
    });
  }

  const manifestBytes = encodeGitManifest({
    rootOid: exported.rootOid,
    sourceRef: input.sourceRef,
    objects: manifestObjects
  });
  const manifestStored = await storeBlob(config, manifestBytes);

  return {
    manifestBlobId: manifestStored.blobId,
    manifestObjectId: manifestStored.objectId,
    rootOid: exported.rootOid,
    objectCount: manifestObjects.length,
    sourceRef: input.sourceRef,
    repoPath: exported.repoPath
  };
}

export async function pushGitRefToRepo(
  config: AppConfig,
  input: {
    repoObjectId: string;
    repoPath: string;
    sourceRef: string;
    destRef: string;
  }
): Promise<GitPushResult> {
  const exported = await exportGitRefToWalrus(config, {
    repoPath: input.repoPath,
    sourceRef: input.sourceRef
  });

  const client = createSuiClient(config);
  const signer = createSigner(config);
  const digest = await updateRepoRef(client, signer, config, {
    repoObjectId: input.repoObjectId,
    refName: input.destRef,
    blobId: exported.manifestBlobId
  });

  await waitForRefVisibility(client, input.repoObjectId, input.destRef, exported.manifestBlobId);

  return {
    repoObjectId: input.repoObjectId,
    refName: input.destRef,
    manifestBlobId: exported.manifestBlobId,
    manifestObjectId: exported.manifestObjectId,
    rootOid: exported.rootOid,
    objectCount: exported.objectCount,
    digest
  };
}

export async function fetchGitRefFromRepo(
  config: AppConfig,
  input: {
    repoObjectId: string;
    refName: string;
    targetRepoPath: string;
    localRef?: string;
  }
): Promise<GitFetchResult> {
  const client = createSuiClient(config);
  const repo = await getRepoDetails(client, input.repoObjectId);
  const ref = repo.refs.find((entry) => entry.name === input.refName);
  if (!ref) {
    throw new Error(`Ref not found: ${input.refName}`);
  }

  const manifestBytes = await readBlob(config, ref.blobId);
  const manifest = parseGitManifest(manifestBytes);
  const imported = await importGitManifest({
    repoPath: input.targetRepoPath,
    manifest,
    localRef: input.localRef,
    loadObjectBytes: async (blobId) => readBlob(config, blobId)
  });

  return {
    repoObjectId: input.repoObjectId,
    refName: input.refName,
    manifestBlobId: ref.blobId,
    rootOid: imported.rootOid,
    localRef: imported.localRef,
    targetRepoPath: imported.repoPath,
    importedObjects: imported.importedObjects
  };
}
