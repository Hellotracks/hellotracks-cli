import { Command, Option } from "commander";
import { archiveJobAction, createJobAction, deleteJobAction, getJobAction, listAllJobsAction, listJobsAction, restoreJobAction, updateJobAction } from "@hellotracks/ht-core/actions/index.js";
import { runBulkAction } from "@hellotracks/ht-core/bulk/index.js";
import { bulkColumnRows, getBulkTemplate, renderBulkCsvTemplate } from "@hellotracks/ht-core/bulk/templates.js";
import { confirmDangerous, formatListTable, outputBulkReport, outputData, promptIfMissing, runCommand, contextFor } from "@hellotracks/ht-core/commands/support.js";
import { resolveDateWord } from "@hellotracks/ht-core/utils.js";

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

// The API reads only epoch milliseconds here and drops anything else without an error.
function sinceMillis(value: string | undefined, label: string): string | undefined {
  if (value === undefined || /^\d+$/.test(value.trim())) {
    return value?.trim();
  }
  const date = resolveDateWord(value) ?? value;
  const millis = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00` : date);
  if (Number.isNaN(millis)) {
    throw new Error(`${label} must be an ISO date or time, today, yesterday, or epoch milliseconds.`);
  }
  return String(millis);
}

// The API reads an empty username as unassigned and + as assigned to anyone.
function assigneeUsernameFilter(options: { assigneeUsername?: string; assigned?: boolean; unassigned?: boolean }): string | undefined {
  if (options.assigned && options.unassigned) {
    throw new Error("Use either --assigned or --unassigned, not both.");
  }
  if ((options.assigned || options.unassigned) && (options.assigneeUsername || (options as { assigneeId?: string }).assigneeId)) {
    throw new Error("--assigned and --unassigned do not combine with --assignee-id or --assignee-username.");
  }
  return options.assigned ? "+" : options.unassigned ? "" : options.assigneeUsername;
}

function addBulkOptions(command: Command): Command {
  return command
    .requiredOption("--file <path>", "Input file; use JSON, NDJSON, CSV, or YAML")
    .option("--format <format>", "auto | json | ndjson | csv | yaml", "auto")
    .option("--upsert-by <field>", "Stable field used for sync matching")
    .option("--dry-run", "Plan without mutating Hellotracks")
    .option("--continue-on-error", "Keep going after a record fails (default: stop at the first failure); exits 7 if any failed")
    .option("--batch-size <size>", "Jobs written per request (default 50); a refused batch is retried one by one");
}

export function registerJobs(program: Command): void {
  const jobs = program.command("jobs").description("Manage jobs");

  jobs.command("columns")
    .description("List supported import/sync CSV columns")
    .action(() => runCommand(async () => {
      const command = jobs.commands.find((entry) => entry.name() === "columns")!;
      outputData(command, bulkColumnRows("jobs"), "table");
    }));

  jobs.command("template")
    .description("Print a copy-ready jobs import CSV template")
    .option("--format <format>", "csv | json", "csv")
    .action((options) => runCommand(async () => {
      const command = jobs.commands.find((entry) => entry.name() === "template")!;
      if (options.format === "json") {
        outputData(command, getBulkTemplate("jobs").sample, "json");
        return;
      }
      outputData(command, renderBulkCsvTemplate("jobs"), "pretty");
    }));

  jobs.command("list")
    .description("List jobs for a day, or search across days")
    .option("--id <id>", "Job id")
    .option("--external-id <externalId>", "Your own id for the job, such as a ticket or order number")
    .option("--date <date>", "Day: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--assignee-id <assigneeId>", "Member id the job is assigned to")
    .option("--assignee-username <assigneeUsername>", "Member username the job is assigned to")
    .option("--assigned", "Only jobs assigned to someone")
    .option("--unassigned", "Only jobs assigned to no one")
    .option("--include-archived", "Include archived jobs")
    .option("--all-dates", "Search every day, not one day")
    .option("--progress <progress>", "unassigned, scheduled, accepted, in_progress, success, or failed")
    .option("--text <text>", "Only jobs whose text contains this")
    .option("--updated-since <updatedSince>", "Only jobs changed since: an ISO date or time, today, yesterday, or epoch milliseconds")
    .option("--created-since <createdSince>", "Only jobs created since: an ISO date or time, today, yesterday, or epoch milliseconds")
    .option("--limit <limit>", "Maximum jobs to return (the API default is 100)")
    .option("--skip <skip>", "Skip this many jobs, for paging with --limit")
    .option("--all", "Every matching job, page by page, instead of the first 100")
    .action((options) => runCommand(async () => {
      const command = jobs.commands.find((entry) => entry.name() === "list")!;
      const data = await (options.all ? listAllJobsAction : listJobsAction)(contextFor(command), {
        id: options.id,
        externalId: options.externalId,
        date: resolveDateWord(options.date),
        assigneeId: options.assigneeId,
        assigneeUsername: assigneeUsernameFilter(options),
        includeArchived: options.includeArchived,
        allDates: options.allDates,
        progress: options.progress,
        text: options.text,
        updatedSince: sinceMillis(options.updatedSince, "--updated-since"),
        createdSince: sinceMillis(options.createdSince, "--created-since"),
        limit: options.limit ? Number.parseInt(options.limit, 10) : undefined,
        skip: options.skip ? Number.parseInt(options.skip, 10) : undefined
      });
      outputData(command, formatListTable(data.items, ["id", "externalId", "title", "date", "progress", "address"]), "table");
    }));

  jobs.command("get")
    .description("Show one job")
    .argument("<id>", "Job ID")
    .action((id) => runCommand(async () => {
      const command = jobs.commands.find((entry) => entry.name() === "get")!;
      const data = await getJobAction(contextFor(command), id);
      outputData(command, data, "pretty");
    }));

  jobs.command("create")
    .description("Create a job; --external-id makes repeated runs update the same job")
    .option("--title <title>", "Job title")
    .option("--address <address>", "Street address; it is geocoded unless --lat and --lng are given")
    .option("--external-id <externalId>", "Your own id for the job, such as a ticket or order number")
    .option("--assignee-id <assigneeId>", "Member id the job is assigned to")
    .option("--assignee-username <assigneeUsername>", "Member username the job is assigned to")
    .option("--date <date>", "Day: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--time-window-json <timeWindowJson>", "Time window as JSON, for example {\"start\":\"09:00\",\"end\":\"12:00\"}")
    .option("--on-site-duration-seconds <onSiteDurationSeconds>", "Expected time on site, in seconds")
    .option("--lat <lat>", "Latitude; use with --lng")
    .option("--lng <lng>", "Longitude; use with --lat")
    .option("--priority <priority>", "Priority from 0 to 10")
    .option("--place-id <placeId>", "Place the job is at")
    .option("--notes <notes>", "Notes the worker sees")
    .option("--contact-json <contactJson>", "Contact as JSON: {\"name\":\"...\",\"phone\":\"...\",\"email\":\"...\"}")
    .option("--custom-fields-json <customFieldsJson>", "Custom fields as a JSON object, for example {\"PO\":\"4711\"}")
    .action((options) => runCommand(async () => {
      const command = jobs.commands.find((entry) => entry.name() === "create")!;
      const context = contextFor(command);
      const body = {
        title: await promptIfMissing(context, "Job title", options.title),
        address: options.address ?? "",
        externalId: options.externalId,
        assigneeId: options.assigneeId,
        assigneeUsername: options.assigneeUsername,
        date: resolveDateWord(options.date),
        timeWindow: parseJsonOption(options.timeWindowJson, "time window"),
        onSiteDurationSeconds: options.onSiteDurationSeconds ? Number.parseInt(options.onSiteDurationSeconds, 10) : undefined,
        priority: options.priority ? Number.parseInt(options.priority, 10) : undefined,
        placeId: options.placeId,
        notes: options.notes,
        contact: parseJsonOption(options.contactJson, "contact"),
        customFields: parseJsonOption(options.customFieldsJson, "custom fields"),
        location: options.lat && options.lng ? {
          lat: Number.parseFloat(options.lat),
          lng: Number.parseFloat(options.lng)
        } : undefined
      };
      const data = await createJobAction(context, body);
      outputData(command, data.items, "pretty");
    }));

  jobs.command("update")
    .description("Change a job; only the given fields change")
    .argument("<id>", "Job ID")
    .option("--title <title>", "Job title")
    .option("--address <address>", "Street address; it is geocoded unless --lat and --lng are given")
    .option("--external-id <externalId>", "Your own id for the job, such as a ticket or order number")
    .option("--assignee-id <assigneeId>", "Member id the job is assigned to")
    .option("--assignee-username <assigneeUsername>", "Member username the job is assigned to")
    .option("--date <date>", "Day: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--time-window-json <timeWindowJson>", "Time window as JSON, for example {\"start\":\"09:00\",\"end\":\"12:00\"}")
    .option("--on-site-duration-seconds <onSiteDurationSeconds>", "Expected time on site, in seconds")
    .option("--lat <lat>", "Latitude; use with --lng")
    .option("--lng <lng>", "Longitude; use with --lat")
    .option("--priority <priority>", "Priority from 0 to 10")
    .option("--place-id <placeId>", "Place the job is at")
    .option("--notes <notes>", "Notes the worker sees")
    .option("--contact-json <contactJson>", "Contact as JSON: {\"name\":\"...\",\"phone\":\"...\",\"email\":\"...\"}")
    .option("--custom-fields-json <customFieldsJson>", "Custom fields as a JSON object, for example {\"PO\":\"4711\"}")
    .action((id, options) => runCommand(async () => {
      const command = jobs.commands.find((entry) => entry.name() === "update")!;
      const body = {
        id,
        title: options.title,
        address: options.address,
        externalId: options.externalId,
        assigneeId: options.assigneeId,
        assigneeUsername: options.assigneeUsername,
        date: resolveDateWord(options.date),
        timeWindow: parseJsonOption(options.timeWindowJson, "time window"),
        onSiteDurationSeconds: options.onSiteDurationSeconds ? Number.parseInt(options.onSiteDurationSeconds, 10) : undefined,
        priority: options.priority ? Number.parseInt(options.priority, 10) : undefined,
        placeId: options.placeId,
        notes: options.notes,
        contact: parseJsonOption(options.contactJson, "contact"),
        customFields: parseJsonOption(options.customFieldsJson, "custom fields"),
        location: options.lat && options.lng ? {
          lat: Number.parseFloat(options.lat),
          lng: Number.parseFloat(options.lng)
        } : undefined
      };
      const data = await updateJobAction(contextFor(command), body);
      outputData(command, data.items, "pretty");
    }));

  jobs.command("archive")
    .description("Archive a job; restore brings it back")
    .argument("<id>", "Job ID")
    .action((id) => runCommand(async () => {
      const command = jobs.commands.find((entry) => entry.name() === "archive")!;
      const context = contextFor(command);
      await confirmDangerous(context, `Archive job ${id}?`);
      const data = await archiveJobAction(context, id);
      outputData(command, data.items, "pretty");
    }));

  jobs.command("restore")
    .description("Bring an archived job back")
    .argument("<id>", "Job ID")
    .action((id) => runCommand(async () => {
      const command = jobs.commands.find((entry) => entry.name() === "restore")!;
      const context = contextFor(command);
      await confirmDangerous(context, `Restore job ${id}?`);
      const data = await restoreJobAction(context, id);
      outputData(command, data.items, "pretty");
    }));

  jobs.command("delete")
    .description("Delete a job")
    .argument("<id>", "Job ID")
    .action((id) => runCommand(async () => {
      const command = jobs.commands.find((entry) => entry.name() === "delete")!;
      const context = contextFor(command);
      await confirmDangerous(context, `Delete job ${id}?`);
      const data = await deleteJobAction(context, id);
      outputData(command, data.items, "pretty");
    }));

  addBulkOptions(jobs.command("import"))
    .description("Create jobs from JSON, NDJSON, CSV, or YAML")
    .action((options) => runCommand(async () => {
      const command = jobs.commands.find((entry) => entry.name() === "import")!;
      const data = await runBulkAction(contextFor(command), "jobs", "import", options);
      outputBulkReport(command, data);
    }));

  jobs.command("export")
    .description("Export jobs using the same filters as list")
    .option("--date <date>", "Day: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--assignee-id <assigneeId>", "Member id the job is assigned to")
    .option("--assignee-username <assigneeUsername>", "Member username the job is assigned to")
    .option("--assigned", "Only jobs assigned to someone")
    .option("--unassigned", "Only jobs assigned to no one")
    .option("--include-archived", "Include archived jobs")
    .option("--all-dates", "Search every day, not one day")
    .option("--progress <progress>", "unassigned, scheduled, accepted, in_progress, success, or failed")
    .option("--text <text>", "Only jobs whose text contains this")
    .option("--updated-since <updatedSince>", "Only jobs changed since: an ISO date or time, today, yesterday, or epoch milliseconds")
    .option("--created-since <createdSince>", "Only jobs created since: an ISO date or time, today, yesterday, or epoch milliseconds")
    .option("--limit <limit>", "Maximum jobs to return (the API default is 100)")
    .option("--skip <skip>", "Skip this many jobs, for paging with --limit")
    .option("--all", "Every matching job, page by page, instead of the first 100")
    .action((options) => runCommand(async () => {
      const command = jobs.commands.find((entry) => entry.name() === "export")!;
      const data = await (options.all ? listAllJobsAction : listJobsAction)(contextFor(command), {
        date: resolveDateWord(options.date),
        assigneeId: options.assigneeId,
        assigneeUsername: assigneeUsernameFilter(options),
        includeArchived: options.includeArchived,
        allDates: options.allDates,
        progress: options.progress,
        text: options.text,
        updatedSince: sinceMillis(options.updatedSince, "--updated-since"),
        createdSince: sinceMillis(options.createdSince, "--created-since"),
        limit: options.limit ? Number.parseInt(options.limit, 10) : undefined,
        skip: options.skip ? Number.parseInt(options.skip, 10) : undefined
      });
      outputData(command, data.items, "json");
    }));

  addBulkOptions(jobs.command("sync"))
    .description("Create or update jobs by --upsert-by, default externalId")
    .action((options) => runCommand(async () => {
      const command = jobs.commands.find((entry) => entry.name() === "sync")!;
      const data = await runBulkAction(contextFor(command), "jobs", "sync", options);
      outputBulkReport(command, data);
    }));
}
