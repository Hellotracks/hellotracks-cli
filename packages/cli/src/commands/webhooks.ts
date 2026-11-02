import { Command, Option } from "commander";
import { listWebhooksAction, updateWebhooksAction, type WebhookWriteConfig } from "@hellotracks/ht-core/actions/index.js";
import { formatListTable, outputData, parseHeaders, runCommand, contextFor } from "@hellotracks/ht-core/commands/support.js";

function webhookRows(webhooks: Record<string, { url?: string; hasHeaders?: boolean; headerNames?: string[] }>): Array<Record<string, unknown>> {
  return Object.entries(webhooks).map(([event, config]) => ({
    event,
    url: config.url ?? "",
    headers: config.headerNames?.join(", ") ?? (config.hasHeaders ? "configured" : "")
  }));
}

export const WEBHOOK_EVENTS = [
  "job_created",
  "job_updated",
  "job_completed",
  "job_archived",
  "job_deleted",
  "job_checked",
  "place_checked",
  "clock_in_out",
  "alert_triggered"
];

// The API skips unknown event names without an error, so check them here; job.updated is accepted as job_updated.
function parseWebhookEvent(value: string): string {
  const event = value.trim().toLowerCase().replace(/\./g, "_");
  if (!WEBHOOK_EVENTS.includes(event)) {
    throw new Error(`Unknown webhook event: ${value}. Use one of: ${WEBHOOK_EVENTS.join(", ")}.`);
  }
  return event;
}

export function registerWebhooks(program: Command): void {
  const webhooks = program.command("webhooks").description("Inspect and update webhooks");

  webhooks.command("list")
    .description("List the webhook URL and header names for every event")
    .action(() => runCommand(async () => {
      const command = webhooks.commands.find((entry) => entry.name() === "list")!;
      const data = await listWebhooksAction(contextFor(command));
      outputData(command, formatListTable(webhookRows(data.webhooks), ["event", "url", "headers"]), "table");
    }));

  webhooks.command("set")
    .description("Set the URL and headers Hellotracks posts to for one event")
    .addOption(new Option("--event <event>", `Event: ${WEBHOOK_EVENTS.join(", ")}`).makeOptionMandatory().argParser(parseWebhookEvent))
    .option("--url <url>", "HTTPS endpoint that receives the event")
    .option("--disable", "Clear the webhook URL and its headers")
    .option("--header <key=value...>", "Header sent with every call, for example Authorization=Bearer ...; replaces the saved headers")
    .addHelpText("after", `

Examples:
  ht webhooks set --event job_completed --url https://ops.example.com/hooks/job-completed
  ht webhooks set --event job_updated --url https://ops.example.com/hooks/job-updated --header "Authorization=Bearer $TOKEN"
  ht webhooks set --event alert_triggered --disable

Without --header the saved headers stay as they are.
`)
    .action((options) => runCommand(async () => {
      const command = webhooks.commands.find((entry) => entry.name() === "set")!;
      if (!options.disable && options.url === undefined && options.header === undefined) {
        throw new Error("Pass --url, --header, or --disable.");
      }
      const config: WebhookWriteConfig = options.disable ? { url: "", headers: {} } : {};
      if (!options.disable && options.url !== undefined) {
        config.url = String(options.url);
      }
      if (!options.disable && options.header !== undefined) {
        config.headers = parseHeaders(options.header);
      }
      const next: Record<string, WebhookWriteConfig> = { [String(options.event)]: config };
      const data = await updateWebhooksAction(contextFor(command), { webhooks: next });
      outputData(command, formatListTable(webhookRows(data.webhooks), ["event", "url", "headers"]), "table");
    }));
}
