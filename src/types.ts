export type RepoRefUpdate = {
  repoObjectId: string;
  refName: string;
  blobId: string;
};

export type CreatedRepo = {
  digest: string;
  repoObjectId: string;
  owner: string;
  name: string;
  storageEpochs: number;
};

export type RepoDetails = {
  objectId: string;
  version: string;
  digest: string;
  owner: string;
  packageId: string;
  name: string;
  storageEpochs: number;
  headsTableId: string;
  headsSize: string;
  refs: Array<{
    name: string;
    blobId: string;
  }>;
};

export type StoredBlob = {
  blobId: string;
  objectId?: string;
  endEpoch?: number;
};

export type GitPushResult = {
  repoObjectId: string;
  refName: string;
  manifestBlobId: string;
  manifestObjectId?: string;
  rootOid: string;
  objectCount: number;
  digest: string;
};

export type GitExportResult = {
  manifestBlobId: string;
  manifestObjectId?: string;
  rootOid: string;
  objectCount: number;
  sourceRef: string;
  repoPath: string;
};

export type GitFetchResult = {
  repoObjectId: string;
  refName: string;
  manifestBlobId: string;
  rootOid: string;
  localRef: string;
  targetRepoPath: string;
  importedObjects: number;
};
