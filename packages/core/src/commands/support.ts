import { Command } from "commander";
import { ApiError } from "../client/api-client.js";
import { render } from "../formatters/output.js";
import type { CommandContext } from "../types.js";
import { confirm as confirmPrompt, error as errorTty, promptText, warn as warnTty } from "../ui/tty.js";
import { BULK_FAILED_EXIT_CODE, commandContext, exitCodeForStatus, isInteractive } from "../utils.js";

export function contextFor(command: Command): CommandContext {
  return commandContext(command);
}

export async function promptIfMissing(context: CommandContext, label: string, value?: string): Promise<string> {
  if (value) {
    return value;
  }
  if (!isInteractive(context.noInput)) {
    throw new Error(`Missing required value: ${label}`);
  }
  const answer = await promptText(label);
  if (!answer) {
    throw new Error(`Missing required value: ${label}`);
  }
  return answer;
}

export async function confirmDangerous(context: CommandContext, message: string): Promise<void> {
  if (context.yes) {
    return;
  }
  if (!isInteractive(context.noInput)) {
    throw new Error(`${message}. Re-run with --yes to confirm.`);
  }
  const confirmed = await confirmPrompt(message);
  if (!confirmed) {
    throw new Error("Cancelled.");
  }
}

export function outputData(command: Command, data: unknown, preferred?: "pretty" | "table" | "json" | "yaml"): void {
  render(contextFor(command), data, preferred);
}

// Prints a bulk report and exits with 7 when any record failed, so scripts can't mistake a partial run for success.
export function outputBulkReport(command: Command, report: { summary: { failed: number } }): void {
  outputData(command, report, "pretty");
  if (report.summary.failed > 0) {
    process.exitCode = BULK_FAILED_EXIT_CODE;
  }
}

export function formatListTable<T extends Record<string, unknown>>(items: T[], fields: Array<keyof T>): Array<Record<string, unknown>> {
  return items.map((item) => {
    const row: Record<string, unknown> = {};
    for (const field of fields) {
      row[String(field)] = item[field];
    }
    return row;
  });
}

const MACHINE_OUTPUT_MODES = new Set(["json", "yaml", "ndjson"]);

// With --json, or --output json, yaml or ndjson, errors are JSON too, so a script can read them.
export function wantsMachineErrors(argv: string[] = process.argv): boolean {
  return argv.some((token, index) => token === "--json"
    || (token === "--output" && MACHINE_OUTPUT_MODES.has(argv[index + 1] ?? ""))
    || (token.startsWith("--output=") && MACHINE_OUTPUT_MODES.has(token.slice("--output=".length))));
}

function reportError(code: string, message: string, status: number | undefined, exitCode: number): void {
  if (wantsMachineErrors()) {
    process.stderr.write(`${JSON.stringify({ error: { code, message, status: status ?? null, exitCode } })}\n`);
  } else {
    errorTty(code === "error" ? message : `${code}: ${message}`);
  }
  process.exitCode = exitCode;
}

export async function runCommand(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ApiError) {
      reportError(error.code, error.message, error.statusCode, exitCodeForStatus(error.statusCode));
      return;
    }
    reportError("error", error instanceof Error ? error.message : String(error), undefined, 1);
  }
}

export function boolFlag(value?: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean value: ${value}`);
}

export function parseHeaders(headers: string[] | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const header of headers ?? []) {
    const index = header.indexOf("=");
    if (index <= 0) {
      throw new Error(`Invalid header: ${header}`);
    }
    result[header.slice(0, index)] = header.slice(index + 1);
  }
  return result;
}

export function maybeWarn(context: CommandContext, message: string): void {
  if (!context.quiet) {
    warnTty(message);
  }
}
