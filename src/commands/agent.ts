import { Command } from "commander";

import { acceptProposalById, pushAgentProposal } from "../agent.js";
import { loadConfig } from "../config.js";
import { authorizeAgent, createSigner, createSuiClient, revokeAgent } from "../sui.js";

export function createAgentCommand(): Command {
  const command = new Command("agent");

  command
    .command("authorize")
    .description("Authorize an agent address to create proposals in a repo")
    .argument("<agentAddress>", "Sui address for the coding agent")
    .option("--repo <objectId>", "Override repo object ID")
    .action(async (agentAddress: string, options: { repo?: string }) => {
      const config = loadConfig();
      const repoObjectId = options.repo ?? config.SUI_REPO_OBJECT_ID;
      if (!repoObjectId) {
        throw new Error("Missing repo object ID. Pass --repo or set SUI_REPO_OBJECT_ID.");
      }

      const digest = await authorizeAgent(createSuiClient(config), createSigner(config), config, {
        repoObjectId,
        agentAddress
      });
      process.stdout.write(`${digest}\n`);
    });

  command
    .command("revoke")
    .description("Remove an agent authorization from a repo")
    .argument("<agentAddress>", "Sui address for the coding agent")
    .option("--repo <objectId>", "Override repo object ID")
    .action(async (agentAddress: string, options: { repo?: string }) => {
      const config = loadConfig();
      const repoObjectId = options.repo ?? config.SUI_REPO_OBJECT_ID;
      if (!repoObjectId) {
        throw new Error("Missing repo object ID. Pass --repo or set SUI_REPO_OBJECT_ID.");
      }

      const digest = await revokeAgent(createSuiClient(config), createSigner(config), config, {
        repoObjectId,
        agentAddress
      });
      process.stdout.write(`${digest}\n`);
    });

  command
    .command("propose")
    .description("Export a Git ref as an agent proposal with Walrus-backed run metadata")
    .requiredOption("--repo-path <path>", "Local Git repository path")
    .requiredOption("--source-ref <ref>", "Local Git ref or revision to export")
    .requiredOption("--target-ref <ref>", "Ref this proposal wants to update")
    .requiredOption("--task-id <id>", "Agent task identifier")
    .requiredOption("--summary <text>", "Short agent-written change summary")
    .option("--agent-name <name>", "Agent display name", "codex")
    .option("--plan <items>", "Pipe-separated plan items")
    .option("--tests <items>", "Pipe-separated tests run")
    .option("--risks <items>", "Pipe-separated risk notes")
    .option("--prompt <text>", "Original prompt text; only its hash is stored")
    .option("--repo-object-id <id>", "Override the Sui repo object ID")
    .action(
      async (options: {
        repoPath: string;
        sourceRef: string;
        targetRef: string;
        taskId: string;
        summary: string;
        agentName: string;
        plan?: string;
        tests?: string;
        risks?: string;
        prompt?: string;
        repoObjectId?: string;
      }) => {
        const config = loadConfig();
        const repoObjectId = options.repoObjectId ?? config.SUI_REPO_OBJECT_ID;
        if (!repoObjectId) {
          throw new Error("Missing repo object ID. Pass --repo-object-id or set SUI_REPO_OBJECT_ID.");
        }

        const result = await pushAgentProposal(config, {
          repoObjectId,
          repoPath: options.repoPath,
          sourceRef: options.sourceRef,
          targetRef: options.targetRef,
          taskId: options.taskId,
          summary: options.summary,
          agentName: options.agentName,
          plan: splitItems(options.plan),
          tests: splitItems(options.tests),
          risks: splitItems(options.risks),
          prompt: options.prompt
        });

        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      }
    );

  command
    .command("accept")
    .description("Accept an agent proposal and update its target ref")
    .argument("<proposalId>", "Proposal ID stored in the repo")
    .option("--repo <objectId>", "Override repo object ID")
    .option("--ref-name <ref>", "Override the proposal target ref")
    .action(async (proposalId: string, options: { repo?: string; refName?: string }) => {
      const config = loadConfig();
      const repoObjectId = options.repo ?? config.SUI_REPO_OBJECT_ID;
      if (!repoObjectId) {
        throw new Error("Missing repo object ID. Pass --repo or set SUI_REPO_OBJECT_ID.");
      }

      const result = await acceptProposalById(config, {
        repoObjectId,
        proposalId,
        refName: options.refName
      });

      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    });

  return command;
}

function splitItems(value: string | undefined): string[] {
  return value
    ? value
        .split("|")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}
