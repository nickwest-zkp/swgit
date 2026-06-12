export type RepoRefUpdate = {
  repoObjectId: string;
  refName: string;
  blobId: string;
};

export type AgentAuthorization = {
  repoObjectId: string;
  agentAddress: string;
};

export type AgentProposalPayload = {
  kind: "swgit-agent-proposal";
  version: 1;
  proposalId: string;
  status: "open" | "accepted" | "rejected";
  agentAddress: string;
  targetRef: string;
  sourceRef: string;
  rootOid: string;
  manifestBlobId: string;
  manifestObjectId?: string;
  metadataBlobId: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentProposalRecord = AgentProposalPayload & {
  rawPayload: string;
};

export type AgentProposalMetadata = {
  kind: "swgit-agent-run";
  version: 1;
  agentName: string;
  taskId: string;
  promptHash?: string;
  promptPackageBlobId?: string;
  summary: string;
  plan: string[];
  tests: string[];
  risks: string[];
  createdAt: string;
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
  agentsTableId?: string;
  agentsSize?: string;
  proposalsTableId?: string;
  proposalsSize?: string;
  refs: Array<{
    name: string;
    blobId: string;
  }>;
  proposals: AgentProposalRecord[];
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

export type AgentProposalExportResult = {
  proposalId: string;
  payload: AgentProposalPayload;
  metadata: AgentProposalMetadata;
  metadataBlobId: string;
  manifestBlobId: string;
  manifestObjectId?: string;
  rootOid: string;
  objectCount: number;
  repoPath: string;
};

export type AgentProposalCreateResult = AgentProposalExportResult & {
  repoObjectId: string;
  digest: string;
};

export type AgentProposalAcceptResult = {
  repoObjectId: string;
  proposalId: string;
  refName: string;
  manifestBlobId: string;
  digest: string;
  repo: RepoDetails;
};

export type PromptPackageSpec = {
  kind: "swgit-prompt-package";
  version: 1;
  name: string;
  description?: string;
  modelHints?: string[];
  variables?: Array<{
    name: string;
    required?: boolean;
    description?: string;
    default?: string;
  }>;
  entrypoints?: {
    system?: string;
    developer?: string;
    task?: string;
  };
  requiredOutputs?: string[];
  acceptanceChecks?: string[];
};

export type PromptManifestFile = {
  path: string;
  size: number;
  sha256: string;
  blobId: string;
  objectId?: string;
};

export type PromptManifest = {
  kind: "swgit-prompt-manifest";
  version: 1;
  package: PromptPackageSpec;
  packagePath: string;
  exportedAt: string;
  fileCount: number;
  files: PromptManifestFile[];
};

export type PromptPublishResult = {
  repoObjectId: string;
  refName: string;
  manifestBlobId: string;
  manifestObjectId?: string;
  packageName: string;
  fileCount: number;
  digest?: string;
};

export type PromptFetchResult = {
  repoObjectId: string;
  refName: string;
  manifestBlobId: string;
  packageName: string;
  outputPath: string;
  fileCount: number;
};

export type PromptRenderResult = {
  repoObjectId: string;
  refName: string;
  manifestBlobId: string;
  packageName: string;
  rendered: string;
};
