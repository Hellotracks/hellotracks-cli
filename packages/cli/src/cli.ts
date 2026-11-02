import { Command, Option } from "commander";
import { registerMembers } from "./commands/members.js";
import { registerApiKeys } from "./commands/apikeys.js";
import { registerAuth } from "@hellotracks/ht-core/commands/auth.js";
import { registerCompany } from "./commands/company.js";
import { registerJobs } from "./commands/jobs.js";
import { registerPlaces } from "./commands/places.js";
import { registerRouting } from "./commands/routing.js";
import { registerReports } from "./commands/reports.js";
import { registerTimesheets } from "./commands/timesheets.js";
import { registerForms } from "./commands/forms.js";
import { registerAlerts } from "./commands/alerts.js";
import { registerMaps } from "./commands/maps.js";
import { registerEta } from "./commands/eta.js";
import { registerWebhooks } from "./commands/webhooks.js";
import { registerProfiles } from "./commands/profiles.js";
import { registerSignup } from "./commands/signup.js";
import { registerSkills } from "./commands/skills.js";
import { registerUpdate } from "./commands/update.js";
import { registerCommands } from "./commands/commands.js";
import type { GlobalOptions } from "@hellotracks/ht-core/types.js";
import { packageVersion } from "./version.js";
import { autoCheckCliUpdate } from "./update.js";

const GLOBAL_OPTIONS_WITH_VALUES = new Set(["--profile", "--api-url", "--api-key", "--output", "--fields", "--sort", "--request-id", "--confirm-profile"]);

export interface ParsedInvocation {
  globalOptions: Partial<GlobalOptions>;
  positionalArgs: string[];
  wantsHelp: boolean;
  wantsVersion: boolean;
}

function camelOption(option: string): keyof GlobalOptions {
  return option.replace(/^-+/, "").replace(/-([a-z])/g, (_, char: string) => char.toUpperCase()) as keyof GlobalOptions;
}

export function parseInvocation(args: string[]): ParsedInvocation {
  const globalOptions: Partial<GlobalOptions> = {};
  const positionalArgs: string[] = [];
  let wantsHelp = false;
  let wantsVersion = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }
    if (token === "--help" || token === "-h") {
      wantsHelp = true;
      continue;
    }
    if (token === "--version" || token === "-v") {
      wantsVersion = true;
      continue;
    }
    if (!token.startsWith("-")) {
      positionalArgs.push(token);
      continue;
    }
    const inlineValueIndex = token.indexOf("=");
    if (inlineValueIndex > 0) {
      const option = token.slice(0, inlineValueIndex);
      const rawValue = token.slice(inlineValueIndex + 1);
      if (GLOBAL_OPTIONS_WITH_VALUES.has(option)) {
        globalOptions[camelOption(option)] = rawValue as never;
        continue;
      }
    }
    if (GLOBAL_OPTIONS_WITH_VALUES.has(token)) {
      const next = args[index + 1];
      if (next !== undefined) {
        globalOptions[camelOption(token)] = next as never;
        index += 1;
      }
      continue;
    }
    if (token === "--json") {
      globalOptions.json = true;
      continue;
    }
    if (token === "--api-key-stdin") {
      globalOptions.apiKeyStdin = true;
      continue;
    }
    if (token === "--no-input") {
      globalOptions.noInput = true;
      continue;
    }
    if (token === "--quiet") {
      globalOptions.quiet = true;
      continue;
    }
    if (token === "--verbose") {
      globalOptions.verbose = true;
      continue;
    }
    if (token === "--yes") {
      globalOptions.yes = true;
      continue;
    }
    if (token === "--no-update-check") {
      globalOptions.updateCheck = false;
      continue;
    }
  }

  return { globalOptions, positionalArgs, wantsHelp, wantsVersion };
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("ht")
    .description("Hellotracks CLI")
    .version(packageVersion(), "-v, --version")
    .option("--profile <profile>", "Configuration profile")
    .option("--api-url <url>", "Override API base URL")
    .option("--api-key <key>", "Override API key")
    .option("--api-key-stdin", "Read API key from stdin")
    .option("--json", "Render JSON output")
    .option("--output <mode>", "pretty | table | json | yaml | csv | ndjson")
    .option("--fields <fields>", "Comma-separated fields for tabular, CSV, JSON array, and NDJSON output")
    .option("--sort <field>", "Sort array output by field; prefix with - for descending")
    .option("--request-id <id>", "Send an X-Request-ID header")
    .option("--confirm-profile <profile>", "Fail unless the selected profile matches this value")
    .option("--no-input", "Disable interactive prompts")
    .option("--quiet", "Suppress non-essential stderr output")
    .option("--verbose", "Emit HTTP debug logs")
    .option("--yes", "Skip destructive confirmations")
    .option("--no-update-check", "Disable automatic update availability check");
  // Every request names ht in the User-Agent and HT-Integration-Source headers (see api-client.ts).
  program.setOptionValue("integrationSource", "ht_cli");
  program.setOptionValue("clientUserAgent", `hellotracks-ht-cli/${packageVersion()}`);

  registerSignup(program);
  registerAuth(program);
  registerMembers(program);
  registerCompany(program);
  registerApiKeys(program);
  registerWebhooks(program);
  registerPlaces(program);
  registerJobs(program);
  registerRouting(program);
  registerAlerts(program);
  registerMaps(program);
  registerEta(program);
  registerReports(program);
  registerTimesheets(program);
  registerForms(program);
  registerProfiles(program);
  registerSkills(program);
  registerUpdate(program);
  registerCommands(program);

  return program;
}

function autoUpdateDisabledByEnv(): boolean {
  return ["0", "false", "off", "no"].includes((process.env.HT_CLI_AUTO_UPDATE_CHECK ?? "").trim().toLowerCase());
}

async function maybePrintAutoUpdateNotice(invocation: ParsedInvocation): Promise<void> {
  if (
    invocation.wantsHelp ||
    invocation.wantsVersion ||
    invocation.globalOptions.quiet ||
    invocation.globalOptions.json ||
    invocation.globalOptions.output === "json" ||
    invocation.globalOptions.output === "ndjson" ||
    invocation.globalOptions.output === "csv" ||
    invocation.globalOptions.output === "yaml" ||
    invocation.globalOptions.updateCheck === false ||
    invocation.positionalArgs[0] === "update" ||
    autoUpdateDisabledByEnv() ||
    !process.stderr.isTTY ||
    process.exitCode
  ) {
    return;
  }
  const result = await autoCheckCliUpdate(packageVersion());
  if (result.status === "available") {
    process.stderr.write(`Update available: ht ${result.currentVersion} -> ${result.latestVersion}. Run \`ht update\`.\n`);
  }
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  const args = argv.slice(2);
  const invocation = parseInvocation(args);
  const program = buildProgram();

  if (args.length === 0) {
    program.outputHelp();
    return;
  }

  await program.parseAsync(argv);
  await maybePrintAutoUpdateNotice(invocation);
}
