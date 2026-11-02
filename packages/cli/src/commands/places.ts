import { Command, Option } from "commander";
import { createPlaceAction, deletePlaceAction, getPlaceAction, listPlacesAction, updatePlaceAction } from "@hellotracks/ht-core/actions/index.js";
import { runBulkAction } from "@hellotracks/ht-core/bulk/index.js";
import { bulkColumnRows, getBulkTemplate, renderBulkCsvTemplate } from "@hellotracks/ht-core/bulk/templates.js";
import { confirmDangerous, formatListTable, outputBulkReport, outputData, promptIfMissing, runCommand, contextFor } from "@hellotracks/ht-core/commands/support.js";
import { renderPlaceOverview } from "./place-presenter.js";

function outputPlace(command: Command, data: Record<string, unknown>): void {
  const context = contextFor(command);
  if (context.output === "json" || context.output === "yaml") {
    outputData(command, data, "pretty");
    return;
  }
  outputData(command, renderPlaceOverview(data, { verbose: context.verbose }), "pretty");
}

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
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

export function registerPlaces(program: Command): void {
  const places = program.command("places").description("Manage places");

  places.command("columns")
    .description("List supported import/sync CSV columns")
    .action(() => runCommand(async () => {
      const command = places.commands.find((entry) => entry.name() === "columns")!;
      outputData(command, bulkColumnRows("places"), "table");
    }));

  places.command("template")
    .description("Print a copy-ready places import CSV template")
    .option("--format <format>", "csv | json", "csv")
    .action((options) => runCommand(async () => {
      const command = places.commands.find((entry) => entry.name() === "template")!;
      if (options.format === "json") {
        outputData(command, getBulkTemplate("places").sample, "json");
        return;
      }
      outputData(command, renderBulkCsvTemplate("places"), "pretty");
    }));

  places.command("list")
    .description("List places, or search them by name or address")
    .option("--query <query>", "Search by name or address")
    .option("--uid <uid...>", "Only these place ids")
    .option("--max <max>", "Maximum places to return (the API default is 500)")
    .action((options) => runCommand(async () => {
      const command = places.commands.find((entry) => entry.name() === "list")!;
      const query: Record<string, string | number | boolean | undefined> = {
        query: options.query,
        uids: options.uid?.join(","),
        max: options.max ? Number.parseInt(options.max, 10) : undefined
      };
      const data = await listPlacesAction(contextFor(command), query);
      outputData(command, formatListTable(data.items, ["id", "name", "address", "city", "radius"]), "table");
    }));

  places.command("delete")
    .description("Delete a place; its visit history stays")
    .argument("<id>", "Place ID")
    .action((id) => runCommand(async () => {
      const command = places.commands.find((entry) => entry.name() === "delete")!;
      const context = contextFor(command);
      await confirmDangerous(context, `Delete place ${id}?`);
      outputData(command, await deletePlaceAction(context, id), "pretty");
    }));

  places.command("get")
    .argument("<id>", "Place ID")
    .description("Show writable place fields by default; use --verbose for read-only details or --json for raw output")
    .addHelpText("after", `

Default output is a compact human overview focused on fields you can change.
Use --verbose to include read-only id/type details.
Use --json or --output yaml to print the raw public API response.
`)
    .action((id) => runCommand(async () => {
      const command = places.commands.find((entry) => entry.name() === "get")!;
      const data = await getPlaceAction(contextFor(command), id);
      outputPlace(command, data);
    }));

  places.command("create")
    .description("Create a place")
    .option("--name <name>", "Place name")
    .option("--address <address>", "Street address; it is geocoded unless --lat and --lng are given")
    .option("--email <email>", "Contact email")
    .option("--phone <phone>", "Contact phone")
    .option("--city <city>", "City")
    .option("--postal-code <postalCode>", "Postal code")
    .option("--state <state>", "State or region")
    .option("--country-code <countryCode>", "Two-letter country code, for example AT or US")
    .option("--color <color>", "Color on the map")
    .option("--lat <lat>", "Latitude; use with --lng")
    .option("--lng <lng>", "Longitude; use with --lat")
    .option("--radius <radius>", "Check-in radius in meters")
    .option("--team <team...>", "Team id; repeatable, replaces the place's teams")
    .option("--extended-data-json <extendedDataJson>", "Custom fields as a JSON object, for example {\"Gate code\":\"4711\"}; only the names given change, null removes one")
    .action((options) => runCommand(async () => {
      const command = places.commands.find((entry) => entry.name() === "create")!;
      const context = contextFor(command);
      const body = {
        name: await promptIfMissing(context, "Place name", options.name),
        address: options.address,
        email: options.email,
        phone: options.phone,
        city: options.city,
        postalCode: options.postalCode,
        state: options.state,
        countryCode: options.countryCode,
        color: options.color,
        radius: options.radius ? Number.parseInt(options.radius, 10) : undefined,
        teams: options.team?.map((value: string) => Number.parseInt(value, 10)).filter((value: number) => !Number.isNaN(value)),
        extendedData: parseJsonOption(options.extendedDataJson, "extended data"),
        location: options.lat && options.lng ? {
          lat: Number.parseFloat(options.lat),
          lng: Number.parseFloat(options.lng)
        } : undefined
      };
      const data = await createPlaceAction(context, body);
      outputPlace(command, data);
    }));

  places.command("update")
    .argument("<id>", "Place ID")
    .description("Update writable place fields")
    .option("--name <name>", "Place name")
    .option("--address <address>", "Street address; it is geocoded unless --lat and --lng are given")
    .option("--email <email>", "Contact email")
    .option("--phone <phone>", "Contact phone")
    .option("--city <city>", "City")
    .option("--postal-code <postalCode>", "Postal code")
    .option("--state <state>", "State or region")
    .option("--country-code <countryCode>", "Two-letter country code, for example AT or US")
    .option("--color <color>", "Color on the map")
    .option("--lat <lat>", "Latitude; use with --lng")
    .option("--lng <lng>", "Longitude; use with --lat")
    .option("--radius <radius>", "Check-in radius in meters")
    .option("--team <team...>", "Team id; repeatable, replaces the place's teams")
    .option("--extended-data-json <extendedDataJson>", "Custom fields as a JSON object, for example {\"Gate code\":\"4711\"}; only the names given change, null removes one")
    .addHelpText("after", `

Only provided fields are changed. Use repeated --team values to replace team assignments.
Pass custom fields with --extended-data-json.

Examples:
  ht places update place-123 --name "Acme HQ" --address "Main Street 1"
  ht places update place-123 --lat 37.79552 --lng -122.39375 --radius 100
  ht places update place-123 --team 1 --team 2
  ht places update place-123 --extended-data-json '{"customerId":"CUST-1001"}'

Use --json or --output yaml to print the raw public API response.
`)
    .action((id, options) => runCommand(async () => {
      const command = places.commands.find((entry) => entry.name() === "update")!;
      const body = {
        name: options.name,
        address: options.address,
        email: options.email,
        phone: options.phone,
        city: options.city,
        postalCode: options.postalCode,
        state: options.state,
        countryCode: options.countryCode,
        color: options.color,
        radius: options.radius ? Number.parseInt(options.radius, 10) : undefined,
        teams: options.team?.map((value: string) => Number.parseInt(value, 10)).filter((value: number) => !Number.isNaN(value)),
        extendedData: parseJsonOption(options.extendedDataJson, "extended data"),
        location: options.lat && options.lng ? {
          lat: Number.parseFloat(options.lat),
          lng: Number.parseFloat(options.lng)
        } : undefined
      };
      const data = await updatePlaceAction(contextFor(command), id, body);
      outputPlace(command, data);
    }));

  addBulkOptions(places.command("import"))
    .description("Create places from JSON, NDJSON, CSV, or YAML")
    .action((options) => runCommand(async () => {
      const command = places.commands.find((entry) => entry.name() === "import")!;
      const data = await runBulkAction(contextFor(command), "places", "import", options);
      outputBulkReport(command, data);
    }));

  places.command("export")
    .description("Export places using the same filters as list")
    .option("--query <query>", "Search by name or address")
    .option("--uid <uid...>", "Only these place ids")
    .option("--max <max>", "Maximum places to return (the API default is 500)")
    .action((options) => runCommand(async () => {
      const command = places.commands.find((entry) => entry.name() === "export")!;
      const data = await listPlacesAction(contextFor(command), {
        query: options.query,
        uids: options.uid?.join(","),
        max: options.max ? Number.parseInt(options.max, 10) : undefined
      });
      outputData(command, data.items, "json");
    }));

  addBulkOptions(places.command("sync"))
    .description("Create or update places by --upsert-by, default name")
    .action((options) => runCommand(async () => {
      const command = places.commands.find((entry) => entry.name() === "sync")!;
      const data = await runBulkAction(contextFor(command), "places", "sync", options);
      outputBulkReport(command, data);
    }));
}
