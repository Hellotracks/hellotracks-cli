import fs from "node:fs/promises";
import { Command } from "commander";
import {
  createAlertConfigAction,
  deleteAlertConfigAction,
  deleteAlertInstanceAction,
  generateReportAction,
  getAlertConfigAction,
  getAlertInstanceAction,
  listAlertActionsAction,
  listAlertConfigsAction,
  listAlertInstancesAction,
  listMembersAction,
  listPlacesAction,
  listZonesAction,
  showCompanyAction,
  updateAlertConfigAction,
  updateAlertInstanceAction,
  reportFileUrl
} from "@hellotracks/ht-core/actions/index.js";
import { readStructuredFile, stringifyStructured } from "@hellotracks/ht-core/bulk/index.js";
import { confirmDangerous, contextFor, formatListTable, outputData, runCommand } from "@hellotracks/ht-core/commands/support.js";
import type { CommandContext } from "@hellotracks/ht-core/types.js";
import { resolveDateWord } from "@hellotracks/ht-core/utils.js";

type JsonRecord = Record<string, unknown>;

const ALERT_TEMPLATE_EXAMPLES: Record<string, JsonRecord> = {
  "no-check-out": {
    title: "Missing check-out",
    action: "no_check_out",
    memberIds: ["member-id"],
    placeIds: [],
    weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    timeStart: "08:00",
    timeEnd: "18:00",
    emails: ["ops@example.com"]
  },
  idle: {
    title: "Idle for more than one hour",
    action: "idle",
    duration: "1h",
    memberIds: ["member-id"],
    weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    timeStart: "08:00",
    timeEnd: "18:00",
    emails: ["ops@example.com"]
  },
  "battery-low": {
    title: "Battery low",
    action: "battery_low",
    memberIds: ["member-id"],
    description: "Your battery is low. Please charge your device.",
    weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
    timeStart: "00:00",
    timeEnd: "24:00"
  },
  "zone-entry": {
    title: "Entered restricted zone",
    action: "enters_zone",
    memberIds: ["member-id"],
    zoneIds: ["zone-id"],
    weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    timeStart: "08:00",
    timeEnd: "18:00",
    emails: ["ops@example.com"]
  }
};

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanObject(record: JsonRecord): JsonRecord {
  return Object.fromEntries(Object.entries(record).filter(([, value]) =>
    value !== undefined
    && value !== ""
    && !(Array.isArray(value) && value.length === 0)
  ));
}

function rawMode(context: CommandContext): boolean {
  return context.output === "json" || context.output === "yaml";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function joinList(value: unknown): string {
  return stringArray(value).join(",");
}

function actionRows(items: JsonRecord[]): JsonRecord[] {
  return formatListTable(items.map((item) => ({
    action: item.name,
    code: item.code,
    place: item.requiresPlace ? "yes" : "no",
    duration: item.requiresDuration ? "yes" : "no",
    zone: item.requiresZone ? "yes" : "no",
    and: item.supportsAndCondition ? "yes" : "no"
  })), ["action", "code", "place", "duration", "zone", "and"]);
}

function zoneRows(items: JsonRecord[]): JsonRecord[] {
  return formatListTable(items.map((item) => ({
    id: item.id,
    title: item.title ?? item.name,
    points: item.pointCount,
    color: item.color
  })), ["id", "title", "points", "color"]);
}

function configScope(config: JsonRecord): string {
  const parts = [
    stringArray(config.memberIds).length ? `${stringArray(config.memberIds).length} members` : "",
    stringArray(config.teamIds).length ? `teams ${joinList(config.teamIds)}` : "",
    stringArray(config.placeIds).length ? `${stringArray(config.placeIds).length} places` : "",
    stringArray(config.zoneIds).length ? `${stringArray(config.zoneIds).length} zones` : ""
  ].filter(Boolean);
  return parts.join("; ") || "company";
}

function configDestinations(config: JsonRecord): string {
  const parts = [
    stringArray(config.emails).length ? `${stringArray(config.emails).length} emails` : "",
    config.phone ? "phone" : "",
    config.slackChannelId ? "slack" : ""
  ].filter(Boolean);
  return parts.join(", ") || "none";
}

function configSchedule(config: JsonRecord): string {
  const days = stringArray(config.weekdayNames);
  const dayText = days.length === 7 ? "daily" : days.length > 0 ? days.map((day) => day.slice(0, 3)).join(",") : "no days";
  return `${dayText} ${config.timeStart ?? ""}-${config.timeEnd ?? ""}`.trim();
}

function configRows(items: JsonRecord[]): JsonRecord[] {
  return formatListTable(items.map((item) => ({
    id: item.id,
    title: item.title,
    action: [item.action, item.andAction ? `+${item.andAction}` : ""].filter(Boolean).join(" "),
    scope: configScope(item),
    schedule: configSchedule(item),
    destinations: configDestinations(item),
    status: item.statusText
  })), ["id", "title", "action", "scope", "schedule", "destinations", "status"]);
}

function instanceRows(items: JsonRecord[]): JsonRecord[] {
  return formatListTable(items.map((item) => ({
    time: item.createdAt,
    config: item.configTitle ?? item.configId ?? item.config,
    status: item.statusText,
    message: item.message,
    id: item.id
  })), ["time", "config", "status", "message", "id"]);
}

function renderConfig(config: JsonRecord): string {
  return [
    "Alert Config",
    `  id: ${config.id}  [read-only]`,
    `  title: ${config.title}  (--title)`,
    `  status: ${config.statusText}  (pause/resume or --status)`,
    "",
    "Trigger",
    `  action: ${config.action}  (--action)`,
    config.andAction ? `  andAction: ${config.andAction}  (--and-action)` : "",
    config.duration ? `  duration: ${config.duration}  (--duration)` : "",
    "",
    "Scope",
    `  members: ${joinList(config.memberIds) || "none"}  (--member)`,
    `  teams: ${joinList(config.teamIds) || "none"}  (--team)`,
    `  places: ${joinList(config.placeIds) || "anywhere"}  (--place)`,
    stringArray(config.zoneIds).length ? `  zones: ${joinList(config.zoneIds)}  (--zone)` : "",
    "",
    "Schedule",
    `  weekdays: ${joinList(config.weekdayNames) || config.weekdays}  (--weekday)`,
    `  time: ${config.timeStart}-${config.timeEnd}  (--time-start, --time-end)`,
    "",
    "Destinations",
    `  emails: ${joinList(config.emails) || "none"}  (--email)`,
    `  phone: ${config.phone || "none"}  (--phone)`,
    `  slackChannelId: ${config.slackChannelId || "none"}  (--slack-channel)`,
    config.description ? `\nMessage\n  description: ${config.description}  (--description)` : "",
    "",
    "Use --json or --output yaml for the raw API response."
  ].filter((line) => line !== "").join("\n");
}

function normalizeTemplateInput(input: unknown): JsonRecord {
  if (!isRecord(input)) {
    throw new Error("Alert config must be a JSON/YAML object.");
  }
  validateAlertConfig(input);
  return cleanObject(input);
}

function validateAlertConfig(input: JsonRecord): void {
  if (input.title !== undefined && typeof input.title !== "string") {
    throw new Error("title must be a string.");
  }
  if (input.action !== undefined && typeof input.action !== "string") {
    throw new Error("action must be a string.");
  }
  for (const field of ["memberIds", "teamIds", "placeIds", "andPlaceIds", "zoneIds", "emails", "weekdays"]) {
    if (input[field] !== undefined && !Array.isArray(input[field])) {
      throw new Error(`${field} must be an array.`);
    }
  }
}

async function resolveMemberIds(context: CommandContext, selectors: string[]): Promise<string[] | undefined> {
  if (selectors.length === 0) return undefined;
  const all = await listMembersAction(context);
  return selectors.map((selector) => {
    const normalized = selector.toLowerCase();
    const direct = all.items.find((item) => String(item.id ?? "").toLowerCase() === normalized);
    if (direct) return String(direct.id);
    const matches = all.items.filter((item) =>
      ["username", "email", "name"].some((field) => String(item[field] ?? "").toLowerCase() === normalized)
    );
    if (matches.length !== 1) {
      throw new Error(matches.length === 0 ? `No member matched ${selector}.` : `Member selector is ambiguous: ${selector}.`);
    }
    return String(matches[0]?.id);
  });
}

async function resolvePlaceIds(context: CommandContext, selectors: string[]): Promise<string[] | undefined> {
  if (selectors.length === 0) return undefined;
  const result: string[] = [];
  for (const selector of selectors) {
    const exact = await listPlacesAction(context, { uids: selector });
    if (exact.items.length === 1) {
      result.push(String(exact.items[0]?.id));
      continue;
    }
    const queried = await listPlacesAction(context, { query: selector, max: 50 });
    const normalized = selector.toLowerCase();
    const matches = queried.items.filter((item) =>
      ["id", "name", "address"].some((field) => String(item[field] ?? "").toLowerCase() === normalized)
    );
    if (matches.length === 1) {
      result.push(String(matches[0]?.id));
      continue;
    }
    if (queried.items.length === 1) {
      result.push(String(queried.items[0]?.id));
      continue;
    }
    throw new Error(queried.items.length === 0 ? `No place matched ${selector}.` : `Place selector is ambiguous: ${selector}.`);
  }
  return result;
}

async function resolveZoneIds(context: CommandContext, selectors: string[]): Promise<string[] | undefined> {
  if (selectors.length === 0) return undefined;
  const zones = await listZonesAction(context);
  return selectors.map((selector) => {
    const normalized = selector.toLowerCase();
    const matches = zones.items.filter((item) =>
      ["id", "name", "title"].some((field) => String(item[field] ?? "").toLowerCase() === normalized)
    );
    if (matches.length !== 1) {
      throw new Error(matches.length === 0 ? `No zone matched ${selector}.` : `Zone selector is ambiguous: ${selector}.`);
    }
    return String(matches[0]?.id);
  });
}

async function resolveTeamIds(context: CommandContext, selectors: string[]): Promise<string[] | undefined> {
  if (selectors.length === 0) return undefined;
  const company = await showCompanyAction(context);
  const teams = Array.isArray(company.teamsConfig) ? company.teamsConfig.filter(isRecord) : [];
  return selectors.map((selector) => {
    const normalized = selector.toLowerCase();
    if (/^\d+$/.test(selector)) {
      return selector;
    }
    const matches = teams.filter((team) => String(team.name ?? "").toLowerCase() === normalized);
    if (matches.length !== 1) {
      throw new Error(matches.length === 0 ? `No team matched ${selector}. Use the numeric team id.` : `Team selector is ambiguous: ${selector}.`);
    }
    return String(matches[0]?.id);
  });
}

function addConfigOptions(command: Command): Command {
  return command
    .option("--file <file>", "Read alert config JSON/YAML")
    .option("--format <format>", "Template/input format for --file or template output", "json")
    .option("--title <title>", "Alert name")
    .option("--description <text>", "Alert message/description")
    .option("--action <action>", "Alert action name")
    .option("--and-action <action>", "Optional second action for check-in/out alerts")
    .option("--duration <duration>", "Duration like 10m, 30m, 1h, 2h, or milliseconds")
    .option("--member <selector>", "Member id, username, email, or exact name; repeatable", collect, [])
    .option("--team <selector>", "Team id or exact team name; repeatable", collect, [])
    .option("--place <selector>", "Place id or exact name; repeatable", collect, [])
    .option("--and-place <selector>", "Second condition place id or exact name; repeatable", collect, [])
    .option("--zone <selector>", "Zone id or exact name; repeatable", collect, [])
    .option("--email <email>", "Notification email; repeatable", collect, [])
    .option("--phone <phone>", "Phone number to notify when the alert fires")
    .option("--slack-channel <id>", "Slack channel id that gets the alert")
    .option("--weekday <weekday>", "Weekday name; repeatable", collect, [])
    .option("--time-start <time>", "HH:mm")
    .option("--time-end <time>", "HH:mm")
    .option("--status <status>", "active | paused | deleted");
}

async function buildConfigBody(context: CommandContext, options: Record<string, unknown>): Promise<JsonRecord> {
  const file = typeof options.file === "string" ? options.file : undefined;
  const fileBody = file ? normalizeTemplateInput(await readStructuredFile(file, String(options.format ?? "json"))) : {};
  const body = {
    ...fileBody,
    title: options.title,
    description: options.description,
    action: options.action,
    andAction: options.andAction,
    duration: options.duration,
    memberIds: await resolveMemberIds(context, options.member as string[] ?? []),
    teamIds: await resolveTeamIds(context, options.team as string[] ?? []),
    placeIds: await resolvePlaceIds(context, options.place as string[] ?? []),
    andPlaceIds: await resolvePlaceIds(context, options.andPlace as string[] ?? []),
    zoneIds: await resolveZoneIds(context, options.zone as string[] ?? []),
    emails: options.email as string[] | undefined,
    phone: options.phone,
    slackChannelId: options.slackChannel,
    weekdays: options.weekday as string[] | undefined,
    timeStart: options.timeStart,
    timeEnd: options.timeEnd,
    status: options.status
  };
  return cleanObject(body);
}

async function writeReportFile(result: Awaited<ReturnType<typeof generateReportAction>>, explicitFile?: string): Promise<string> {
  const filename = explicitFile || result.filename || "alerts-report";
  await fs.writeFile(filename, result.body);
  return filename;
}

export function registerAlerts(program: Command): void {
  const alerts = program.command("alerts")
    .description("Manage alert configs and recent triggered alerts")
    .addHelpText("after", `

Examples:
  ht alerts actions
  ht alerts configs template no-check-out --format yaml
  ht alerts configs create --title "Missing check-out" --action no_check_out --member alice --email ops@example.com --time-start 08:00 --time-end 18:00
  ht alerts recent --limit 20
  ht alerts report --from 2026-05-01 --until 2026-05-28 --format csv --file alerts.csv
`);

  alerts.command("actions")
    .description("List supported alert actions")
    .action(() => runCommand(async () => {
      const command = alerts.commands.find((entry) => entry.name() === "actions")!;
      const data = await listAlertActionsAction(contextFor(command));
      outputData(command, rawMode(contextFor(command)) ? data : actionRows(data.items), "table");
    }));

  alerts.command("zones")
    .description("List zones that can be used by zone alerts")
    .action(() => runCommand(async () => {
      const command = alerts.commands.find((entry) => entry.name() === "zones")!;
      const data = await listZonesAction(contextFor(command));
      outputData(command, rawMode(contextFor(command)) ? data : zoneRows(data.items), "table");
    }));

  const configs = alerts.command("configs").description("Manage alert configurations");

  configs.command("list")
    .description("List alert configurations")
    .option("--status <status>", "active | paused | all | deleted", "active")
    .action((options) => runCommand(async () => {
      const command = configs.commands.find((entry) => entry.name() === "list")!;
      const data = await listAlertConfigsAction(contextFor(command), { status: options.status });
      outputData(command, rawMode(contextFor(command)) ? data : configRows(data.items), "table");
    }));

  configs.command("get")
    .argument("<id>", "Alert config id")
    .description("Show one alert configuration")
    .action((id) => runCommand(async () => {
      const command = configs.commands.find((entry) => entry.name() === "get")!;
      const data = await getAlertConfigAction(contextFor(command), id);
      outputData(command, rawMode(contextFor(command)) ? data.config : renderConfig(data.config), "pretty");
    }));

  addConfigOptions(configs.command("create")
    .description("Create an alert configuration"))
    .action((options) => runCommand(async () => {
      const command = configs.commands.find((entry) => entry.name() === "create")!;
      const context = contextFor(command);
      const body = await buildConfigBody(context, options);
      const data = await createAlertConfigAction(context, body);
      outputData(command, rawMode(context) ? data.config : renderConfig(data.config), "pretty");
    }));

  addConfigOptions(configs.command("update")
    .argument("<id>", "Alert config id")
    .description("Update an alert configuration"))
    .action((id, options) => runCommand(async () => {
      const command = configs.commands.find((entry) => entry.name() === "update")!;
      const context = contextFor(command);
      const body = await buildConfigBody(context, options);
      const data = await updateAlertConfigAction(context, id, body);
      outputData(command, rawMode(context) ? data.config : renderConfig(data.config), "pretty");
    }));

  configs.command("pause")
    .argument("<id>", "Alert config id")
    .description("Pause an alert configuration")
    .action((id) => runCommand(async () => {
      const command = configs.commands.find((entry) => entry.name() === "pause")!;
      const data = await updateAlertConfigAction(contextFor(command), id, { status: "paused" });
      outputData(command, rawMode(contextFor(command)) ? data.config : renderConfig(data.config), "pretty");
    }));

  configs.command("resume")
    .argument("<id>", "Alert config id")
    .description("Resume an alert configuration")
    .action((id) => runCommand(async () => {
      const command = configs.commands.find((entry) => entry.name() === "resume")!;
      const data = await updateAlertConfigAction(contextFor(command), id, { status: "active" });
      outputData(command, rawMode(contextFor(command)) ? data.config : renderConfig(data.config), "pretty");
    }));

  configs.command("delete")
    .argument("<id>", "Alert config id")
    .description("Delete an alert configuration")
    .action((id) => runCommand(async () => {
      const command = configs.commands.find((entry) => entry.name() === "delete")!;
      const context = contextFor(command);
      await confirmDangerous(context, `Delete alert config ${id}?`);
      outputData(command, await deleteAlertConfigAction(context, id), "pretty");
    }));

  configs.command("duplicate")
    .argument("<id>", "Alert config id")
    .requiredOption("--title <title>", "Title for the duplicated config")
    .description("Duplicate an alert configuration")
    .action((id, options) => runCommand(async () => {
      const command = configs.commands.find((entry) => entry.name() === "duplicate")!;
      const context = contextFor(command);
      const current = (await getAlertConfigAction(context, id)).config;
      const body = cleanObject({
        title: options.title,
        description: current.description,
        action: current.action,
        andAction: current.andAction,
        duration: current.duration,
        memberIds: current.memberIds,
        teamIds: current.teamIds,
        placeIds: current.placeIds,
        andPlaceIds: current.andPlaceIds,
        zoneIds: current.zoneIds,
        emails: current.emails,
        phone: current.phone,
        slackChannelId: current.slackChannelId,
        weekdays: current.weekdayNames,
        timeStart: current.timeStart,
        timeEnd: current.timeEnd,
        status: "active"
      });
      const data = await createAlertConfigAction(context, body);
      outputData(command, rawMode(context) ? data.config : renderConfig(data.config), "pretty");
    }));

  configs.command("template")
    .argument("[kind]", "no-check-out | idle | battery-low | zone-entry", "no-check-out")
    .option("--format <format>", "json | yaml", "json")
    .description("Print an alert config starter template")
    .action((kind, options) => runCommand(async () => {
      const command = configs.commands.find((entry) => entry.name() === "template")!;
      const template = ALERT_TEMPLATE_EXAMPLES[kind];
      if (!template) {
        throw new Error(`Unknown alert template: ${kind}`);
      }
      process.stdout.write(stringifyStructured(template, options.format));
    }));

  configs.command("validate")
    .requiredOption("--file <file>", "Alert config JSON/YAML file")
    .option("--format <format>", "json | yaml", "auto")
    .description("Validate a local alert config file")
    .action((options) => runCommand(async () => {
      const command = configs.commands.find((entry) => entry.name() === "validate")!;
      const body = normalizeTemplateInput(await readStructuredFile(options.file, options.format));
      outputData(command, { valid: true, fields: Object.keys(body) }, "pretty");
    }));

  alerts.command("recent")
    .description("List recent triggered alerts")
    .option("--config <id>", "Alert config id")
    .option("--status <status>", "new | acknowledged | archived | deleted | all")
    .option("--from <date>", "Start date: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--until <date>", "End date: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--limit <limit>", "Maximum rows", (value) => Number(value), 50)
    .action((options) => runCommand(async () => {
      const command = alerts.commands.find((entry) => entry.name() === "recent")!;
      const data = await listAlertInstancesAction(contextFor(command), {
        configId: options.config,
        status: options.status,
        from: resolveDateWord(options.from),
        until: resolveDateWord(options.until),
        limit: options.limit
      });
      outputData(command, rawMode(contextFor(command)) ? data : instanceRows(data.items), "table");
    }));

  const instances = alerts.command("instances").description("Manage triggered alert instances");

  instances.command("list")
    .description("List triggered alert instances")
    .option("--config <id>", "Alert config id")
    .option("--status <status>", "new | acknowledged | archived | deleted | all")
    .option("--from <date>", "Start date: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--until <date>", "End date: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--limit <limit>", "Maximum rows", (value) => Number(value), 50)
    .action((options) => runCommand(async () => {
      const command = instances.commands.find((entry) => entry.name() === "list")!;
      const data = await listAlertInstancesAction(contextFor(command), {
        configId: options.config,
        status: options.status,
        from: resolveDateWord(options.from),
        until: resolveDateWord(options.until),
        limit: options.limit
      });
      outputData(command, rawMode(contextFor(command)) ? data : instanceRows(data.items), "table");
    }));

  instances.command("get")
    .argument("<id>", "Triggered alert id")
    .description("Show one triggered alert")
    .action((id) => runCommand(async () => {
      const command = instances.commands.find((entry) => entry.name() === "get")!;
      const data = await getAlertInstanceAction(contextFor(command), id);
      outputData(command, data.instance, "pretty");
    }));

  instances.command("ack")
    .argument("<id>", "Triggered alert id")
    .description("Acknowledge a triggered alert")
    .action((id) => runCommand(async () => {
      const command = instances.commands.find((entry) => entry.name() === "ack")!;
      const context = contextFor(command);
      await confirmDangerous(context, `Acknowledge alert instance ${id}?`);
      outputData(command, (await updateAlertInstanceAction(context, id, { status: "acknowledged" })).instance, "pretty");
    }));

  instances.command("archive")
    .argument("<id>", "Triggered alert id")
    .description("Archive a triggered alert")
    .action((id) => runCommand(async () => {
      const command = instances.commands.find((entry) => entry.name() === "archive")!;
      const context = contextFor(command);
      await confirmDangerous(context, `Archive alert instance ${id}?`);
      outputData(command, (await updateAlertInstanceAction(context, id, { status: "archived" })).instance, "pretty");
    }));

  instances.command("delete")
    .argument("<id>", "Triggered alert id")
    .description("Delete a triggered alert")
    .action((id) => runCommand(async () => {
      const command = instances.commands.find((entry) => entry.name() === "delete")!;
      const context = contextFor(command);
      await confirmDangerous(context, `Delete alert instance ${id}?`);
      outputData(command, await deleteAlertInstanceAction(context, id), "pretty");
    }));

  instances.command("export")
    .description("Export triggered alert instances")
    .option("--config <id>", "Alert config id")
    .option("--status <status>", "new | acknowledged | archived | deleted | all")
    .option("--from <date>", "Start date: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--until <date>", "End date: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--limit <limit>", "Maximum rows", (value) => Number(value), 200)
    .action((options) => runCommand(async () => {
      const command = instances.commands.find((entry) => entry.name() === "export")!;
      const data = await listAlertInstancesAction(contextFor(command), {
        configId: options.config,
        status: options.status,
        from: resolveDateWord(options.from),
        until: resolveDateWord(options.until),
        limit: options.limit
      });
      outputData(command, instanceRows(data.items), "table");
    }));

  alerts.command("report")
    .description("Generate an alerts report file")
    .option("--from <date>", "Start date: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--until <date>", "End date: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--date <date>", "YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--format <format>", "csv | xlsx | pdf", "csv")
    .option("--file <file>", "Output file")
    .action((options) => runCommand(async () => {
      const command = alerts.commands.find((entry) => entry.name() === "report")!;
      const context = contextFor(command);
      const result = await generateReportAction(context, {
        type: "alerts",
        format: options.format,
        date: resolveDateWord(options.date),
        from: resolveDateWord(options.from),
        until: resolveDateWord(options.until)
      });
      const file = await writeReportFile(result, options.file);
      outputData(command, {
        type: "alerts",
        format: result.reportFormat ?? options.format,
        file,
        bytes: result.body.length,
        reportId: result.reportId,
        link: result.reportLink ? await reportFileUrl(context, result.reportLink) : undefined
      }, "pretty");
    }));
}
