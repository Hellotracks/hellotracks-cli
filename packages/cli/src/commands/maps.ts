import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { Command } from "commander";
import {
  createMapShareAction,
  getMapShareAction,
  listMapLayersAction,
  listMapSharesAction,
  listMembersAction,
  listPlacesAction,
  renderMapAction,
  revokeMapShareAction,
  type MapRenderBody
} from "@hellotracks/ht-core/actions/index.js";
import { confirmDangerous, contextFor, formatListTable, maybeWarn, outputData, runCommand } from "@hellotracks/ht-core/commands/support.js";
import type { CommandContext } from "@hellotracks/ht-core/types.js";
import { localDateString, resolveDateWord } from "@hellotracks/ht-core/utils.js";

type JsonRecord = Record<string, unknown>;

const MAP_KINDS = new Set(["places", "members", "jobs", "zones", "trips", "waypoints", "dayroute", "timeline", "heatmap", "isochrone"]);
const MEMBER_REQUIRED = new Set(["trips", "waypoints", "dayroute", "timeline", "isochrone"]);
const DATE_DEFAULT_TODAY = new Set(["dayroute", "timeline"]);
const MAP_KIND_HELP = "places | members | jobs | zones | trips | waypoints | dayroute | timeline | heatmap | isochrone";
const SHARE_MAP_VIEWER_URL = "https://live.hellotracks.com/share/maps/viewer";

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactRows(items: JsonRecord[], fields: string[]): JsonRecord[] {
  return formatListTable(items, fields);
}

function rawMode(context: CommandContext): boolean {
  return context.output === "json" || context.output === "yaml";
}

function parseDate(value: unknown): string | undefined {
  return typeof value === "string" && value ? resolveDateWord(value) : undefined;
}

function cleanObject<T extends JsonRecord>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) =>
    value !== undefined
    && value !== ""
    && !(Array.isArray(value) && value.length === 0)
  )) as T;
}

function matchesMember(item: JsonRecord, selector: string): boolean {
  const normalized = selector.toLowerCase();
  return ["id", "username", "email", "name"].some((field) => String(item[field] ?? "").toLowerCase() === normalized);
}

function matchesPlace(item: JsonRecord, selector: string): boolean {
  const normalized = selector.toLowerCase();
  return ["id", "name", "address"].some((field) => String(item[field] ?? "").toLowerCase() === normalized);
}

async function resolveMemberId(context: CommandContext, selector: string | undefined): Promise<string | undefined> {
  if (!selector) {
    return undefined;
  }
  const exact = await listMembersAction(context, { uids: selector });
  if (exact.items.length === 1) {
    return String(exact.items[0]?.id);
  }
  const data = await listMembersAction(context);
  const matches = data.items.filter((item) => matchesMember(item, selector));
  if (matches.length !== 1) {
    throw new Error(matches.length === 0 ? `No member matched ${selector}.` : `Member selector is ambiguous: ${selector}.`);
  }
  return String(matches[0]?.id);
}

async function resolvePlaceIds(context: CommandContext, selectors: string[] | undefined): Promise<string[] | undefined> {
  const selected = new Set<string>();
  for (const selector of selectors ?? []) {
    const exact = await listPlacesAction(context, { uids: selector });
    if (exact.items.length === 1) {
      selected.add(String(exact.items[0]?.id));
      continue;
    }
    const queried = await listPlacesAction(context, { query: selector, max: 50 });
    const matches = queried.items.filter((item) => matchesPlace(item, selector));
    if (matches.length === 1) {
      selected.add(String(matches[0]?.id));
      continue;
    }
    if (queried.items.length === 1) {
      selected.add(String(queried.items[0]?.id));
      continue;
    }
    throw new Error(queried.items.length === 0 ? `No place matched ${selector}.` : `Place selector is ambiguous: ${selector}.`);
  }
  return selected.size > 0 ? [...selected] : undefined;
}

function normalizeKinds(kinds: string[] | string): string[] {
  const values = (Array.isArray(kinds) ? kinds : [kinds]).map((kind) => kind.trim().toLowerCase()).filter(Boolean);
  if (values.length === 0) {
    throw new Error("Provide at least one map kind.");
  }
  for (const kind of values) {
    if (!MAP_KINDS.has(kind)) {
      throw new Error(`Unknown map kind: ${kind}. Use ht maps layers.`);
    }
  }
  return values;
}

function defaultDateForKinds(kinds: string[]): string | undefined {
  return kinds.some((kind) => DATE_DEFAULT_TODAY.has(kind)) ? localDateString() : undefined;
}

async function bodyForOptions(kindsInput: string[] | string, context: CommandContext, options: Record<string, unknown>): Promise<MapRenderBody> {
  const kinds = normalizeKinds(kindsInput);
  const date = parseDate(options.date) ?? defaultDateForKinds(kinds);
  const from = parseDate(options.from);
  const until = parseDate(options.until);
  if (date && (from || until)) {
    throw new Error("Use either --date or --from/--until, not both.");
  }
  if ((from && !until) || (!from && until)) {
    throw new Error("--from and --until must be provided together.");
  }
  const memberId = await resolveMemberId(context, typeof options.member === "string" ? options.member : undefined);
  const memberRequiredKind = kinds.find((kind) => MEMBER_REQUIRED.has(kind));
  if (memberRequiredKind && !memberId) {
    throw new Error(`${memberRequiredKind} maps require --member.`);
  }
  const common = cleanObject({
    title: stringOption(options.title),
    memberId,
    placeIds: await resolvePlaceIds(context, options.place as string[] | undefined),
    date,
    from,
    until,
    minutes: numberOption(options.minutes),
    profile: stringOption(options.travelProfile),
    skip: numberOption(options.skip),
    max: numberOption(options.max),
    locations: booleanOption(options.locations),
    markers: booleanOption(options.markers),
    waypoints: booleanOption(options.waypoints),
    stops: booleanOption(options.stops),
    force: booleanOption(options.force),
    inhouse: booleanOption(options.inhouse),
    jobs: booleanOption(options.jobs),
    at: stringOption(options.at),
    expires: stringOption(options.expires)
  });
  if (kinds.length === 1) {
    return cleanObject({ ...common, kind: kinds[0] });
  }
  return cleanObject({
    ...common,
    layers: kinds.map((kind) => ({ kind }))
  });
}

function numberOption(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a number, got ${value}.`);
  }
  return number;
}

function stringOption(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function booleanOption(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function shareRows(items: JsonRecord[]): JsonRecord[] {
  return compactRows(items.map((item) => ({
    id: item.id,
    kind: item.kind,
    title: item.title,
    features: item.featureCount,
    expiresAt: item.expiresAt,
    revoked: item.revoked ? "yes" : "no",
    url: item.url
  })), ["id", "kind", "title", "features", "expiresAt", "revoked", "url"]);
}

function layerLines(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }
  return [
    "  layers:",
    ...value.filter(isRecord).map((layer) => {
      const label = layer.title || layer.kind || layer.id || "layer";
      const count = layer.featureCount ?? layer.count ?? 0;
      const suffix = layer.hasMore ? " limited" : "";
      return `    - ${label}: ${count} features${suffix}`;
    })
  ];
}

function renderShare(share: JsonRecord): string {
  return [
    "Map Share",
    `  url: ${share.url}`,
    `  id: ${share.id}`,
    `  kind: ${share.kind}`,
    `  title: ${share.title}`,
    `  features: ${share.featureCount ?? 0}`,
    ...layerLines(share.layers),
    `  expiresAt: ${share.expiresAt}`,
    share.hasMore ? "  warning: snapshot was limited; narrow filters for complete data" : "",
    "",
    "Anyone with the URL can view this snapshot until it expires or is revoked."
  ].filter(Boolean).join("\n");
}

function renderSummary(map: JsonRecord): string {
  const summary = isRecord(map.summary) ? map.summary : {};
  return [
    "Map Snapshot",
    `  kind: ${map.kind}`,
    `  features: ${summary.featureCount ?? 0}`,
    ...layerLines(summary.layers),
    summary.total !== undefined ? `  total: ${summary.total}` : "",
    summary.hasMore ? "  hasMore: true" : "",
    summary.aborted ? "  aborted: true" : "",
    isRecord(summary.bounds)
      ? `  bounds: ${summary.bounds.minLat},${summary.bounds.minLng} -> ${summary.bounds.maxLat},${summary.bounds.maxLng}`
      : ""
  ].filter(Boolean).join("\n");
}

function renderExportResult(file: string, kinds: string[], content: string, map: JsonRecord): string {
  return [
    `Saved ${file}`,
    `  layers: ${kinds.join(", ")}`,
    `  features: ${isRecord(map.summary) ? map.summary.featureCount ?? 0 : 0}`,
    `  bytes: ${Buffer.byteLength(content)}`,
    `Open later with: ht maps viewer`
  ].join("\n");
}

async function openBrowser(url: string): Promise<boolean> {
  const platform = process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function geojsonFromMap(map: JsonRecord): unknown {
  return map.geojson ?? map;
}

function addMapOptions(command: Command): Command {
  return command
    .option("--member <selector>", "Member id, username, email, or exact name")
    .option("--place <selector>", "Place id or exact name; repeatable", collect, [])
    .option("--date <date>", "YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--from <date>", "Start date: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--until <date>", "End date: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--minutes <minutes>", "Isochrone minutes")
    .option("--travel-profile <profile>", "Isochrone travel profile")
    .option("--skip <count>", "Skip places")
    .option("--max <count>", "Maximum places")
    .option("--locations", "Include trip locations when supported")
    .option("--markers", "Include trip start/end markers")
    .option("--waypoints", "Include trip waypoints")
    .option("--stops", "Include trip stops")
    .option("--force", "Force route calculation when supported")
    .option("--inhouse", "Use in-house routing when supported")
    .option("--jobs", "Include jobs where supported")
    .option("--at <filter>", "Stop location filter");
}

function withKindsHelp(command: Command, examples: string[]): Command {
  return command.showHelpAfterError(`
Examples:
${examples.map((example) => `  ${example}`).join("\n")}

Run "ht maps layers" to list available map kinds.
`);
}

export function registerMaps(program: Command): void {
  const maps = program.command("maps")
    .description("Inspect, export, open, and share Hellotracks operational maps")
    .addHelpText("after", `

Examples:
  ht maps layers
  ht maps share members places jobs --title "Snapshot June 6"
  ht maps viewer
  ht maps export trips --member alice --date today --file alice-trips.geojson
  ht maps open dayroute --member alice --date today
  ht maps share trips --member alice --date yesterday --stops --waypoints --expires 7d
  ht maps share heatmap --from 2026-05-01 --until 2026-05-28 --title "May coverage"
  ht maps shares revoke <share-id> --yes
`);

  maps.command("layers")
    .description("List supported map layer kinds")
    .action(() => runCommand(async () => {
      const command = maps.commands.find((entry) => entry.name() === "layers")!;
      const context = contextFor(command);
      const data = await listMapLayersAction(context);
      outputData(command, rawMode(context) ? data : compactRows(data.items, ["kind", "label", "requiresMember", "supportsDateRange", "supportsPlaces"]), "table");
    }));

  addMapOptions(withKindsHelp(maps.command("inspect")
    .argument("<kinds...>", MAP_KIND_HELP)
    .description("Generate a map snapshot summary without sharing it"), [
      "ht maps inspect members places jobs",
      "ht maps inspect jobs --date today",
      "ht maps inspect trips --member alice --date today"
    ]))
    .action((kinds, options) => runCommand(async () => {
      const command = maps.commands.find((entry) => entry.name() === "inspect")!;
      const context = contextFor(command);
      const { map } = await renderMapAction(context, await bodyForOptions(kinds, context, options));
      outputData(command, rawMode(context) ? map : renderSummary(map), "pretty");
    }));

  addMapOptions(withKindsHelp(maps.command("export")
    .argument("<kinds...>", MAP_KIND_HELP)
    .description("Export a map as GeoJSON"), [
      "ht maps export members places jobs --file snapshot-june-6.geojson",
      "ht maps export jobs --date today --file jobs-today.geojson",
      "ht maps export trips --member alice --date today --file alice-trips.geojson"
    ])
    .option("--file <file>", "Output GeoJSON file")
    .option("--stdout", "Write GeoJSON to stdout"))
    .action((kindsInput, options) => runCommand(async () => {
      const command = maps.commands.find((entry) => entry.name() === "export")!;
      const context = contextFor(command);
      const kinds = normalizeKinds(kindsInput);
      const { map } = await renderMapAction(context, await bodyForOptions(kinds, context, options));
      const geojson = geojsonFromMap(map);
      const content = JSON.stringify(geojson, null, 2);
      if (options.stdout) {
        process.stdout.write(`${content}\n`);
        return;
      }
      const file = options.file || `${kinds.join("-")}.geojson`;
      await fs.writeFile(file, content);
      outputData(command, rawMode(context) ? { file, kinds, bytes: Buffer.byteLength(content), summary: map.summary } : renderExportResult(file, kinds, content, map), "pretty");
    }));

  addMapOptions(withKindsHelp(maps.command("open")
    .argument("<kinds...>", MAP_KIND_HELP)
    .description("Create a short-lived map snapshot and open it in the browser")
    .option("--title <title>", "Map title")
    .option("--expires <duration>", "Expiry like 30m, 24h, 7d", "24h")
    .option("--no-open", "Print the URL without opening a browser"), [
      "ht maps open members places jobs --title \"Current operations\"",
      "ht maps open jobs --date today",
      "ht maps open trips --member alice --date today --no-open"
    ]))
    .action((kinds, options) => runCommand(async () => {
      const command = maps.commands.find((entry) => entry.name() === "open")!;
      const context = contextFor(command);
      const body = await bodyForOptions(kinds, context, options);
      const { share } = await createMapShareAction(context, body);
      if (options.open !== false && !context.noInput && typeof share.url === "string") {
        const opened = await openBrowser(share.url);
        if (!opened) {
          maybeWarn(context, "Could not open a browser; use the printed URL.");
        }
      }
      outputData(command, rawMode(context) ? share : renderShare(share), "pretty");
    }));

  addMapOptions(withKindsHelp(maps.command("share")
    .argument("<kinds...>", MAP_KIND_HELP)
    .description("Create an expiring snapshot share link")
    .option("--title <title>", "Map title")
    .option("--expires <duration>", "Expiry like 30m, 24h, 7d", "7d")
    .option("--open", "Open the share URL in the browser"), [
      "ht maps share members places jobs --title \"Snapshot June 6\"",
      "ht maps share jobs --date today --expires 7d",
      "ht maps share trips --member alice --date today"
    ]))
    .action((kinds, options) => runCommand(async () => {
      const command = maps.commands.find((entry) => entry.name() === "share")!;
      const context = contextFor(command);
      const body = await bodyForOptions(kinds, context, options);
      const { share } = await createMapShareAction(context, body);
      if (options.open && !context.noInput && typeof share.url === "string") {
        await openBrowser(share.url);
      }
      outputData(command, rawMode(context) ? share : renderShare(share), "pretty");
    }));

  maps.command("viewer")
    .description("Open the hosted viewer for saved local GeoJSON snapshots")
    .option("--no-open", "Print the viewer URL without opening a browser")
    .action((options) => runCommand(async () => {
      const command = maps.commands.find((entry) => entry.name() === "viewer")!;
      const context = contextFor(command);
      if (options.open !== false && !context.noInput) {
        const opened = await openBrowser(SHARE_MAP_VIEWER_URL);
        if (!opened) {
          maybeWarn(context, "Could not open a browser; use the printed URL.");
        }
      }
      outputData(command, rawMode(context) ? { url: SHARE_MAP_VIEWER_URL } : SHARE_MAP_VIEWER_URL, "pretty");
    }));

  const shares = maps.command("shares").description("List, inspect, and revoke map shares");

  shares.command("list")
    .description("List map shares")
    .option("--limit <limit>", "Maximum rows", (value) => Number(value), 50)
    .action((options) => runCommand(async () => {
      const command = shares.commands.find((entry) => entry.name() === "list")!;
      const context = contextFor(command);
      const data = await listMapSharesAction(context, { limit: options.limit });
      outputData(command, rawMode(context) ? data : shareRows(data.items), "table");
    }));

  shares.command("get")
    .argument("<id>", "Map share id")
    .description("Show one map share")
    .action((id) => runCommand(async () => {
      const command = shares.commands.find((entry) => entry.name() === "get")!;
      const context = contextFor(command);
      const { share } = await getMapShareAction(context, id);
      outputData(command, rawMode(context) ? share : renderShare(share), "pretty");
    }));

  shares.command("revoke")
    .argument("<id>", "Map share id")
    .description("Revoke a map share")
    .action((id) => runCommand(async () => {
      const command = shares.commands.find((entry) => entry.name() === "revoke")!;
      const context = contextFor(command);
      await confirmDangerous(context, `Revoke map share ${id}?`);
      outputData(command, await revokeMapShareAction(context, id), "pretty");
    }));
}
