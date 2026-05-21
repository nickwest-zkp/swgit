import { writeFile } from "node:fs/promises";

import { Command } from "commander";

import { loadConfig } from "../config.js";
import { readObjectFile } from "../git.js";
import { readBlob, storeBlob } from "../walrus.js";

export function createBlobCommand(): Command {
  const command = new Command("blob");

  command
    .command("put")
    .description("Store a local file as a Walrus blob")
    .argument("<file>", "Path to the file to upload")
    .action(async (file: string) => {
      const config = loadConfig();
      const bytes = await readObjectFile(file);
      const stored = await storeBlob(config, bytes);
      process.stdout.write(`${JSON.stringify(stored, null, 2)}\n`);
    });

  command
    .command("get")
    .description("Fetch a Walrus blob into a local file")
    .argument("<blobId>", "Walrus blob ID")
    .argument("<output>", "Destination file path")
    .action(async (blobId: string, output: string) => {
      const config = loadConfig();
      const bytes = await readBlob(config, blobId);
      await writeFile(output, bytes);
      process.stdout.write(`${output}\n`);
    });

  return command;
}
