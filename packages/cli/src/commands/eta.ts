import { Command } from "commander";
import {
  createEtaSessionAction,
  getEtaSessionAction,
  listEtaSessionEventsAction,
  listEtaSessionsAction,
  refreshEtaSessionAction,
  revokeEtaSessionAction,
  updateEtaSessionAction,
  type EtaSessionCreateBody,
  type EtaSessionUpdateBody
} from "@hellotracks/ht-core/actions/index.js";
import { confirmDangerous, contextFor, formatListTable, outputData, runCommand } from "@hellotracks/ht-core/commands/support.js";
import type { CommandContext } from "@hellotracks/ht-core/types.js";

type JsonRecord = Record<string, unknown>;

function cleanObject<T extends JsonRecord>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) =>
    value !== undefined
    && value !== ""
    && !(Array.isArray(value) && value.length === 0)
  )) as T;
}

function rawMode(context: CommandContext): boolean {
  return context.output === "json" || context.output === "yaml" || context.output === "ndjson";
}

function stringOption(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberOption(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid number: ${value}`);
    }
    return parsed;
  }
  return undefined;
}

function sessionRows(items: JsonRecord[]): JsonRecord[] {
  return formatListTable(items.map((item) => ({
    id: item.id,
    jobId: item.jobId,
    recipient: item.recipientName || item.recipientEmail || item.recipientPhone,
    status: item.status,
    recipientStatus: item.recipientStatus,
    expiresAt: formatDate(item.expiresAt),
    url: item.publicUrl
  })), ["id", "jobId", "recipient", "status", "recipientStatus", "expiresAt", "url"]);
}

function eventRows(items: JsonRecord[]): JsonRecord[] {
  return formatListTable(items.map((item) => ({
    createdAt: formatDate(item.createdAt),
    type: item.type,
    actor: item.actor,
    detail: item.detail
  })), ["createdAt", "type", "actor", "detail"]);
}

function jobLines(job: unknown): string[] {
  if (typeof job !== "object" || job === null) {
    return [];
  }
  const record = job as JsonRecord;
  const window = record.timeWindow as JsonRecord | undefined;
  return [
    record.address ? `  address: ${record.address}` : "",
    window ? `  timeWindow: ${window.start ?? ""}-${window.end ?? ""}` : ""
  ].filter(Boolean);
}

// With --job the API also says whether the job's ETA email went out.
function emailNotificationLine(notification: unknown): string {
  if (typeof notification !== "object" || notification === null) {
    return "";
  }
  const record = notification as JsonRecord;
  return `\nETA email: ${record.status ?? ""}${record.reason ? ` (${record.reason})` : ""}${record.email ? ` to ${record.email}` : ""}`;
}

function sessionSummary(session: JsonRecord): string {
  const lines = [
    "ETA Session",
    `  url: ${session.publicUrl || ""}`,
    `  id: ${session.id || ""}`,
    `  job: ${session.jobId || ""}`,
    ...jobLines(session.job),
    `  recipient: ${session.recipientName || session.recipientEmail || session.recipientPhone || ""}`,
    `  status: ${session.status || ""}`,
    `  recipientStatus: ${session.recipientStatus || ""}`,
    `  showWorkerName: ${Boolean(session.showWorkerName)}`,
    `  showMap: ${Boolean(session.showMap)}`,
    `  etaWindow: ${formatWindow(session.etaWindowStart, session.etaWindowEnd)}`,
    `  expiresAt: ${formatDate(session.expiresAt)}`
  ];
  if (session.readyConfirmedAt) {
    lines.push(`  readyConfirmedAt: ${formatDate(session.readyConfirmedAt)}`);
  }
  if (session.accessNotes) {
    lines.push(`  accessNotes: ${session.accessNotes}`);
  }
  if (session.rescheduleRequestedAt) {
    lines.push(`  rescheduleRequestedAt: ${formatDate(session.rescheduleRequestedAt)}`);
  }
  if (session.rescheduleNote) {
    lines.push(`  rescheduleNote: ${session.rescheduleNote}`);
  }
  return lines.join("\n");
}

function visibilityCreateOptions(options: Record<string, unknown>) {
  return visibilityUpdateOptions(options);
}

function visibilityUpdateOptions(options: Record<string, unknown>) {
  if (options.showWorkerName && options.hideWorkerName) {
    throw new Error("Use either --show-worker-name or --hide-worker-name, not both.");
  }
  if (options.showMap && options.hideMap) {
    throw new Error("Use either --show-map or --hide-map, not both.");
  }
  return cleanObject({
    showWorkerName: options.showWorkerName ? true : options.hideWorkerName ? false : undefined,
    showMap: options.showMap ? true : options.hideMap ? false : undefined
  });
}

function formatDate(value: unknown): string {
  const ts = typeof value === "number" ? value : typeof value === "string" && value ? Number(value) : 0;
  return Number.isFinite(ts) && ts > 0 ? new Date(ts).toLocaleString() : "";
}

function formatWindow(start: unknown, end: unknown): string {
  const startText = formatDate(start);
  const endText = formatDate(end);
  if (startText && endText) {
    return `${startText} - ${endText}`;
  }
  return startText || endText || "";
}

function snippet(session: JsonRecord, format: string): string {
  const title = String(session.title || "your appointment");
  const url = String(session.publicUrl || "");
  if (format === "text") {
    return `Track ${title} and add arrival instructions here: ${url}`;
  }
  if (format !== "email") {
    throw new Error("format must be email or text.");
  }
  return [
    `Subject: Arrival details for ${title}`,
    "",
    "Hello,",
    "",
    `You can view arrival status, confirm readiness, and add access instructions here:`,
    url,
    "",
    "Thank you."
  ].join("\n");
}

function createBody(options: Record<string, unknown>): EtaSessionCreateBody {
  const jobId = stringOption(options.job);
  if (!jobId) {
    throw new Error("--job is required.");
  }
  return cleanObject({
    jobId,
    recipientName: stringOption(options.recipientName),
    recipientPhone: stringOption(options.recipientPhone),
    recipientEmail: stringOption(options.recipientEmail),
    title: stringOption(options.title),
    ...visibilityCreateOptions(options),
    expires: stringOption(options.expires)
  });
}

function updateBody(options: Record<string, unknown>): EtaSessionUpdateBody {
  return cleanObject({
    recipientName: stringOption(options.recipientName),
    recipientPhone: stringOption(options.recipientPhone),
    recipientEmail: stringOption(options.recipientEmail),
    title: stringOption(options.title),
    ...visibilityUpdateOptions(options),
    expires: stringOption(options.expires)
  });
}

export function registerEta(program: Command): void {
  const eta = program.command("eta")
    .description("Create and manage ETA pages, live arrival pages for the people a job is for")
    .addHelpText("after", `
Examples:
  ht eta create --job job-123
  ht eta list --date today
  ht eta get eta_123
  ht eta snippet eta_123 --format email
  ht eta revoke eta_123 --yes

ETA pages are link-first. The CLI creates public arrival pages; your CRM, email, portal, or existing SMS provider distributes the link.
Use visibility flags to choose what the recipient sees. Omit them to use the company ETA Page defaults.
`);

  eta.command("create")
    .description("Create a recipient arrival page for one job")
    .requiredOption("--job <job-id>", "Hellotracks job id")
    .option("--recipient-name <name>", "Recipient display name")
    .option("--recipient-phone <phone>", "Recipient phone stored on the ETA session")
    .option("--recipient-email <email>", "Recipient email stored on the ETA session")
    .option("--title <title>", "Public page title")
    .option("--show-worker-name", "Let recipients see the assigned worker name")
    .option("--hide-worker-name", "Keep the assigned worker name hidden")
    .option("--show-map", "Let recipients see the live map while the worker is on the way")
    .option("--hide-map", "Keep the live map hidden")
    .option("--expires <duration>", "Expiry duration such as 7d, 30d, or 90d")
    .addHelpText("after", `
Examples:
  ht eta create --job 6658741c9f39a9d1a87f1111
  ht eta create --job job-123 --title "Service visit" --show-worker-name --expires 30d
  ht eta create --job job-123 --hide-worker-name --hide-map
  ht eta create --job job-123 --title "Service visit" --show-map
`)
    .action((options, command) => runCommand(async () => {
      const context = contextFor(command);
      const result = await createEtaSessionAction(context, createBody(options));
      outputData(command, rawMode(context) ? result : sessionSummary(result.session));
    }));

  eta.command("list")
    .description("List ETA page sessions")
    .option("--date <date>", "Filter by job date; supports today and yesterday")
    .option("--job <job-id>", "Filter by linked job id")
    .option("--limit <count>", "Maximum sessions to return", "50")
    .action((options, command) => runCommand(async () => {
      const context = contextFor(command);
      const result = await listEtaSessionsAction(context, cleanObject({
        date: stringOption(options.date),
        jobId: stringOption(options.job),
        limit: numberOption(options.limit)
      }));
      if (rawMode(context) || !(result as JsonRecord).emailNotification || !["pretty", "table"].includes(context.output)) {
        outputData(command, rawMode(context) ? result : sessionRows(result.items), "table");
        return;
      }
      outputData(command, sessionRows(result.items), "table");
      process.stdout.write(`${emailNotificationLine((result as JsonRecord).emailNotification)}\n`);
    }));

  const get = eta.command("get")
    .description("Show one ETA page session")
    .argument("<session-id>", "Session id or token")
    .action((id) => runCommand(async () => {
      const context = contextFor(get);
      const result = await getEtaSessionAction(context, id);
      outputData(get, rawMode(context) ? result : sessionSummary(result.session));
    }));

  eta.command("update")
    .description("Update recipient, title, what recipients see, or expiry for one ETA page session")
    .argument("<session-id>", "Session id or token")
    .option("--recipient-name <name>", "Recipient display name")
    .option("--recipient-phone <phone>", "Recipient phone")
    .option("--recipient-email <email>", "Recipient email")
    .option("--title <title>", "Public page title")
    .option("--show-worker-name", "Let recipients see the assigned worker name")
    .option("--hide-worker-name", "Hide the assigned worker name from recipients")
    .option("--show-map", "Let recipients see the live map while the worker is on the way")
    .option("--hide-map", "Hide the live map from recipients")
    .option("--expires <duration>", "Reset expiry relative to now, such as 7d or 30d")
    .addHelpText("after", `
Examples:
  ht eta update eta_123 --show-worker-name --show-map
  ht eta update eta_123 --hide-map
  ht eta update eta_123 --recipient-email sam@example.com --title "Repair visit"
`)
    .action((id, options, command) => runCommand(async () => {
      const context = contextFor(command);
      const body = updateBody(options);
      if (Object.keys(body).length === 0) {
        throw new Error("Provide at least one field to update.");
      }
      const result = await updateEtaSessionAction(context, id, body);
      outputData(command, rawMode(context) ? result : sessionSummary(result.session));
    }));

  const refresh = eta.command("refresh")
    .description("Refresh computed ETA/status for one session")
    .argument("<session-id>", "Session id or token")
    .action((id) => runCommand(async () => {
      const context = contextFor(refresh);
      const result = await refreshEtaSessionAction(context, id);
      outputData(refresh, rawMode(context) ? result : sessionSummary(result.session));
    }));

  eta.command("events")
    .description("List recipient and system events for one session")
    .argument("<session-id>", "Session id or token")
    .option("--limit <count>", "Maximum events to return", "100")
    .action((id, options, command) => runCommand(async () => {
      const context = contextFor(command);
      const result = await listEtaSessionEventsAction(context, id, { limit: numberOption(options.limit) });
      outputData(command, rawMode(context) ? result : eventRows(result.items), "table");
    }));

  eta.command("snippet")
    .description("Generate copyable link copy for CRM/email/portal distribution")
    .argument("<session-id>", "Session id or token")
    .option("--format <format>", "email | text", "email")
    .action((id, options, command) => runCommand(async () => {
      const result = await getEtaSessionAction(contextFor(command), id);
      outputData(command, snippet(result.session, String(options.format || "email")));
    }));

  const revoke = eta.command("revoke")
    .description("Revoke a public ETA page link")
    .argument("<session-id>", "Session id or token")
    .action((id) => runCommand(async () => {
      const context = contextFor(revoke);
      await confirmDangerous(context, `Revoke ETA session ${id}`);
      const result = await revokeEtaSessionAction(context, id);
      outputData(revoke, result);
    }));
}
