import "dotenv/config";

import express from "express";
import multer from "multer";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { loadConfig } from "./config.js";
import { exportGitRefToWalrus, fetchGitRefFromRepo, pushGitRefToRepo } from "./git-transport.js";
import { getRepoDetails, waitForRefVisibility } from "./repository.js";
import { createRepo, createSigner, createSuiClient, updateRepoRef } from "./sui.js";
import { readBlob, storeBlob } from "./walrus.js";

const app = express();
const uploadDir = path.resolve(".uploads");
const upload = multer({ dest: uploadDir });
const walCoinType = "0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL";

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.resolve("public")));

app.get("/api/status", async (_request, response) => {
  const config = loadConfig();
  const client = createSuiClient(config);
  const operator = await loadOperatorStatus(config);

  response.json({
    network: config.SUI_NETWORK,
    rpcUrl: config.SUI_RPC_URL ?? defaultRpcUrl(config.SUI_NETWORK),
    packageId: config.SUI_PACKAGE_ID ?? null,
    repoObjectId: config.SUI_REPO_OBJECT_ID ?? null,
    walrusEpochs: config.WALRUS_EPOCHS,
    walCoinType,
    operator
  });
});

app.get("/api/repo", async (request, response) => {
  const config = loadConfig();
  const repoObjectId = asOptionalString(request.query.repo) ?? config.SUI_REPO_OBJECT_ID;
  if (!repoObjectId) {
    response.status(400).json({ error: "Missing repo object ID" });
    return;
  }

  const client = createSuiClient(config);
  const repo = await getRepoDetails(client, repoObjectId);
  response.json(repo);
});

app.post("/api/repo/create", async (request, response) => {
  const config = loadConfig();
  const client = createSuiClient(config);
  const signer = createSigner(config);
  const name = String(request.body?.name ?? "").trim();
  const storageEpochs = Number(request.body?.storageEpochs ?? config.WALRUS_EPOCHS);

  if (!name) {
    response.status(400).json({ error: "Missing repository name" });
    return;
  }

  const created = await createRepo(client, signer, config, { name, storageEpochs });
  response.json(created);
});

app.post("/api/blob", upload.single("file"), async (request, response) => {
  const config = loadConfig();
  if (!request.file) {
    response.status(400).json({ error: "Missing upload file" });
    return;
  }

  try {
    const bytes = await readFile(request.file.path);
    const stored = await storeBlob(config, new Uint8Array(bytes));
    response.json({
      ...stored,
      fileName: request.file.originalname,
      size: request.file.size
    });
  } finally {
    await rm(request.file.path, { force: true });
  }
});

app.get("/api/blob/:blobId", async (request, response) => {
  const config = loadConfig();
  const bytes = await readBlob(config, request.params.blobId);
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.send(Buffer.from(bytes));
});

app.post("/api/ref/update", async (request, response) => {
  const config = loadConfig();
  const repoObjectId = String(request.body?.repoObjectId ?? config.SUI_REPO_OBJECT_ID ?? "").trim();
  const refName = String(request.body?.refName ?? "").trim();
  const blobId = String(request.body?.blobId ?? "").trim();

  if (!repoObjectId || !refName || !blobId) {
    response.status(400).json({ error: "repoObjectId, refName, and blobId are required" });
    return;
  }

  const client = createSuiClient(config);
  const signer = createSigner(config);
  const digest = await updateRepoRef(client, signer, config, { repoObjectId, refName, blobId });
  const repo = await waitForRefVisibility(client, repoObjectId, refName, blobId);

  response.json({ digest, repoObjectId, refName, blobId, repo });
});

app.post("/api/repo/wait-ref", async (request, response) => {
  const config = loadConfig();
  const repoObjectId = String(request.body?.repoObjectId ?? config.SUI_REPO_OBJECT_ID ?? "").trim();
  const refName = String(request.body?.refName ?? "").trim();
  const blobId = String(request.body?.blobId ?? "").trim();

  if (!repoObjectId || !refName || !blobId) {
    response.status(400).json({ error: "repoObjectId, refName, and blobId are required" });
    return;
  }

  const client = createSuiClient(config);
  const repo = await waitForRefVisibility(client, repoObjectId, refName, blobId);
  response.json(repo);
});

app.post("/api/git/push", async (request, response) => {
  const config = loadConfig();
  const repoObjectId = String(request.body?.repoObjectId ?? config.SUI_REPO_OBJECT_ID ?? "").trim();
  const repoPath = String(request.body?.repoPath ?? "").trim();
  const sourceRef = String(request.body?.sourceRef ?? "").trim();
  const destRef = String(request.body?.destRef ?? "").trim();

  if (!repoObjectId || !repoPath || !sourceRef || !destRef) {
    response.status(400).json({ error: "repoObjectId, repoPath, sourceRef, and destRef are required" });
    return;
  }

  const result = await pushGitRefToRepo(config, {
    repoObjectId,
    repoPath,
    sourceRef,
    destRef
  });
  const client = createSuiClient(config);
  const repo = await getRepoDetails(client, repoObjectId);

  response.json({ ...result, repo });
});

app.post("/api/git/export", async (request, response) => {
  const config = loadConfig();
  const repoPath = String(request.body?.repoPath ?? "").trim();
  const sourceRef = String(request.body?.sourceRef ?? "").trim();

  if (!repoPath || !sourceRef) {
    response.status(400).json({ error: "repoPath and sourceRef are required" });
    return;
  }

  const result = await exportGitRefToWalrus(config, {
    repoPath,
    sourceRef
  });

  response.json(result);
});

app.post("/api/git/fetch", async (request, response) => {
  const config = loadConfig();
  const repoObjectId = String(request.body?.repoObjectId ?? config.SUI_REPO_OBJECT_ID ?? "").trim();
  const refName = String(request.body?.refName ?? "").trim();
  const targetRepoPath = String(request.body?.targetRepoPath ?? "").trim();
  const localRef = asOptionalBodyString(request.body?.localRef);

  if (!repoObjectId || !refName || !targetRepoPath) {
    response.status(400).json({ error: "repoObjectId, refName, and targetRepoPath are required" });
    return;
  }

  const result = await fetchGitRefFromRepo(config, {
    repoObjectId,
    refName,
    targetRepoPath,
    localRef
  });

  response.json(result);
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  response.status(500).json({ error: message });
});

const port = Number(process.env.PORT ?? "3000");

await mkdir(uploadDir, { recursive: true });

app.listen(port, () => {
  process.stdout.write(`swgit web server listening on http://localhost:${port}\n`);
});

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asOptionalBodyString(value: unknown): string | undefined {
  return asOptionalString(value);
}

async function loadOperatorStatus(config: ReturnType<typeof loadConfig>) {
  if (!config.SUI_PRIVATE_KEY) {
    return null;
  }

  const client = createSuiClient(config);
  const signer = createSigner(config);
  const address = signer.toSuiAddress();
  const [suiBalance, walBalance] = await Promise.all([
    client.getBalance({ owner: address }),
    client.getBalance({ owner: address, coinType: walCoinType })
  ]);

  return {
    address,
    balances: {
      sui: suiBalance.balance.balance,
      wal: walBalance.balance.balance
    }
  };
}

function defaultRpcUrl(network: ReturnType<typeof loadConfig>["SUI_NETWORK"]): string {
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
