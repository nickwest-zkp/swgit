import { createDAppKit } from "@mysten/dapp-kit-core";
import "@mysten/dapp-kit-core/web";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";

const state = {
  status: null as AppStatus | null,
  dappKit: null as any,
  lastBlobId: null as string | null,
  currentRepoId: null as string | null
};

const elements = {
  flash: required("#flash"),
  network: required("#network"),
  wallet: required("#wallet"),
  suiBalance: required("#sui-balance"),
  walBalance: required("#wal-balance"),
  packageId: required("#package-id"),
  defaultRepoId: required("#default-repo-id"),
  epochs: required("#epochs"),
  operatorAddress: required("#operator-address"),
  operatorWal: required("#operator-wal"),
  writerMode: required("#writer-mode"),
  repoIdInput: required<HTMLInputElement>("#repo-id-input"),
  refsBody: required("#refs-body"),
  repoMeta: required("#repo-meta"),
  createRepoResult: required("#create-repo-result"),
  uploadResult: required("#upload-result"),
  refResult: required("#ref-result"),
  blobPreview: required("#blob-preview"),
  blobPreviewId: required<HTMLInputElement>("#blob-preview-id"),
  gitPushResult: required("#git-push-result"),
  gitFetchResult: required("#git-fetch-result"),
  connectButton: required<any>("#wallet-connect"),
  walletForms: [
    required<HTMLFormElement>("#create-repo-form"),
    required<HTMLFormElement>("#ref-form"),
    required<HTMLFormElement>("#git-push-form")
  ],
  repoObjectInputs: Array.from(document.querySelectorAll<HTMLInputElement>('input[name="repoObjectId"]'))
};

required("#refresh-status").addEventListener("click", runAction(refreshStatus));
required("#load-repo").addEventListener("click", runAction(loadRepo));
required("#load-blob").addEventListener("click", runAction(loadBlobPreview, elements.blobPreview));
required("#create-repo-form").addEventListener("submit", runAction(handleCreateRepo, elements.createRepoResult));
required("#upload-form").addEventListener("submit", runAction(handleUpload, elements.uploadResult));
required("#ref-form").addEventListener("submit", runAction(handleRefUpdate, elements.refResult));
required("#git-push-form").addEventListener("submit", runAction(handleGitPush, elements.gitPushResult));
required("#git-fetch-form").addEventListener("submit", runAction(handleGitFetch, elements.gitFetchResult));

await bootstrap();

async function bootstrap() {
  await refreshStatus();
  initializeWalletKit();
  subscribeWalletState();
  if (state.currentRepoId) {
    await loadRepo();
  }
}

function initializeWalletKit() {
  const status = requireStatus();
  if (state.dappKit) {
    return;
  }

  state.dappKit = createDAppKit({
    networks: [status.network],
    defaultNetwork: status.network,
    createClient: (network) =>
      new SuiJsonRpcClient({
        network,
        url: status.rpcUrl
      })
  });

  elements.connectButton.instance = state.dappKit;
}

function subscribeWalletState() {
  const dappKit = requireDAppKit();
  dappKit.stores.$connection.subscribe(() => {
    void refreshConnectedWallet();
  });
  void refreshConnectedWallet();
}

async function refreshStatus() {
  const status = await requestJson<AppStatus>("/api/status");
  state.status = status;
  syncRepoObjectId(status.repoObjectId);

  elements.network.textContent = status.network;
  elements.packageId.textContent = status.packageId ?? "unset";
  elements.defaultRepoId.textContent = status.repoObjectId ?? "unset";
  elements.epochs.textContent = String(status.walrusEpochs);
  elements.operatorAddress.textContent = status.operator?.address ? shorten(status.operator.address) : "not configured";
  elements.operatorWal.textContent = status.operator?.balances.wal ?? "0";
}

async function refreshConnectedWallet() {
  const dappKit = requireDAppKit();
  const connection = dappKit.stores.$connection.get();
  const isConnected = connection.isConnected && !!connection.account;

  syncWriterControls(isConnected);

  if (!isConnected || !connection.account) {
    elements.wallet.textContent = "Not connected";
    elements.suiBalance.textContent = "-";
    elements.walBalance.textContent = "-";
    elements.writerMode.textContent = "Connect a wallet to enable repo creation, ref updates, and Git push.";
    return;
  }

  const currentClient = dappKit.stores.$currentClient.get();
  const [suiBalance, walBalance] = await Promise.all([
    currentClient.core.getBalance({ owner: connection.account.address }),
    currentClient.core.getBalance({ owner: connection.account.address, coinType: requireStatus().walCoinType })
  ]);

  elements.wallet.textContent = shorten(connection.account.address);
  elements.suiBalance.textContent = suiBalance.balance.balance;
  elements.walBalance.textContent = walBalance.balance.balance;
  elements.writerMode.textContent = `Writes are signed by ${shorten(connection.account.address)} on ${requireStatus().network}.`;
}

async function loadRepo() {
  const repoId = elements.repoIdInput.value.trim() || state.currentRepoId;
  if (!repoId) {
    renderError(elements.repoMeta, "No repo object ID set.");
    return;
  }

  const repo = await requestJson<RepoDetails>(`/api/repo?repo=${encodeURIComponent(repoId)}`);
  syncRepoObjectId(repo.objectId);
  renderRepoMeta(repo);
  renderRefs(repo.refs);
}

async function handleCreateRepo(event?: Event) {
  const formElement = requireFormEvent(event);
  event?.preventDefault();
  const form = new FormData(formElement);
  const name = String(form.get("name") ?? "").trim();
  const storageEpochs = Number(form.get("storageEpochs"));
  const tx = buildCreateRepoTransaction(name, storageEpochs);
  const result = await signAndExecute(tx, { objectTypes: true });
  const repoObjectId = extractCreatedRepoObjectId(result.Transaction.effects?.changedObjects ?? [], result.Transaction.objectTypes ?? {});
  const created = {
    digest: result.Transaction.digest,
    repoObjectId,
    owner: requireConnectedAccount().address,
    name,
    storageEpochs
  };

  syncRepoObjectId(repoObjectId);
  elements.createRepoResult.textContent = JSON.stringify(created, null, 2);
  showFlash(`Created repo ${repoObjectId}`, "success");
  await loadRepo();
}

async function handleUpload(event?: Event) {
  const formElement = requireFormEvent(event);
  event?.preventDefault();
  const formData = new FormData(formElement);
  const result = await requestJson<BlobUploadResult>("/api/blob", {
    method: "POST",
    body: formData
  });

  state.lastBlobId = result.blobId;
  required<HTMLInputElement>('input[name="blobId"]').value = result.blobId;
  elements.blobPreviewId.value = result.blobId;
  elements.uploadResult.textContent = JSON.stringify(result, null, 2);
  showFlash(`Stored blob ${result.blobId}`, "success");
}

async function handleRefUpdate(event?: Event) {
  const formElement = requireFormEvent(event);
  event?.preventDefault();
  const form = new FormData(formElement);
  const repoObjectId = String(form.get("repoObjectId") || state.currentRepoId || "").trim();
  const refName = String(form.get("refName") ?? "").trim();
  const blobId = String(form.get("blobId") ?? "").trim();

  const tx = buildUpdateRefTransaction(repoObjectId, refName, blobId);
  const result = await signAndExecute(tx);
  const repo = await waitForRepoRef(repoObjectId, refName, blobId);
  const payload = {
    digest: result.Transaction.digest,
    repoObjectId,
    refName,
    blobId,
    repo
  };

  elements.refResult.textContent = JSON.stringify(payload, null, 2);
  syncRepoObjectId(repo.objectId);
  renderRepoMeta(repo);
  renderRefs(repo.refs);
  showFlash(`Updated ${refName} -> ${blobId}`, "success");
}

async function handleGitPush(event?: Event) {
  const formElement = requireFormEvent(event);
  event?.preventDefault();
  const form = new FormData(formElement);
  const repoObjectId = String(form.get("repoObjectId") || state.currentRepoId || "").trim();
  const repoPath = String(form.get("repoPath") ?? "").trim();
  const sourceRef = String(form.get("sourceRef") ?? "").trim();
  const destRef = String(form.get("destRef") ?? "").trim();

  const exported = await requestJson<GitExportResult>("/api/git/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repoPath, sourceRef })
  });

  const tx = buildUpdateRefTransaction(repoObjectId, destRef, exported.manifestBlobId);
  const result = await signAndExecute(tx);
  const repo = await waitForRepoRef(repoObjectId, destRef, exported.manifestBlobId);
  const payload = {
    repoObjectId,
    refName: destRef,
    digest: result.Transaction.digest,
    repo,
    ...exported
  };

  elements.gitPushResult.textContent = JSON.stringify(payload, null, 2);
  syncRepoObjectId(repo.objectId);
  renderRepoMeta(repo);
  renderRefs(repo.refs);
  showFlash(`Exported ${exported.objectCount} git objects to ${destRef}`, "success");
}

async function handleGitFetch(event?: Event) {
  const formElement = requireFormEvent(event);
  event?.preventDefault();
  const form = new FormData(formElement);
  const payload = {
    repoObjectId: form.get("repoObjectId") || state.currentRepoId,
    refName: form.get("refName"),
    targetRepoPath: form.get("targetRepoPath"),
    localRef: form.get("localRef")
  };

  const result = await requestJson<GitFetchResult>("/api/git/fetch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  elements.gitFetchResult.textContent = JSON.stringify(result, null, 2);
  showFlash(`Fetched ${result.importedObjects} git objects into ${result.localRef}`, "success");
}

async function loadBlobPreview() {
  const blobId = elements.blobPreviewId.value.trim() || state.lastBlobId;
  if (!blobId) {
    renderError(elements.blobPreview, "No blob ID set.");
    return;
  }

  const response = await fetch(`/api/blob/${encodeURIComponent(blobId)}`);
  if (!response.ok) {
    throw new Error(await response.text());
  }

  elements.blobPreview.textContent = await response.text();
}

function renderRepoMeta(repo: RepoDetails) {
  elements.repoMeta.innerHTML = `
    <div><span>Name</span><strong>${escapeHtml(repo.name)}</strong></div>
    <div><span>Owner</span><strong>${shorten(repo.owner)}</strong></div>
    <div><span>Table</span><strong>${shorten(repo.headsTableId)}</strong></div>
    <div><span>Stored Epochs</span><strong>${repo.storageEpochs}</strong></div>
  `;
}

function renderRefs(refs: RepoDetails["refs"]) {
  if (!refs.length) {
    elements.refsBody.innerHTML = `<tr><td colspan="2" class="empty">No refs in this repository yet.</td></tr>`;
    return;
  }

  elements.refsBody.innerHTML = refs
    .map(
      (ref) => `
        <tr>
          <td>${escapeHtml(ref.name)}</td>
          <td class="mono">${escapeHtml(ref.blobId)}</td>
        </tr>
      `
    )
    .join("");
}

async function signAndExecute(transaction: Transaction, include: Record<string, boolean> = {}) {
  const dappKit = requireDAppKit();
  const account = requireConnectedAccount();
  transaction.setSenderIfNotSet(account.address);

  const result = await dappKit.signAndExecuteTransaction({ transaction });

  if (result.$kind === "FailedTransaction") {
    throw new Error(result.FailedTransaction.status.error?.message ?? "Sui transaction failed");
  }

  const client = dappKit.stores.$currentClient.get();
  const detailed = await client.core.waitForTransaction({
    digest: result.Transaction.digest,
    include: {
      effects: true,
      transaction: true,
      bcs: true,
      ...include
    }
  });

  if (detailed.$kind === "FailedTransaction") {
    throw new Error(detailed.FailedTransaction.status.error?.message ?? "Sui transaction failed");
  }

  return detailed;
}

async function waitForRepoRef(repoObjectId: string, refName: string, blobId: string): Promise<RepoDetails> {
  return requestJson<RepoDetails>("/api/repo/wait-ref", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repoObjectId, refName, blobId })
  });
}

function buildCreateRepoTransaction(name: string, storageEpochs: number) {
  if (!requireStatus().packageId) {
    throw new Error("SUI package ID is not configured on the server.");
  }

  const tx = new Transaction();
  tx.moveCall({
    target: `${requireStatus().packageId}::repository::create_repo`,
    arguments: [tx.pure.string(name), tx.pure.u64(storageEpochs)]
  });
  return tx;
}

function buildUpdateRefTransaction(repoObjectId: string, refName: string, blobId: string) {
  if (!repoObjectId) {
    throw new Error("No repo object ID set.");
  }

  if (!requireStatus().packageId) {
    throw new Error("SUI package ID is not configured on the server.");
  }

  const tx = new Transaction();
  tx.moveCall({
    target: `${requireStatus().packageId}::repository::update_ref`,
    arguments: [
      tx.object(repoObjectId),
      tx.pure.string(refName),
      tx.pure.vector("u8", Array.from(new TextEncoder().encode(blobId)))
    ]
  });
  return tx;
}

function extractCreatedRepoObjectId(
  changedObjects: Array<{
    objectId: string;
    idOperation: string;
    outputState: string;
  }>,
  objectTypes: Record<string, string>
) {
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

function syncRepoObjectId(repoObjectId: string | null | undefined) {
  const value = typeof repoObjectId === "string" && repoObjectId.trim() ? repoObjectId.trim() : null;
  if (!value) {
    return;
  }

  state.currentRepoId = value;
  elements.repoIdInput.value = value;
  for (const input of elements.repoObjectInputs) {
    input.value = value;
  }
}

function syncWriterControls(isConnected: boolean) {
  for (const form of elements.walletForms) {
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"], button:not([type])');
    if (submit) {
      submit.disabled = !isConnected;
    }
  }
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(payload.error ?? `Request failed: ${response.status}`));
  }
  return payload as T;
}

function required<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
}

function requireStatus() {
  if (!state.status) {
    throw new Error("App status has not loaded yet.");
  }
  return state.status;
}

function requireDAppKit() {
  if (!state.dappKit) {
    throw new Error("Wallet kit has not initialized yet.");
  }
  return state.dappKit;
}

function requireConnectedAccount() {
  const connection = requireDAppKit().stores.$connection.get();
  if (!connection.account) {
    throw new Error("Connect a Sui wallet first.");
  }
  return connection.account;
}

function shorten(value: string | null | undefined) {
  if (!value || value.length < 18) {
    return value ?? "-";
  }

  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function renderError(node: Element, message: string) {
  node.textContent = message;
}

function requireFormEvent(event?: Event) {
  if (!event?.currentTarget || !(event.currentTarget instanceof HTMLFormElement)) {
    throw new Error("Expected a form submission event.");
  }

  return event.currentTarget;
}

function showFlash(message: string, tone: "error" | "success" = "error") {
  elements.flash.hidden = false;
  elements.flash.className = `flash${tone === "success" ? " success" : ""}`;
  elements.flash.textContent = message;
}

function clearFlash() {
  elements.flash.hidden = true;
  elements.flash.className = "flash";
  elements.flash.textContent = "";
}

function runAction(action: (event?: Event) => Promise<void>, errorNode?: Element) {
  return async (event?: Event) => {
    const submitter = event?.currentTarget;
    try {
      clearFlash();
      if (submitter instanceof HTMLFormElement) {
        setFormDisabled(submitter, true);
      }
      await action(event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showFlash(message);
      if (errorNode) {
        renderError(errorNode, message);
      }
    } finally {
      if (submitter instanceof HTMLFormElement) {
        setFormDisabled(submitter, false);
        if (elements.walletForms.includes(submitter)) {
          syncWriterControls(!!requireDAppKit().stores.$connection.get().account);
        }
      }
    }
  };
}

function setFormDisabled(form: HTMLFormElement, disabled: boolean) {
  for (const element of Array.from(form.elements)) {
    if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) {
      element.disabled = disabled;
    }
  }
}

function escapeHtml(value: string) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type AppStatus = {
  network: "mainnet" | "testnet" | "devnet" | "localnet";
  rpcUrl: string;
  packageId: string | null;
  repoObjectId: string | null;
  walrusEpochs: number;
  walCoinType: string;
  operator: {
    address: string;
    balances: {
      sui: string;
      wal: string;
    };
  } | null;
};

type BlobUploadResult = {
  blobId: string;
  objectId?: string;
  endEpoch?: number;
  fileName: string;
  size: number;
};

type RepoDetails = {
  objectId: string;
  owner: string;
  name: string;
  storageEpochs: number;
  headsTableId: string;
  refs: Array<{ name: string; blobId: string }>;
};

type GitExportResult = {
  manifestBlobId: string;
  manifestObjectId?: string;
  rootOid: string;
  objectCount: number;
  sourceRef: string;
  repoPath: string;
};

type GitFetchResult = {
  repoObjectId: string;
  refName: string;
  manifestBlobId: string;
  rootOid: string;
  localRef: string;
  targetRepoPath: string;
  importedObjects: number;
};
