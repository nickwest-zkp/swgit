import { Command } from "commander";

import { loadConfig } from "../config.js";
import { createRepo, createSigner, createSuiClient } from "../sui.js";

export function createRepoCommand(): Command {
  const command = new Command("repo");

  command
    .command("show")
    .description("Read the configured repository object from Sui")
    .option("--repo <objectId>", "Override repo object ID")
    .action(async (options: { repo?: string }) => {
      const config = loadConfig();
      const client = createSuiClient(config);
      const objectId = options.repo ?? config.SUI_REPO_OBJECT_ID;
      if (!objectId) {
        throw new Error("Missing repo object ID. Pass --repo or set SUI_REPO_OBJECT_ID.");
      }

      const repo = await client.getObject({
        objectId,
        include: { type: true, owner: true, bcs: true, content: true }
      });

      process.stdout.write(`${JSON.stringify(repo, null, 2)}\n`);
    });

  command
    .command("address")
    .description("Print the signer address derived from SUI_PRIVATE_KEY")
    .action(async () => {
      const config = loadConfig();
      const signer = createSigner(config);
      process.stdout.write(`${signer.getPublicKey().toSuiAddress()}\n`);
    });

  command
    .command("create")
    .description("Create a new repository object on Sui")
    .argument("<name>", "Repository name")
    .option(
      "--storage-epochs <epochs>",
      "Walrus storage epochs to persist in repo metadata",
      (value: string) => Number.parseInt(value, 10)
    )
    .action(async (name: string, options: { storageEpochs?: number }) => {
      const config = loadConfig();
      const client = createSuiClient(config);
      const signer = createSigner(config);
      const created = await createRepo(client, signer, config, {
        name,
        storageEpochs: options.storageEpochs ?? config.WALRUS_EPOCHS
      });

      process.stdout.write(`${JSON.stringify(created, null, 2)}\n`);
    });

  return command;
}
