import { Command } from "commander";

import { loadConfig } from "../config.js";
import { fetchGitRefFromRepo, pushGitRefToRepo } from "../git-transport.js";

export function createGitCommand(): Command {
  const command = new Command("git");

  command
    .command("push-ref")
    .description("Export a local Git ref to Walrus and update a Sui repo ref to its manifest")
    .requiredOption("--repo-path <path>", "Local Git repository path")
    .requiredOption("--source-ref <ref>", "Local Git ref or revision to export")
    .requiredOption("--dest-ref <ref>", "Remote ref name to update on Sui")
    .option("--repo-object-id <id>", "Override the Sui repo object ID")
    .action(
      async (options: {
        repoPath: string;
        sourceRef: string;
        destRef: string;
        repoObjectId?: string;
      }) => {
        const config = loadConfig();
        const repoObjectId = options.repoObjectId ?? config.SUI_REPO_OBJECT_ID;
        if (!repoObjectId) {
          throw new Error("Missing repo object ID. Pass --repo-object-id or set SUI_REPO_OBJECT_ID.");
        }

        const result = await pushGitRefToRepo(config, {
          repoObjectId,
          repoPath: options.repoPath,
          sourceRef: options.sourceRef,
          destRef: options.destRef
        });

        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      }
    );

  command
    .command("fetch-ref")
    .description("Read a manifest-backed ref from Sui/Walrus and materialize it into a local Git repo")
    .requiredOption("--target-repo-path <path>", "Local path to initialize or update")
    .requiredOption("--ref-name <ref>", "Remote ref name stored in the Sui repo")
    .option("--local-ref <ref>", "Local ref to update after importing objects")
    .option("--repo-object-id <id>", "Override the Sui repo object ID")
    .action(
      async (options: {
        targetRepoPath: string;
        refName: string;
        localRef?: string;
        repoObjectId?: string;
      }) => {
        const config = loadConfig();
        const repoObjectId = options.repoObjectId ?? config.SUI_REPO_OBJECT_ID;
        if (!repoObjectId) {
          throw new Error("Missing repo object ID. Pass --repo-object-id or set SUI_REPO_OBJECT_ID.");
        }

        const result = await fetchGitRefFromRepo(config, {
          repoObjectId,
          refName: options.refName,
          targetRepoPath: options.targetRepoPath,
          localRef: options.localRef
        });

        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      }
    );

  return command;
}
