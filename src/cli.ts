#!/usr/bin/env node

import { Command } from "commander";

import { createAgentCommand } from "./commands/agent.js";
import { createBlobCommand } from "./commands/blob.js";
import { createGitCommand } from "./commands/git.js";
import { createRefCommand } from "./commands/ref.js";
import { createRepoCommand } from "./commands/repo.js";

const program = new Command();

program
  .name("swgit")
  .description("Agent-native Sui + Walrus code repository prototype CLI")
  .version("0.1.0");

program.addCommand(createAgentCommand());
program.addCommand(createBlobCommand());
program.addCommand(createGitCommand());
program.addCommand(createRefCommand());
program.addCommand(createRepoCommand());

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
