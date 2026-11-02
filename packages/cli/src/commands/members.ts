import { Command, Option } from "commander";
import {
  createMemberAction,
  deleteMemberAction,
  getMemberAction,
  listMembersAction,
  updateMemberAction
} from "@hellotracks/ht-core/actions/index.js";
import { runBulkAction } from "@hellotracks/ht-core/bulk/index.js";
import { bulkColumnRows, getBulkTemplate, renderBulkCsvTemplate } from "@hellotracks/ht-core/bulk/templates.js";
import { promptSecret } from "@hellotracks/ht-core/ui/tty.js";
import { outputBulkReport, outputData, promptIfMissing, runCommand, formatListTable, confirmDangerous, contextFor, maybeWarn } from "@hellotracks/ht-core/commands/support.js";
import { renderMemberOverview } from "./member-presenter.js";

type JsonRecord = Record<string, unknown>;

function outputMember(command: Command, data: Record<string, unknown>): void {
  const context = contextFor(command);
  if (context.output === "json" || context.output === "yaml") {
    outputData(command, data, "pretty");
    return;
  }
  outputData(command, renderMemberOverview(data, { verbose: context.verbose }), "pretty");
}

function recordValue(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function firstValue(record: JsonRecord | undefined, keys: string[]): unknown {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return undefined;
}

function scalar(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function formatCoordinate(value: unknown): string {
  return typeof value === "number" ? value.toFixed(5) : scalar(value);
}

function formatTimestamp(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "-";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 0 && value < 10_000_000_000 ? value * 1000 : value;
    return new Date(millis).toISOString();
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const numeric = Number.parseInt(value, 10);
    if (Number.isFinite(numeric)) {
      const millis = numeric > 0 && numeric < 10_000_000_000 ? numeric * 1000 : numeric;
      return new Date(millis).toISOString();
    }
  }
  return String(value);
}

function memberLocationResult(member: JsonRecord, requestedId: string): JsonRecord {
  const location = recordValue(member.location) ?? {};
  const states = recordValue(member.states);
  const timestamps = recordValue(member.timestamps);
  const gps: JsonRecord = {
    lat: firstValue(location, ["lat", "latitude"]),
    lng: firstValue(location, ["lng", "lon", "longitude"]),
    ts: firstValue(location, ["ts", "timestamp", "updatedAt", "time"]),
    speed: firstValue(location, ["speed"]),
    accuracy: firstValue(location, ["accuracy"]),
    altitude: firstValue(location, ["alt", "altitude"]),
    heading: firstValue(location, ["head", "heading"]),
    sensor: firstValue(location, ["sensor"])
  };
  const result: JsonRecord = {
    id: stringValue(member.id) ?? requestedId,
    name: member.name,
    username: member.username,
    role: member.role,
    activeStatus: member.activeStatus,
    hasLocation: gps.lat !== undefined && gps.lng !== undefined,
    gps,
    location
  };
  if (states) result.states = states;
  if (timestamps) result.timestamps = timestamps;
  return result;
}

function memberLocationTableRow(result: JsonRecord): JsonRecord {
  const gps = recordValue(result.gps) ?? {};
  const states = recordValue(result.states);
  return {
    id: result.id,
    name: scalar(result.name),
    username: scalar(result.username),
    lat: formatCoordinate(gps.lat),
    lng: formatCoordinate(gps.lng),
    ts: scalar(gps.ts),
    updated: formatTimestamp(gps.ts),
    speed: scalar(gps.speed),
    accuracy: scalar(gps.accuracy),
    altitude: scalar(gps.altitude),
    heading: scalar(gps.heading),
    sensor: scalar(gps.sensor),
    status: scalar(result.activeStatus),
    tracking: scalar(states?.tracking)
  };
}

function selectFields(rows: JsonRecord[], fields: string[]): JsonRecord[] {
  return rows.map((row) => {
    const selected: JsonRecord = {};
    for (const field of fields) {
      selected[field] = row[field];
    }
    return selected;
  });
}

function outputMemberLocations(command: Command, results: JsonRecord[], options: { full?: boolean } = {}): void {
  const context = contextFor(command);
  if (context.output === "json" || context.output === "yaml") {
    outputData(command, { items: results }, "pretty");
    return;
  }
  const fields = options.full || context.verbose
    ? ["id", "name", "username", "lat", "lng", "ts", "updated", "speed", "accuracy", "altitude", "heading", "sensor", "status", "tracking"]
    : ["id", "name", "lat", "lng", "updated", "speed", "accuracy", "tracking"];
  outputData(command, selectFields(results.map(memberLocationTableRow), fields), "table");
}

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function addMemberMutationOptions(command: Command): Command {
  return command
    .option("--username <username>", "Login name, usually an email address")
    .option("--name <name>", "Full name")
    .option("--email <email>", "Email address")
    .option("--phone <phone>", "Phone number, best with country code")
    .option("--password <password>", "Password; prefer --password-stdin, which keeps it out of shell history")
    .option("--password-stdin", "Read the member password from stdin")
    .option("--role <role>", "worker | operator | dispatcher | admin")
    .option("--color <color>", "Color on the map")
    .option("--timezone <timezone>", "Time zone, for example Europe/Vienna")
    .option("--language <language>", "Language code, for example en, de, or es")
    .option("--unit-distance <unitDistance>", "Distance unit, for example km or mi")
    .option("--unit-time <unitTime>", "Clock format, for example 24h or 12h")
    .option("--unit-date <unitDate>", "Date format, for example yyyy-mm-dd")
    .option("--status-label <statusLabel>", "Short status text shown with the member")
    .option("--route-start-lat <routeStartLat>", "Latitude where the member's route starts")
    .option("--route-start-lng <routeStartLng>", "Longitude where the member's route starts")
    .option("--route-end-lat <routeEndLat>", "Latitude where the member's route ends")
    .option("--route-end-lng <routeEndLng>", "Longitude where the member's route ends")
    .option("--travel-mode <travelMode>", "car, van, truck, motorcycle, bicycle, or pedestrian")
    .option("--vehicle-capacity <vehicleCapacity>", "Vehicle capacity used by the route solver")
    .option("--route-start-time <routeStartTime>", "Route start time as HH:mm, for example 08:00, or team")
    .option("--team <team...>", "Team id; repeatable, replaces the member's teams")
    .option("--working-hours-json <workingHoursJson>", "Weekly hours as JSON: monday to sunday, each {\"start\":800,\"end\":1800}")
    .option("--working-hours-overrides-json <workingHoursOverridesJson>", "Hours for single days as JSON keyed by YYYYMMDD, for example {\"20261224\":{\"start\":0,\"end\":0}}");
}

function addBulkOptions(command: Command): Command {
  return command
    .requiredOption("--file <path>", "Input file; use JSON, NDJSON, CSV, or YAML")
    .option("--format <format>", "auto | json | ndjson | csv | yaml", "auto")
    .option("--upsert-by <field>", "Stable field used for sync matching")
    .option("--dry-run", "Plan without mutating Hellotracks")
    .option("--continue-on-error", "Keep going after a record fails (default: stop at the first failure); exits 7 if any failed")
    .addOption(new Option("--batch-size <size>").hideHelp());
}

async function readPasswordOption(context: ReturnType<typeof contextFor>, options: { password?: string; passwordStdin?: boolean }, prompt = false): Promise<string | undefined> {
  if (options.password) {
    maybeWarn(context, "Passing --password on the command line is deprecated because it exposes secrets in shell history and process lists. Use --password-stdin or the masked interactive prompt.");
  }
  let password = options.password;
  if (!password && options.passwordStdin) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    const value = Buffer.concat(chunks).toString("utf8").trim();
    password = value || undefined;
  }
  if (!password && prompt && !context.noInput && process.stdin.isTTY && process.stdout.isTTY) {
    const value = await promptSecret("Password (optional)");
    password = value || undefined;
  }
  return password;
}

function memberMutationBody(options: Record<string, string | string[] | boolean | undefined>, password: string | undefined): Record<string, unknown> {
  return {
    username: options.username,
    name: options.name,
    email: options.email,
    phone: options.phone,
    password,
    role: options.role,
    color: options.color,
    timezone: options.timezone,
    language: options.language,
    unitDistance: options.unitDistance,
    unitTime: options.unitTime,
    unitDate: options.unitDate,
    statusLabel: options.statusLabel,
    routeStartLat: options.routeStartLat ? Number.parseFloat(String(options.routeStartLat)) : undefined,
    routeStartLng: options.routeStartLng ? Number.parseFloat(String(options.routeStartLng)) : undefined,
    routeEndLat: options.routeEndLat ? Number.parseFloat(String(options.routeEndLat)) : undefined,
    routeEndLng: options.routeEndLng ? Number.parseFloat(String(options.routeEndLng)) : undefined,
    travelMode: options.travelMode,
    vehicleCapacity: options.vehicleCapacity ? Number.parseInt(String(options.vehicleCapacity), 10) : undefined,
    routeStartTime: options.routeStartTime,
    teams: Array.isArray(options.team) ? options.team.map((value) => Number.parseInt(value, 10)).filter((value) => !Number.isNaN(value)) : undefined,
    workingHours: parseJsonOption(typeof options.workingHoursJson === "string" ? options.workingHoursJson : undefined, "working hours"),
    workingHoursOverrides: parseJsonOption(typeof options.workingHoursOverridesJson === "string" ? options.workingHoursOverridesJson : undefined, "working hours overrides")
  };
}

export function registerMembers(program: Command): void {
  const members = program.command("members").description("Manage team members");

  members.command("columns")
    .description("List supported import/sync CSV columns")
    .action(() => runCommand(async () => {
      const command = members.commands.find((entry) => entry.name() === "columns")!;
      outputData(command, bulkColumnRows("members"), "table");
    }));

  members.command("template")
    .description("Print a copy-ready members import CSV template")
    .option("--format <format>", "csv | json", "csv")
    .action((options) => runCommand(async () => {
      const command = members.commands.find((entry) => entry.name() === "template")!;
      if (options.format === "json") {
        outputData(command, getBulkTemplate("members").sample, "json");
        return;
      }
      outputData(command, renderBulkCsvTemplate("members"), "pretty");
    }));

  members.command("list")
    .description("List the company's members")
    .option("--uid <uid...>", "Only these member ids")
    .option("--query <query>", "Only members whose name, username, or email contains this")
    .option("--max <max>", "Maximum members to return")
    .action((options) => runCommand(async () => {
      const command = members.commands.find((entry) => entry.name() === "list")!;
      const data = await listMembersAction(contextFor(command), {
        query: options.query,
        max: options.max ? Number.parseInt(options.max, 10) : undefined,
        uids: options.uid && options.uid.length > 0 ? options.uid.join(",") : undefined
      });
      outputData(command, formatListTable(data.items, ["id", "name", "username", "role", "email", "phone"]), "table");
    }));

  members.command("locate")
    .argument("<id...>", "Member ID/UID(s)")
    .description("Show latest known GPS/location fields for one or more members")
    .option("--full", "Include every GPS-style field currently returned by the public API")
    .addHelpText("after", `

Default output is a compact location table. Use --full or global --verbose to include GPS fields such as ts, altitude, heading, and sensor.
Use --json or --output yaml for full location, states, and timestamps objects.

Examples:
  ht members locate member-123
  ht members locate member-123 member-456 --full
`)
    .action((ids: string[], options: { full?: boolean }) => runCommand(async () => {
      const command = members.commands.find((entry) => entry.name() === "locate")!;
      const context = contextFor(command);
      const results = await Promise.all(ids.map(async (id) => memberLocationResult(await getMemberAction(context, id), id)));
      outputMemberLocations(command, results, options);
    }));

  members.command("get")
    .argument("<id>", "Member ID")
    .description("Show writable member fields by default; use --verbose for read-only details or --json for raw output")
    .addHelpText("after", `

Default output is a compact human overview focused on fields you can change.
Use --verbose to include read-only identity, status, location, states, and timestamps.
Use --json or --output yaml to print the raw public API response.
`)
    .action((id) => runCommand(async () => {
      const command = members.commands.find((entry) => entry.name() === "get")!;
      const data = await getMemberAction(contextFor(command), id);
      outputMember(command, data);
    }));

  addMemberMutationOptions(members.command("create"))
    .description("Create a member")
    .action((options) => runCommand(async () => {
      const command = members.commands.find((entry) => entry.name() === "create")!;
      const context = contextFor(command);
      const password = await readPasswordOption(context, options, true);
      const body = memberMutationBody({
        ...options,
        username: await promptIfMissing(context, "Username", options.username),
        name: await promptIfMissing(context, "Name", options.name)
      }, password);
      const data = await createMemberAction(context, body);
      outputMember(command, data);
    }));

  addMemberMutationOptions(members.command("update").argument("<id>", "Member ID"))
    .description("Update writable member fields")
    .addHelpText("after", `

Only provided fields are changed. Use repeated --team values to replace team assignments.
Pass complex schedules with --working-hours-json or --working-hours-overrides-json.

Examples:
  ht members update member-123 --name "Alice Field" --role worker
  ht members update member-123 --timezone Europe/Vienna --unit-distance km
  ht members update member-123 --team 1 --team 2
  ht members update member-123 --working-hours-json '{"monday":{"start":800,"end":1800},"tuesday":{"start":800,"end":1800},"wednesday":{"start":800,"end":1800},"thursday":{"start":800,"end":1800},"friday":{"start":800,"end":1700},"saturday":{"start":0,"end":0},"sunday":{"start":0,"end":0}}'

Working hours need all seven days, with times as numbers like 800 for 08:00; {"start":0,"end":0} is a day off.

Use --json or --output yaml to print the raw public API response.
`)
    .action((id, options) => runCommand(async () => {
      const command = members.commands.find((entry) => entry.name() === "update")!;
      const context = contextFor(command);
      if (options.password !== undefined || options.passwordStdin) {
        throw new Error("The API cannot change a member's password; the member resets it from the app, or an admin in the Hellotracks dashboard.");
      }
      const data = await updateMemberAction(context, id, memberMutationBody(options, undefined));
      outputMember(command, data);
    }));

  members.command("delete")
    .description("Remove a member from the company")
    .argument("<id>", "Member ID")
    .action((id) => runCommand(async () => {
      const command = members.commands.find((entry) => entry.name() === "delete")!;
      const context = contextFor(command);
      await confirmDangerous(context, `Delete member ${id}?`);
      const data = await deleteMemberAction(context, id);
      outputData(command, data, "pretty");
    }));

  addBulkOptions(members.command("import"))
    .description("Create members from JSON, NDJSON, CSV, or YAML")
    .action((options) => runCommand(async () => {
      const command = members.commands.find((entry) => entry.name() === "import")!;
      const data = await runBulkAction(contextFor(command), "members", "import", options);
      outputBulkReport(command, data);
    }));

  members.command("export")
    .description("Export members")
    .option("--uid <uid...>", "Filter by UID")
    .action((options) => runCommand(async () => {
      const command = members.commands.find((entry) => entry.name() === "export")!;
      const data = await listMembersAction(contextFor(command), {
        uids: options.uid && options.uid.length > 0 ? options.uid.join(",") : undefined
      });
      outputData(command, data.items, "json");
    }));

  addBulkOptions(members.command("sync"))
    .description("Create or update members by --upsert-by, default username")
    .action((options) => runCommand(async () => {
      const command = members.commands.find((entry) => entry.name() === "sync")!;
      const data = await runBulkAction(contextFor(command), "members", "sync", options);
      outputBulkReport(command, data);
    }));
}
