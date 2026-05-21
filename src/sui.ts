import { decodeSuiPrivateKey, type Signer } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import { Secp256r1Keypair } from "@mysten/sui/keypairs/secp256r1";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";

import type { AppConfig } from "./config.js";
import type { CreatedRepo, RepoRefUpdate } from "./types.js";

export function createSuiClient(config: AppConfig): SuiGrpcClient {
  return new SuiGrpcClient({
    network: config.SUI_NETWORK,
    baseUrl: config.SUI_GRPC_URL ?? config.SUI_RPC_URL ?? defaultSuiUrl(config.SUI_NETWORK)
  });
}

function defaultSuiUrl(network: AppConfig["SUI_NETWORK"]): string {
  switch (network) {
    case "mainnet":
      return "https://fullnode.mainnet.sui.io:443";
    case "testnet":
      return "https://fullnode.testnet.sui.io:443";
    case "devnet":
      return "https://fullnode.devnet.sui.io:443";
    case "localnet":
      return "http://127.0.0.1:9000";
    default:
      return "https://fullnode.testnet.sui.io:443";
  }
}

export function createSigner(config: AppConfig): Signer {
  if (!config.SUI_PRIVATE_KEY) {
    throw new Error("Missing SUI_PRIVATE_KEY");
  }

  const { secretKey, scheme } = decodeSuiPrivateKey(config.SUI_PRIVATE_KEY);
  switch (scheme) {
    case "ED25519":
      return Ed25519Keypair.fromSecretKey(secretKey);
    case "Secp256k1":
      return Secp256k1Keypair.fromSecretKey(secretKey);
    case "Secp256r1":
      return Secp256r1Keypair.fromSecretKey(secretKey);
    default:
      throw new Error(`Unsupported key scheme: ${scheme}`);
  }
}

export async function createRepo(
  client: SuiGrpcClient,
  signer: Signer,
  config: AppConfig,
  input: { name: string; storageEpochs: number }
): Promise<CreatedRepo> {
  if (!config.SUI_PACKAGE_ID) {
    throw new Error("Missing SUI_PACKAGE_ID");
  }

  const tx = new Transaction();
  tx.moveCall({
    target: `${config.SUI_PACKAGE_ID}::repository::create_repo`,
    arguments: [tx.pure.string(input.name), tx.pure.u64(input.storageEpochs)]
  });

  const result = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    include: {
      effects: true,
      objectTypes: true
    }
  });

  if (result.$kind === "FailedTransaction") {
    throw new Error(result.FailedTransaction.status.error?.message ?? "Sui transaction failed");
  }

  await client.waitForTransaction({ result });

  const repoObjectId = extractCreatedRepoObjectId(
    result.Transaction.effects?.changedObjects ?? [],
    result.Transaction.objectTypes ?? {}
  );
  return {
    digest: result.Transaction.digest,
    repoObjectId,
    owner: signer.toSuiAddress(),
    name: input.name,
    storageEpochs: input.storageEpochs
  };
}

export async function updateRepoRef(
  client: SuiGrpcClient,
  signer: Signer,
  config: AppConfig,
  input: RepoRefUpdate
): Promise<string> {
  if (!config.SUI_PACKAGE_ID) {
    throw new Error("Missing SUI_PACKAGE_ID");
  }

  const tx = new Transaction();
  tx.moveCall({
    target: `${config.SUI_PACKAGE_ID}::repository::update_ref`,
    arguments: [
      tx.object(input.repoObjectId),
      tx.pure.string(input.refName),
      tx.pure.vector("u8", Array.from(Buffer.from(input.blobId, "utf8")))
    ]
  });

  const result = await signer.signAndExecuteTransaction({
    client,
    transaction: tx
  });

  if (result.$kind === "FailedTransaction") {
    throw new Error(result.FailedTransaction.status.error?.message ?? "Sui transaction failed");
  }

  await client.waitForTransaction({ result });

  return result.Transaction.digest;
}

function extractCreatedRepoObjectId(
  changedObjects: Array<{
    objectId: string;
    idOperation: string;
    outputState: string;
  }>,
  objectTypes: Record<string, string>
): string {
  const repoObject = changedObjects.find(
    (object) =>
      object.idOperation === "Created" &&
      object.outputState === "ObjectWrite" &&
      objectTypes[object.objectId]?.endsWith("::repository::Repo")
  );

  if (!repoObject) {
    throw new Error("Unable to locate created Repo object in transaction effects");
  }

  return repoObject.objectId;
}
