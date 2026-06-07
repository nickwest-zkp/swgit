# swgit

`swgit` is an agent-native code repository prototype built on Sui and Walrus.

The core demo is not just "Git objects on decentralized storage". `swgit` treats coding agents as first-class
contributors: an agent can be authorized by Sui address, submit a Walrus-backed code proposal with run metadata,
and let a human owner accept that proposal into a protected ref.

The current repository includes:

- a TypeScript CLI for storing and reading blobs from Walrus
- a Sui transaction path for updating repository refs
- a manifest-based Git push/fetch flow that exports real Git objects to Walrus
- a Move repository object model with owner refs, authorized agents, and agent proposals
- a local web server and browser UI with browser-side Sui wallet signing

## Layout

- `src/`: CLI, config loading, Sui client wiring, and Walrus helpers
- `public/`: local browser UI served by the Node process
- `move/`: Move package containing the repository contract draft

## Quick start

1. Copy `.env.example` to `.env` and fill in `SUI_PRIVATE_KEY`, `SUI_PACKAGE_ID`, and `SUI_REPO_OBJECT_ID`.
2. Install dependencies with `pnpm install`.
3. Run `pnpm dev repo address` to verify the signer.
4. Publish the Move package from `move/` and set `SUI_PACKAGE_ID`.
5. Run `pnpm dev repo create <name>` and save the returned `repoObjectId` into `SUI_REPO_OBJECT_ID`.
6. Run `pnpm dev blob put <path>` to upload a file to Walrus.
7. Run `pnpm dev ref update refs/heads/main <blobId>` to point a branch head to the uploaded blob.
8. Run `pnpm dev:web` and open `http://localhost:3000` for the web UI.
9. Connect a Sui wallet in the browser to create repos and sign ref updates.
10. For a built server process, run `pnpm build` and then `pnpm start:web`.

## Agent-native flow

Authorize a coding agent address:

```bash
pnpm dev agent authorize 0xAGENT_ADDRESS
```

Have the agent submit a proposal instead of directly updating `refs/heads/main`:

```bash
pnpm dev agent propose --repo-path D:\\repos\\app --source-ref HEAD --target-ref refs/heads/main --task-id fix-build-001 --summary "Fixed the build and ran pnpm check" --tests "pnpm check|pnpm build"
```

Accept the proposal as the repo owner:

```bash
pnpm dev agent accept <proposal-id>
```

Agent proposals store:

- the Git manifest blob ID for the proposed commit
- the agent Sui address
- the target ref
- a Walrus-backed `swgit-agent-run` metadata blob containing task ID, summary, plan, tests, risks, and optional prompt hash

## Git flows

Push a real Git revision into a manifest-backed Sui ref:

```bash
pnpm dev git push-ref --repo-path D:\\repos\\app --source-ref HEAD --dest-ref refs/heads/main
```

Materialize a manifest-backed ref back into a local repository:

```bash
pnpm dev git fetch-ref --target-repo-path D:\\repos\\app-clone --ref-name refs/heads/main --local-ref refs/heads/imported
```

## Notes

- This is still an MVP scaffold, not a drop-in `git-remote-*` transport yet.
- The Move contract now supports authorized agent proposals, but still needs richer roles and a proper view/query pattern for production.
- Refs now point to manifest blobs for Git-aware flows; the manifest stores the root commit OID plus the object-to-blob mapping.
- The TS implementation is wired against `@mysten/sui` gRPC and `@mysten/walrus` `writeBlob` / `readBlob` APIs.
- If `WALRUS_CLI_PATH`, `WALRUS_CONFIG_PATH`, and `SUI_WALLET_CONFIG_PATH` are configured, blob operations prefer the official `walrus` CLI because it is more reliable than direct node uploads on testnet.
- The browser UI signs Sui transactions with the connected wallet. The `.env` private key is now only needed for backend-funded Walrus uploads and CLI flows.
