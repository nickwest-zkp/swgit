import type { SuiGrpcClient } from "@mysten/sui/grpc";

import type { AgentProposalRecord, RepoDetails } from "./types.js";

type RepoObjectJson = {
  id: string;
  owner: string;
  name: string;
  storage_epochs: string;
  heads: {
    id: string;
    size: string;
  };
  agents?: {
    id: string;
    size: string;
  };
  proposals?: {
    id: string;
    size: string;
  };
};

type DynamicFieldValue = {
  dynamicFields: Array<{
    name: {
      value?: string;
      bcs?: Uint8Array;
    };
    value?: {
      bcs?: Uint8Array;
    };
  }>;
};

export async function getRepoDetails(client: SuiGrpcClient, repoObjectId: string): Promise<RepoDetails> {
  const repo = await client.getObject({
    objectId: repoObjectId,
    include: { json: true, type: true, owner: true }
  });

  const object = repo.object;
  const json = object.json as RepoObjectJson | undefined;
  if (!json) {
    throw new Error(`Repo object ${repoObjectId} does not expose JSON content`);
  }

  const [refs, proposals] = await Promise.all([
    loadStringByteVectorTable(client, json.heads.id),
    json.proposals ? loadProposalTable(client, json.proposals.id) : Promise.resolve([])
  ]);
  const owner =
    object.owner?.$kind === "AddressOwner" ? object.owner.AddressOwner : JSON.stringify(object.owner ?? null);
  const packageId = object.type.split("::", 1)[0] ?? "";

  return {
    objectId: object.objectId,
    version: object.version,
    digest: object.digest,
    owner,
    packageId,
    name: json.name,
    storageEpochs: Number.parseInt(json.storage_epochs, 10),
    headsTableId: json.heads.id,
    headsSize: json.heads.size,
    agentsTableId: json.agents?.id,
    agentsSize: json.agents?.size,
    proposalsTableId: json.proposals?.id,
    proposalsSize: json.proposals?.size,
    refs,
    proposals
  };
}

export async function waitForRefVisibility(
  client: SuiGrpcClient,
  repoObjectId: string,
  refName: string,
  blobId: string,
  timeoutMs = 15_000
): Promise<RepoDetails> {
  const startedAt = Date.now();

  while (true) {
    const repo = await getRepoDetails(client, repoObjectId);
    if (repo.refs.some((ref) => ref.name === refName && ref.blobId === blobId)) {
      return repo;
    }

    if (Date.now() - startedAt >= timeoutMs) {
      return repo;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function loadStringByteVectorTable(client: SuiGrpcClient, tableId: string): Promise<RepoDetails["refs"]> {
  const entries: RepoDetails["refs"] = [];
  let cursor: string | null = null;

  do {
    const page = (await client.listDynamicFields({
      parentId: tableId,
      cursor,
      include: { value: true }
    })) as DynamicFieldValue & { cursor: string | null; hasNextPage: boolean };

    for (const field of page.dynamicFields) {
      const name = field.name.value ?? (field.name.bcs ? Buffer.from(decodeBcsByteVector(field.name.bcs)).toString("utf8") : "");
      const blobId = field.value?.bcs ? Buffer.from(decodeBcsByteVector(field.value.bcs)).toString("utf8") : "";
      entries.push({ name, blobId });
    }

    cursor = page.cursor;
  } while (cursor);

  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

async function loadProposalTable(client: SuiGrpcClient, tableId: string): Promise<AgentProposalRecord[]> {
  const entries = await loadStringByteVectorTable(client, tableId);
  const proposals: AgentProposalRecord[] = [];

  for (const entry of entries) {
    try {
      const parsed = JSON.parse(entry.blobId) as Omit<AgentProposalRecord, "rawPayload">;
      if (parsed.kind === "swgit-agent-proposal" && parsed.version === 1) {
        proposals.push({
          ...parsed,
          rawPayload: entry.blobId
        });
      }
    } catch {
      proposals.push({
        kind: "swgit-agent-proposal",
        version: 1,
        proposalId: entry.name,
        status: "open",
        agentAddress: "",
        targetRef: "",
        sourceRef: "",
        rootOid: "",
        manifestBlobId: "",
        metadataBlobId: "",
        createdAt: "",
        updatedAt: "",
        rawPayload: entry.blobId
      });
    }
  }

  return proposals.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function decodeBcsByteVector(bytes: Uint8Array): Uint8Array {
  const { value: length, bytesRead } = readUleb128(bytes);
  return bytes.slice(bytesRead, bytesRead + length);
}

function readUleb128(bytes: Uint8Array): { value: number; bytesRead: number } {
  let value = 0;
  let shift = 0;
  let index = 0;

  while (index < bytes.length) {
    const byte = bytes[index];
    value |= (byte & 0x7f) << shift;
    index += 1;

    if ((byte & 0x80) === 0) {
      return { value, bytesRead: index };
    }

    shift += 7;
  }

  throw new Error("Invalid ULEB128 sequence");
}
