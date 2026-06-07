import { createHash, randomUUID } from "node:crypto";

import type { AppConfig } from "./config.js";
import { exportGitRefToWalrus } from "./git-transport.js";
import { getRepoDetails } from "./repository.js";
import { acceptAgentProposal, createAgentProposal, createSigner, createSuiClient } from "./sui.js";
import type {
  AgentProposalAcceptResult,
  AgentProposalCreateResult,
  AgentProposalExportResult,
  AgentProposalMetadata,
  AgentProposalPayload
} from "./types.js";
import { storeBlob } from "./walrus.js";

export async function exportAgentProposal(
  config: AppConfig,
  input: {
    repoPath: string;
    sourceRef: string;
    targetRef: string;
    agentAddress: string;
    agentName: string;
    taskId: string;
    summary: string;
    plan?: string[];
    tests?: string[];
    risks?: string[];
    prompt?: string;
  }
): Promise<AgentProposalExportResult> {
  const exported = await exportGitRefToWalrus(config, {
    repoPath: input.repoPath,
    sourceRef: input.sourceRef
  });

  const createdAt = new Date().toISOString();
  const proposalId = createProposalId(input.agentAddress, input.taskId);
  const metadata: AgentProposalMetadata = {
    kind: "swgit-agent-run",
    version: 1,
    agentName: input.agentName,
    taskId: input.taskId,
    promptHash: input.prompt ? sha256(input.prompt) : undefined,
    summary: input.summary,
    plan: input.plan ?? [],
    tests: input.tests ?? [],
    risks: input.risks ?? [],
    createdAt
  };
  const metadataStored = await storeBlob(config, new TextEncoder().encode(JSON.stringify(metadata, null, 2)));
  const payload: AgentProposalPayload = {
    kind: "swgit-agent-proposal",
    version: 1,
    proposalId,
    status: "open",
    agentAddress: input.agentAddress,
    targetRef: input.targetRef,
    sourceRef: input.sourceRef,
    rootOid: exported.rootOid,
    manifestBlobId: exported.manifestBlobId,
    manifestObjectId: exported.manifestObjectId,
    metadataBlobId: metadataStored.blobId,
    createdAt,
    updatedAt: createdAt
  };

  return {
    proposalId,
    payload,
    metadata,
    metadataBlobId: metadataStored.blobId,
    manifestBlobId: exported.manifestBlobId,
    manifestObjectId: exported.manifestObjectId,
    rootOid: exported.rootOid,
    objectCount: exported.objectCount,
    repoPath: exported.repoPath
  };
}

export async function pushAgentProposal(
  config: AppConfig,
  input: {
    repoObjectId: string;
    repoPath: string;
    sourceRef: string;
    targetRef: string;
    agentName: string;
    taskId: string;
    summary: string;
    plan?: string[];
    tests?: string[];
    risks?: string[];
    prompt?: string;
  }
): Promise<AgentProposalCreateResult> {
  const client = createSuiClient(config);
  const signer = createSigner(config);
  const exported = await exportAgentProposal(config, {
    ...input,
    agentAddress: signer.toSuiAddress()
  });
  const digest = await createAgentProposal(client, signer, config, {
    repoObjectId: input.repoObjectId,
    proposalId: exported.proposalId,
    payload: exported.payload
  });

  return {
    ...exported,
    repoObjectId: input.repoObjectId,
    digest
  };
}

export async function acceptProposalById(
  config: AppConfig,
  input: { repoObjectId: string; proposalId: string; refName?: string }
): Promise<AgentProposalAcceptResult> {
  const client = createSuiClient(config);
  const signer = createSigner(config);
  const repo = await getRepoDetails(client, input.repoObjectId);
  const proposal = repo.proposals.find((entry) => entry.proposalId === input.proposalId);
  if (!proposal) {
    throw new Error(`Proposal not found: ${input.proposalId}`);
  }

  const refName = input.refName ?? proposal.targetRef;
  const acceptedPayload: AgentProposalPayload = {
    ...proposal,
    status: "accepted",
    updatedAt: new Date().toISOString()
  };
  const digest = await acceptAgentProposal(client, signer, config, {
    repoObjectId: input.repoObjectId,
    proposalId: input.proposalId,
    refName,
    manifestBlobId: proposal.manifestBlobId,
    payload: acceptedPayload
  });
  const updatedRepo = await getRepoDetails(client, input.repoObjectId);

  return {
    repoObjectId: input.repoObjectId,
    proposalId: input.proposalId,
    refName,
    manifestBlobId: proposal.manifestBlobId,
    digest,
    repo: updatedRepo
  };
}

export function createProposalId(agentAddress: string, taskId: string): string {
  const normalizedTask = taskId.trim().replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 48) || "task";
  const shortAgent = agentAddress.replace(/^0x/, "").slice(0, 12) || "agent";
  return `${normalizedTask}-${shortAgent}-${randomUUID().slice(0, 8)}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
