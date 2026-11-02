import { Command } from "commander";
import {
  createApiKeyAction,
  deleteApiKeyAction,
  listApiKeysAction,
  revokeApiKeyAction
} from "@hellotracks/ht-core/actions/index.js";
import { confirmDangerous, formatListTable, outputData, runCommand, contextFor } from "@hellotracks/ht-core/commands/support.js";

export function registerApiKeys(program: Command): void {
  const apikeys = program.command("apikeys").description("Manage API keys");

  apikeys.command("list")
    .description("List the company's API keys; secrets are never shown")
    .action(() => runCommand(async () => {
      const command = apikeys.commands.find((entry) => entry.name() === "list")!;
      const data = await listApiKeysAction(contextFor(command));
      outputData(command, formatListTable(data.items, ["id", "type", "active", "createdAt", "expiresAt", "lastUsedAt"]), "table");
    }));

  apikeys.command("create")
    .description("Create an API key; the secret is shown once")
    .option("--expires-at <expiresAt>", "Unix timestamp in milliseconds")
    .option("--label <label>", "Human-readable key label")
    .option("--source <source>", "Automation source identifier")
    .action((options) => runCommand(async () => {
      const command = apikeys.commands.find((entry) => entry.name() === "create")!;
      const body = {
        expiresAt: options.expiresAt ? Number.parseInt(options.expiresAt, 10) : undefined,
        label: options.label,
        source: options.source
      };
      const data = await createApiKeyAction(contextFor(command), body);
      outputData(command, data, "pretty");
    }));

  apikeys.command("revoke")
    .description("Stop an API key from working; it stays listed")
    .argument("<id>", "API key ID")
    .action((id) => runCommand(async () => {
      const command = apikeys.commands.find((entry) => entry.name() === "revoke")!;
      const context = contextFor(command);
      await confirmDangerous(context, `Revoke API key ${id}?`);
      const data = await revokeApiKeyAction(context, id);
      outputData(command, formatListTable(data.items, ["id", "type", "active", "expiresAt", "lastUsedAt"]), "table");
    }));

  apikeys.command("delete")
    .description("Delete an API key")
    .argument("<id>", "API key ID")
    .action((id) => runCommand(async () => {
      const command = apikeys.commands.find((entry) => entry.name() === "delete")!;
      const context = contextFor(command);
      await confirmDangerous(context, `Delete API key ${id}?`);
      const data = await deleteApiKeyAction(context, id);
      outputData(command, formatListTable(data.items, ["id", "type", "active", "expiresAt", "lastUsedAt"]), "table");
    }));
}
