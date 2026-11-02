import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import type { CommandContext, GlobalOptions, OutputMode } from "./types.js";

export const DEFAULT_PROFILE = "default";

let currentToolName = "ht";

// Messages name the tool that is running; other programs built on this core set their own name.
export function setToolName(name: string): void {
  currentToolName = name;
}

export function toolName(): string {
  return currentToolName;
}
export const DEFAULT_API_URL = "https://api.hellotracks.com/v1";

export function configDir(): string {
  return path.join(os.homedir(), ".config", "hellotracks-cli");
}

export function configPath(): string {
  return path.join(configDir(), "config.json");
}

export function parseBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean value: ${value}`);
}

export function localDateString(offsetDays = 0, now: Date = new Date()): string {
  const date = new Date(now.getTime());
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const DATE_WORD_OFFSETS: Record<string, number> = { yesterday: -1, today: 0, tomorrow: 1 };

// The public API only accepts YYYY-MM-DD, so today, yesterday and tomorrow become the local calendar date here.
export function resolveDateWord(value: string | undefined, now: Date = new Date()): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const offset = DATE_WORD_OFFSETS[value.trim().toLowerCase()];
  return offset === undefined ? value : localDateString(offset, now);
}

export function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer value: ${value}`);
  }
  return parsed;
}

export function splitCsv(values: string[]): string[] {
  return values.flatMap((value) => value.split(",")).map((part) => part.trim()).filter(Boolean);
}

export function keyValuePairs(values: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const value of values) {
    const index = value.indexOf("=");
    if (index <= 0) {
      throw new Error(`Invalid key=value pair: ${value}`);
    }
    result[value.slice(0, index)] = value.slice(index + 1);
  }
  return result;
}

export function commandContext(command: Command): CommandContext {
  const opts = command.optsWithGlobals<GlobalOptions>();
  return createCommandContext(opts);
}

export function createCommandContext(opts: Partial<GlobalOptions>): CommandContext {
  const noInput = Boolean(opts.noInput) || (opts as Partial<GlobalOptions> & { input?: boolean }).input === false;
  const output: OutputMode = opts.json ? "json" : opts.output ?? "pretty";
  if (opts.confirmProfile && opts.profile && opts.confirmProfile !== opts.profile) {
    throw new Error(`Profile confirmation failed: expected "${opts.confirmProfile}" but active profile is "${opts.profile}".`);
  }
  return {
    profile: opts.profile ?? DEFAULT_PROFILE,
    profileExplicit: Boolean(opts.profile),
    apiUrl: opts.apiUrl,
    apiKey: opts.apiKey,
    apiKeyStdin: Boolean(opts.apiKeyStdin),
    output,
    noInput,
    quiet: Boolean(opts.quiet),
    verbose: Boolean(opts.verbose),
    yes: Boolean(opts.yes),
    updateCheck: opts.updateCheck !== false,
    fields: opts.fields,
    sort: opts.sort,
    requestId: opts.requestId,
    confirmProfile: opts.confirmProfile,
    integrationSource: opts.integrationSource,
    clientUserAgent: opts.clientUserAgent
  };
}

export function isInteractive(noInput: boolean): boolean {
  return !noInput && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
}

// A bulk import or sync that finished but left records unwritten (see the report's summary.failed and errors).
export const BULK_FAILED_EXIT_CODE = 7;

export function exitCodeForStatus(statusCode: number): number {
  if (statusCode === 401) return 2;
  if (statusCode === 400) return 3;
  if (statusCode === 404) return 4;
  if (statusCode === 409) return 5;
  if (statusCode === 429) return 6;
  if (statusCode >= 500) return 10;
  return 1;
}
