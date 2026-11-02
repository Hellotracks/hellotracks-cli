import { Command } from "commander";
import { listProfiles, saveProfile, useProfile } from "@hellotracks/ht-core/config/store.js";
import { resolveActionEnvironment, whoamiAction } from "@hellotracks/ht-core/actions/index.js";
import { contextFor, formatListTable, outputData, runCommand } from "@hellotracks/ht-core/commands/support.js";

export function registerProfiles(program: Command): void {
  const profiles = program.command("profiles").description("Manage local ht-cli profiles");

  profiles.command("list")
    .description("List local profiles and authentication state")
    .action(() => runCommand(async () => {
      const command = profiles.commands.find((entry) => entry.name() === "list")!;
      const data = await listProfiles();
      const rows = data.profiles.map((profile) => ({
        current: profile.name === data.currentProfile ? "*" : "",
        name: profile.name,
        apiUrl: profile.apiUrl,
        authenticated: profile.authenticated
      }));
      outputData(command, formatListTable(rows, ["current", "name", "apiUrl", "authenticated"]), "table");
    }));

  profiles.command("create")
    .argument("<name>", "Profile name")
    .option("--api-url <url>", "Public API base URL")
    .description("Create or update a local profile without storing credentials")
    .action((name, options) => runCommand(async () => {
      const command = profiles.commands.find((entry) => entry.name() === "create")!;
      const context = contextFor(command);
      const data = await saveProfile(name, options.apiUrl ?? context.apiUrl);
      outputData(command, data, "pretty");
    }));

  profiles.command("use")
    .argument("<name>", "Profile name")
    .description("Set the current default profile")
    .action((name) => runCommand(async () => {
      const command = profiles.commands.find((entry) => entry.name() === "use")!;
      const data = await useProfile(name);
      outputData(command, data, "pretty");
    }));

  profiles.command("doctor")
    .description("Validate that the active profile can authenticate")
    .action(() => runCommand(async () => {
      const command = profiles.commands.find((entry) => entry.name() === "doctor")!;
      const context = contextFor(command);
      const environment = await resolveActionEnvironment(context);
      const whoami = await whoamiAction(context);
      outputData(command, {
        profile: environment.profileName,
        apiUrl: environment.apiUrl,
        authenticated: true,
        account: whoami.account,
        company: whoami.company,
        apiKey: whoami.apiKey
      }, "pretty");
    }));
}
