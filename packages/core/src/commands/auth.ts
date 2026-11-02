import { Command } from "commander";
import { confirm, promptSecret, promptText, success, warn } from "../ui/tty.js";
import { DEFAULT_API_URL, toolName } from "../utils.js";
import { contextFor, outputData, runCommand } from "./support.js";
import {
  finishEmailLoginAction,
  loginAction,
  logoutAction,
  resolveActionEnvironment,
  startEmailLoginAction,
  validateAuthAction,
  whoamiAction,
  type StoredEmailCodeKey
} from "../actions/index.js";
import { writeKeyFile } from "../config/pending-signup.js";
import type { AuthWhoAmIResponse, CommandContext } from "../types.js";
import { renderAuthWhoamiOverview } from "./auth-presenter.js";

function commandByName(parent: Command, name: string): Command {
  return parent.commands.find((command) => command.name() === name)!;
}

function accountLabel(whoami: AuthWhoAmIResponse): string {
  const account = whoami.account;
  if (!account || typeof account !== "object") {
    return "authenticated account";
  }
  const record = account as Record<string, unknown>;
  return String(record.name || record.email || record.username || record.id || "authenticated account");
}

function outputWhoami(command: Command, whoami: AuthWhoAmIResponse, resolvedContext?: CommandContext): void {
  const context = resolvedContext ?? contextFor(command);
  if (context.output === "json" || context.output === "yaml") {
    outputData(command, whoami, "pretty");
    return;
  }
  outputData(command, renderAuthWhoamiOverview(whoami, context), "pretty");
}

interface PromptAndStoreLoginOptions {
  replace?: boolean;
}

async function promptAndStoreLogin(context: CommandContext, options: PromptAndStoreLoginOptions = {}): Promise<AuthWhoAmIResponse> {
  const environment = await resolveActionEnvironment(context, { requireAuth: false });
  if (!options.replace && environment.apiKey && !context.apiKey && !context.apiKeyStdin) {
    try {
      const whoami = await whoamiAction(context);
      if (context.noInput || !process.stdin.isTTY || !process.stdout.isTTY) {
        return whoami;
      }
      warn(`Existing credentials found for profile "${environment.profileName}".`);
      success(`Authenticated as ${accountLabel(whoami)}.`);
      const shouldReplace = await confirm("Replace API key?");
      if (!shouldReplace) {
        return whoami;
      }
    } catch (error) {
      warn(`Stored credentials could not be validated: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!context.apiKey && !context.apiKeyStdin && (context.noInput || !process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new Error("API key is required. Pass --api-key, --api-key-stdin, or run auth login in an interactive terminal.");
  }
  const apiUrl = context.apiUrl || await promptText("API URL", environment.apiUrl || DEFAULT_API_URL);
  const apiKey = context.apiKey
    || (context.apiKeyStdin ? environment.apiKey : undefined)
    || await promptSecret("API key");
  const result = await loginAction(context, { apiUrl, apiKey });
  if (result.credentialStorage === "keychain") {
    success(`Stored credentials for profile "${result.profileName}".`);
  } else if (result.credentialStorage === "private-file") {
    success(`Stored credentials for profile "${result.profileName}" in a private local file.`);
  } else {
    warn(`Verified credentials for profile "${result.profileName}", but this platform has no secure persistent API-key storage configured. Use HELLOTRACKS_API_KEY, HELLOTRACKS_API_KEY_FILE, or --api-key-stdin for future commands.`);
  }
  return result.whoami;
}

function isInteractiveTerminal(context: CommandContext): boolean {
  return !context.noInput && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
}

// After an email code: say where the key went and when it stops working, never the key itself.
export async function reportStoredEmailCodeKey(command: Command, stored: StoredEmailCodeKey, keyFile?: string): Promise<void> {
  if (keyFile) {
    await writeKeyFile(keyFile, stored.issued.apiKey);
  }
  const context = contextFor(command);
  const { apiKey: _apiKey, ...issued } = stored.issued;
  if (context.output === "json" || context.output === "yaml" || context.output === "ndjson") {
    outputData(command, { ...issued, profile: stored.profileName, apiUrl: stored.apiUrl, credentialStorage: stored.credentialStorage, keyFile: keyFile ?? null }, "pretty");
    return;
  }
  const expires = new Date(issued.apiKeyExpiresAt).toISOString().slice(0, 10);
  success(`Signed in as ${issued.username} for ${issued.companyName}.`);
  if (stored.credentialStorage === "external") {
    warn(`This platform has no key storage; use --key-file or HELLOTRACKS_API_KEY_FILE for later commands.`);
  } else {
    success(`The API key is stored for profile "${stored.profileName}" and works until ${expires}; then run ${toolName()} auth login --email ${issued.username} again.`);
  }
  if (keyFile) {
    success(`Also written to ${keyFile}.`);
  }
}

async function emailCodeLogin(command: Command, options: { email?: string; code?: string; keyFile?: string; }): Promise<void> {
  const context = contextFor(command);
  const email = options.email || (isInteractiveTerminal(context) ? await promptText("Email") : "");
  if (!email) {
    throw new Error("--email is required.");
  }
  let code = options.code;
  if (!code) {
    const sent = await startEmailLoginAction(context, { email });
    if (!isInteractiveTerminal(context)) {
      if (context.output === "json" || context.output === "yaml" || context.output === "ndjson") {
        outputData(command, { ...sent, next: `${toolName()} auth login --email ${email} --code <code>` }, "pretty");
      } else {
        success(`If ${email} is a company admin's login, a 6-digit code is on its way (valid ${Math.round(sent.codeExpiresInSeconds / 60)} minutes).`);
        success(`Finish with: ${toolName()} auth login --email ${email} --code <code>`);
      }
      return;
    }
    success(`If ${email} is a company admin's login, a 6-digit code is on its way.`);
    code = await promptText("Code from the email");
  }
  const stored = await finishEmailLoginAction(context, { email, code });
  await reportStoredEmailCodeKey(command, stored, options.keyFile);
}

export async function ensureAuthenticatedForInteractiveCommand(command: Command): Promise<AuthWhoAmIResponse> {
  const context = contextFor(command);
  const environment = await resolveActionEnvironment(context, { requireAuth: false });
  if (environment.apiKey) {
    try {
      const whoami = await whoamiAction(context);
      success(`Authenticated as ${accountLabel(whoami)}.`);
      return whoami;
    } catch (error) {
      warn(`Stored credentials could not be validated: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    warn(`No API key configured. Sign in before using ${toolName()}.`);
  }

  if (context.noInput || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("No API key configured. Run an auth login command or set HELLOTRACKS_API_KEY.");
  }

  return promptAndStoreLogin(context);
}

export function registerAuth(program: Command): void {
  const auth = program.command("auth").description("Authenticate and manage local CLI profiles");

  auth.command("login")
    .description("Store an API key for the current profile: paste one, or get one with a code sent to your email")
    .option("--replace", "Replace existing stored credentials even if they are valid")
    .option("--email <email>", "Sign in with a 6-digit code sent to this email (company admins); no password or pasted key")
    .option("--code <code>", "The code from the email, with --email")
    .option("--key-file <path>", "With --email: also write the new API key to this file (mode 600), for CI secrets")
    .addHelpText("after", `

Examples:
  ${toolName()} auth login                                   # paste an API key from Settings, API and Integrations
  ${toolName()} auth login --email sam@acme.com              # asks for the code in a terminal
  ${toolName()} auth login --email sam@acme.com --code 482913

A key from an email code works for 90 days. New to Hellotracks? Create a company with: ${toolName()} signup
`)
    .action((options) => runCommand(async () => {
      const command = commandByName(auth, "login");
      if (options.email || options.code) {
        await emailCodeLogin(command, options);
        return;
      }
      const context = contextFor(command);
      const whoami = await promptAndStoreLogin(context, {
        replace: options.replace === true
      });
      outputWhoami(command, whoami, context);
    }));

  auth.command("logout")
    .description("Remove the stored API key from the current profile")
    .action(() => runCommand(async () => {
      const context = contextFor(commandByName(auth, "logout"));
      const result = await logoutAction(context);
      success(`Cleared credentials for profile "${result.profileName}".`);
    }));

  auth.command("whoami")
    .description("Show the current authenticated identity")
    .addHelpText("after", `

Default output is a compact human overview of the selected profile, account, company, and API key.
Use --verbose for read-only account/company details.
Use --json or --output yaml to print the raw public API response.
`)
    .action(() => runCommand(async () => {
      const command = commandByName(auth, "whoami");
      const context = contextFor(command);
      const environment = await resolveActionEnvironment(context);
      const whoami = await whoamiAction(context);
      outputWhoami(command, whoami, { ...context, profile: environment.profileName, apiUrl: environment.apiUrl });
    }));

  auth.command("validate")
    .description("Validate the stored API key")
    .action(() => runCommand(async () => {
      const command = commandByName(auth, "validate");
      const context = contextFor(command);
      const environment = await resolveActionEnvironment(context);
      const whoami = await validateAuthAction(context);
      success("Authentication is valid.");
      outputWhoami(command, whoami, { ...context, profile: environment.profileName, apiUrl: environment.apiUrl });
    }));
}
