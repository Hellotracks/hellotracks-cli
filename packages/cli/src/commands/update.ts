import { Command } from "commander";
import { outputData, runCommand } from "@hellotracks/ht-core/commands/support.js";
import { checkCliUpdate, DEFAULT_CLI_UPDATE_BASE_URL, updateCli } from "../update.js";
import { packageVersion } from "../version.js";

export function registerUpdate(program: Command): void {
  program.command("update")
    .description("Check for and install a newer ht-cli release")
    .option("--check", "Only check whether an update is available")
    .option("--force", "Run the installer even when the manifest version is not newer")
    .option("--base-url <url>", "Release base URL", DEFAULT_CLI_UPDATE_BASE_URL)
    .action(function (this: Command, options) {
      return runCommand(async () => {
        const currentVersion = packageVersion();
        const result = options.check
          ? await checkCliUpdate(currentVersion, { baseUrl: options.baseUrl })
          : await updateCli(currentVersion, {
              baseUrl: options.baseUrl,
              force: options.force
            });
        outputData(this, result);
      });
    });
}
