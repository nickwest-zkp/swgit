import { Command } from "commander";

import { loadConfig } from "../config.js";
import { createSigner, createSuiClient, updateRepoRef } from "../sui.js";

export function createRefCommand(): Command {
  const command = new Command("ref");

  command
    .command("update")
    .description("Update a ref in the repository Move object")
    .argument("<refName>", "Reference name, for example refs/heads/main")
    .argument("<blobId>", "Walrus blob ID for the target git commit object")
    .option("--repo <objectId>", "Override repo object ID")
    .action(async (refName: string, blobId: string, options: { repo?: string }) => {
      const config = loadConfig();
      const repoObjectId = options.repo ?? config.SUI_REPO_OBJECT_ID;
      if (!repoObjectId) {
        throw new Error("Missing repo object ID. Pass --repo or set SUI_REPO_OBJECT_ID.");
      }

      const client = createSuiClient(config);
      const signer = createSigner(config);
      const digest = await updateRepoRef(client, signer, config, {
        repoObjectId,
        refName,
        blobId
      });

      process.stdout.write(`${digest}\n`);
    });

  return command;
}
