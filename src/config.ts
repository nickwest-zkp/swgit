import "dotenv/config";

import { z } from "zod";

const optionalString = () =>
  z.preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }, z.string().min(1).optional());

const configSchema = z.object({
  SUI_NETWORK: z.enum(["mainnet", "testnet", "devnet", "localnet"]).default("testnet"),
  SUI_GRPC_URL: optionalString().pipe(z.string().url().optional()),
  SUI_RPC_URL: optionalString().pipe(z.string().url().optional()),
  SUI_PACKAGE_ID: optionalString(),
  SUI_REPO_OBJECT_ID: optionalString(),
  SUI_PRIVATE_KEY: optionalString(),
  SUI_WALLET_CONFIG_PATH: optionalString(),
  WALRUS_EPOCHS: z.coerce.number().int().positive().default(5)
  ,
  WALRUS_CLI_PATH: optionalString(),
  WALRUS_CONFIG_PATH: optionalString()
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(overrides: Partial<Record<keyof AppConfig, unknown>> = {}): AppConfig {
  return configSchema.parse({
    SUI_NETWORK: process.env.SUI_NETWORK,
    SUI_GRPC_URL: process.env.SUI_GRPC_URL,
    SUI_RPC_URL: process.env.SUI_RPC_URL,
    SUI_PACKAGE_ID: process.env.SUI_PACKAGE_ID,
    SUI_REPO_OBJECT_ID: process.env.SUI_REPO_OBJECT_ID,
    SUI_PRIVATE_KEY: process.env.SUI_PRIVATE_KEY,
    SUI_WALLET_CONFIG_PATH: process.env.SUI_WALLET_CONFIG_PATH ?? ".sui/client.yaml",
    WALRUS_EPOCHS: process.env.WALRUS_EPOCHS,
    WALRUS_CLI_PATH: process.env.WALRUS_CLI_PATH ?? ".tools/walrus.exe",
    WALRUS_CONFIG_PATH: process.env.WALRUS_CONFIG_PATH ?? ".tools/walrus-client-config.yaml",
    ...overrides
  });
}

export function requireConfigValue<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`Missing required config value: ${name}`);
  }

  return value;
}
