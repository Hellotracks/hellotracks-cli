import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  createRecurringReportAction,
  deleteRecurringReportAction,
  generateReportAction,
  getReportJobAction,
  listReportJobsAction,
  reportFileUrl,
  startReportJobAction,
  listRecurringReportsAction,
  listReportTypesAction,
  listReportUploadsAction,
  updateRecurringReportAction,
  type ReportDescriptor
} from "@hellotracks/ht-core/actions/index.js";
import { confirmDangerous, contextFor, formatListTable, outputData, runCommand } from "@hellotracks/ht-core/commands/support.js";
import type { CommandContext } from "@hellotracks/ht-core/types.js";
import { resolveDateWord } from "@hellotracks/ht-core/utils.js";
import { registerReporting } from "./reporting.js";
import { collect, resolveMemberIds, resolvePlaceIds } from "./selectors.js";

type JsonRecord = Record<string, unknown>;

function compactDescriptorRows(items: ReportDescriptor[]): JsonRecord[] {
  return items.map((item) => ({
    type: item.type,
    formats: item.availableFormats.join(","),
    selectors: [
      item.canSelectMembers ? "members" : "",
      item.canSelectPlaces ? "places" : ""
    ].filter(Boolean).join(",") || "none",
    maxDays: item.maxDays > 0 ? item.maxDays : "n/a",
    recurring: item.supportsRecurring ? "yes" : "no"
  }));
}

function describeReport(descriptor: ReportDescriptor): string {
  const selectors = [
    descriptor.canSelectMembers ? "--member / --all-members" : "",
    descriptor.canSelectPlaces ? "--place / --all-places" : ""
  ].filter(Boolean).join(", ") || "none";
  const lines = [
    `${descriptor.label} (${descriptor.type})`,
    `formats: ${descriptor.availableFormats.join(", ")}  default: ${descriptor.defaultFormat}`,
    `selectors: ${selectors}`,
    `dates: ${descriptor.maxDays > 0 ? `required, max ${descriptor.maxDays} day${descriptor.maxDays === 1 ? "" : "s"}` : "not required"}`,
    `recurring: ${descriptor.supportsRecurring ? "yes" : "no"}`
  ];
  if (descriptor.requiresFormTemplate) {
    lines.push("form template: required with --form-template");
  }
  if (descriptor.columns.length > 0) {
    lines.push(`columns: ${descriptor.columns.map((column) => column.key).join(", ")}`);
  }
  if (descriptor.options.length > 0) {
    lines.push(`options: ${descriptor.options.map((option) => option.key).join(", ")}`);
  }
  const selectorExample = descriptor.canSelectMembers ? " --all-members" : descriptor.canSelectPlaces ? " --all-places" : "";
  const dateExample = descriptor.maxDays > 0 ? "--date today" : "";
  lines.push("");
  lines.push("Examples:");
  lines.push(`  ht reports generate ${descriptor.type} ${dateExample} --format ${descriptor.defaultFormat}${selectorExample}`.replace(/\s+/g, " ").trimEnd());
  lines.push(`  ht reports generate ${descriptor.type} --from 2026-05-01 --until 2026-05-28 --format ${descriptor.defaultFormat}${selectorExample}`.replace(/\s+/g, " ").trimEnd());
  return lines.join("\n");
}

function parseColumns(values: string[] | undefined): Array<{ key: string; label?: string }> | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }
  return values.map((value) => {
    const index = value.indexOf("=");
    if (index < 0) {
      return { key: value };
    }
    return {
      key: value.slice(0, index),
      label: value.slice(index + 1)
    };
  });
}

function parseOptions(values: string[] | undefined): Record<string, string> | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }
  return Object.fromEntries(values.map((value) => {
    const index = value.indexOf("=");
    if (index <= 0) {
      throw new Error(`Invalid --option value: ${value}. Use key=value.`);
    }
    return [value.slice(0, index), value.slice(index + 1)];
  }));
}

function normalizeOutputFilename(filename: string): string {
  return filename.replace(/[\/\\]/g, "-").replace(/\r|\n|"/g, "").trim() || "report";
}

function isTextSafeFormat(format: string | undefined, contentType: string): boolean {
  return ["csv", "geojson"].includes(format ?? "") || contentType.startsWith("text/") || contentType.includes("json");
}

async function waitForReportJob(context: CommandContext, job: JsonRecord, timeoutSeconds: number): Promise<JsonRecord> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let current = job;
  // a retry puts a failed attempt back to queued, so only the status says when it is over
  while (current.status !== "completed" && current.status !== "failed") {
    if (Date.now() > deadline) {
      throw new Error(`Report job ${current.id} is still ${current.status} after ${timeoutSeconds}s. Check later with: ht reports jobs get ${current.id} --download`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    current = (await getReportJobAction(context, String(current.id))).job;
  }
  if (current.status === "failed") {
    const error = current.error as JsonRecord | null;
    throw new Error(`Report job ${current.id} failed: ${error ? `${error.code}: ${error.message}` : "unknown error"}`);
  }
  return current;
}

async function downloadReportJob(context: CommandContext, job: JsonRecord, file: string | undefined): Promise<{ file: string; bytes: number }> {
  const result = job.result as JsonRecord | null;
  if (job.status !== "completed" || !result?.link) {
    throw new Error(`Report job ${job.id} is ${job.status}; there is no file yet.`);
  }
  const response = await fetch(await reportFileUrl(context, String(result.link)));
  if (!response.ok) {
    throw new Error(`Download of report job ${job.id} failed with HTTP ${response.status}.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const target = path.resolve(process.cwd(), file ?? normalizeOutputFilename(String(result.filename || result.name || `${job.type}.${job.format}`)));
  await fs.writeFile(target, bytes);
  return { file: target, bytes: bytes.length };
}

async function findReportDescriptor(context: CommandContext, type: string): Promise<ReportDescriptor> {
  const data = await listReportTypesAction(context);
  const descriptor = data.items.find((item) => item.type === type);
  if (!descriptor) {
    throw new Error(`Unknown report type: ${type}`);
  }
  return descriptor;
}

function parseWeekdays(values: string[] | undefined): string[] | undefined {
  return values && values.length > 0 ? values : undefined;
}

function recurringRows(items: JsonRecord[]): JsonRecord[] {
  return formatListTable(items, ["id", "name", "type", "frame", "format", "statusText", "startDate", "createdBy"]);
}

function addSelectorOptions(command: Command): Command {
  return command
    .option("--member <selector>", "Member id, username, email, or exact name; repeatable", collect, [])
    .option("--place <selector>", "Place id or exact name; repeatable", collect, [])
    .option("--all-members", "Select all members")
    .option("--all-places", "Select all places");
}

function addReportCustomizationOptions(command: Command, formTemplate = true): Command {
  command
    .option("--column <column>", "Column key or key=Label; repeatable", collect, [])
    .option("--option <option>", "Report option key=value; repeatable", collect, []);
  return formTemplate ? command.option("--form-template <id>", "Form template id for formsubmissions reports") : command;
}

function addRecurringMutationOptions(command: Command): Command {
  // classic recurring reports can't hold a form template; schedule form answers with ht reports saved
  return addReportCustomizationOptions(addSelectorOptions(command)
    .option("--frame <frame>", "day | week | twoweeks")
    .option("--weekday <weekday>", "Weekday name; repeatable", collect, [])
    .option("--notify <selector>", "Member to notify by id, username, email, or exact name; repeatable", collect, [])
    .option("--format <format>", "File format; see ht reports describe <type>")
    .option("--start-date <date>", "YYYY-MM-DD, today, yesterday, or tomorrow"), false);
}

export function registerReports(program: Command): void {
  const reports = program.command("reports").description("Run, save, schedule, and download reports");
  reports.addHelpText("after", `

New reports (the ones in the dashboard's Reports page):
  ht reports catalog
  ht reports preview timesheet --period lastWeek
  ht reports run timesheet --period lastWeek --format xlsx
  ht reports saved create timesheet --every week --weekday monday --to alice

Classic report types (types, describe, columns, generate, history, recurring) keep working;
use them for places, members, gpx, activities, and timeline, which have no new report yet.
`);

  const types = reports.command("types")
    .description("List report types, formats, selectors, and recurrence support");
  types.action(() => runCommand(async () => {
    const data = await listReportTypesAction(contextFor(types));
    outputData(types, compactDescriptorRows(data.items), "table");
  }));

  const describe = reports.command("describe")
    .argument("<type>", "Report type")
    .description("Show formats, selectors, columns, options, and examples for a report type");
  describe.action((type) => runCommand(async () => {
    const context = contextFor(describe);
    const descriptor = await findReportDescriptor(context, type);
    if (context.output === "json" || context.output === "yaml") {
      outputData(describe, descriptor, "pretty");
      return;
    }
    outputData(describe, describeReport(descriptor), "pretty");
  }));

  const columns = reports.command("columns")
    .argument("<type>", "Report type")
    .description("List configurable report columns");
  columns.action((type) => runCommand(async () => {
    const context = contextFor(columns);
    const descriptor = await findReportDescriptor(context, type);
    if (descriptor.columns.length === 0 && context.output !== "json" && context.output !== "yaml") {
      outputData(columns, `No configurable columns are exposed for ${type}.`, "pretty");
      return;
    }
    outputData(columns, descriptor.columns, "table");
  }));

  const generate = addReportCustomizationOptions(addSelectorOptions(reports.command("generate")
    .argument("<type>", "Report type")
    .description("Generate and download a report")
    .option("--date <date>", "Single report date: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--from <date>", "Start date: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--until <date>", "End date: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--format <format>", "Report format")
    .option("--file <path>", "Output file path")
    .option("--stdout", "Write CSV or GeoJSON report bytes to stdout")
    .option("--title <title>", "Uploaded report title")
    .option("--background", "Make the report in the background and wait for it; for big reports that time out")
    .option("--timeout <seconds>", "With --background: how long to wait", "900")));
  generate.addHelpText("after", `

Examples:
  ht reports generate jobs --from 2026-05-01 --until 2026-05-28 --format csv --file jobs.csv --all-members
  ht reports generate timesheet --date today --member alice --format xlsx
  ht reports generate checkins --date yesterday --all-members --option mode=manual
  ht reports generate jobs --date today --all-members --column title --column status=CurrentStatus
`);
  generate.action((type, options) => runCommand(async () => {
    const context = contextFor(generate);
    const memberIds = await resolveMemberIds(context, options.member, options.allMembers);
    const placeIds = await resolvePlaceIds(context, options.place, options.allPlaces);
    const body: JsonRecord = {
      type,
      format: options.format,
      date: resolveDateWord(options.date),
      from: resolveDateWord(options.from),
      until: resolveDateWord(options.until),
      memberIds,
      placeIds,
      columns: parseColumns(options.column),
      options: parseOptions(options.option),
      formTemplateId: options.formTemplate,
      title: options.title
    };
    if (options.background) {
      const job = await waitForReportJob(context, (await startReportJobAction(context, body)).job, Number.parseInt(options.timeout, 10));
      const saved = await downloadReportJob(context, job, options.file);
      if (options.stdout) {
        process.stdout.write(await fs.readFile(saved.file));
        await fs.rm(saved.file);
        return;
      }
      outputData(generate, context.output === "json" || context.output === "yaml" ? { job, ...saved } : `saved: ${saved.file}\nbytes: ${saved.bytes}\njob: ${job.id}`, "pretty");
      return;
    }
    const result = await generateReportAction(context, body);
    if (options.stdout) {
      if (!isTextSafeFormat(result.reportFormat, result.contentType)) {
        throw new Error("--stdout is only supported for csv and geojson reports.");
      }
      process.stdout.write(result.body);
      return;
    }
    const filename = options.file
      ? String(options.file)
      : normalizeOutputFilename(result.filename ?? `${type}.${result.reportFormat ?? "report"}`);
    const filePath = path.resolve(process.cwd(), filename);
    await fs.writeFile(filePath, result.body);
    const metadata = {
      file: filePath,
      bytes: result.body.length,
      contentType: result.contentType,
      reportId: result.reportId,
      link: result.reportLink ? await reportFileUrl(context, result.reportLink) : undefined,
      type: result.reportType ?? type,
      format: result.reportFormat
    };
    if (context.output === "json" || context.output === "yaml") {
      outputData(generate, metadata, "pretty");
      return;
    }
    outputData(generate, [
      `saved: ${metadata.file}`,
      `bytes: ${metadata.bytes}`,
      metadata.reportId ? `reportId: ${metadata.reportId}` : undefined,
      metadata.link ? `link: ${metadata.link}` : undefined
    ].filter(Boolean).join("\n"), "pretty");
  }));

  const jobs = reports.command("jobs").description("Classic reports made with generate --background");

  const jobsList = jobs.command("list").description("List recent background report jobs");
  jobsList.action(() => runCommand(async () => {
    const data = await listReportJobsAction(contextFor(jobsList));
    outputData(jobsList, formatListTable(data.items, ["id", "status", "type", "format", "from", "until", "createdAt"]), "table");
  }));

  const jobsGet = jobs.command("get")
    .argument("<job-id>", "Report job id")
    .description("Show one background report job")
    .option("--download", "Download its file when it is completed")
    .option("--file <path>", "Output file path for --download");
  jobsGet.action((id, options) => runCommand(async () => {
    const context = contextFor(jobsGet);
    const { job } = await getReportJobAction(context, id);
    if (options.download) {
      outputData(jobsGet, await downloadReportJob(context, job, options.file), "pretty");
      return;
    }
    outputData(jobsGet, job, "pretty");
  }));

  const history = reports.command("history")
    .description("List uploaded and generated reports");
  history.action(() => runCommand(async () => {
    const context = contextFor(history);
    const data = await listReportUploadsAction(context);
    // the API answers with paths like /img/...; full links can be opened as they are
    const items: JsonRecord[] = await Promise.all(data.items.map(async (item) => ({ ...item, link: item.link ? await reportFileUrl(context, String(item.link)) : item.link })));
    outputData(history, context.output === "json" || context.output === "yaml" ? data.items : formatListTable(items, ["id", "name", "reportType", "source", "bytes", "timestamp", "link"]), "table");
  }));

  const recurring = reports.command("recurring").description("Manage recurring report configurations");

  const recurringList = recurring.command("list").description("List recurring report configurations");
  recurringList.action(() => runCommand(async () => {
    const data = await listRecurringReportsAction(contextFor(recurringList));
    outputData(recurringList, recurringRows(data.items), "table");
  }));

  const recurringShow = recurring.command("show")
    .argument("<id>", "Recurring report id")
    .description("Show one recurring report configuration");
  recurringShow.action((id) => runCommand(async () => {
    const data = await listRecurringReportsAction(contextFor(recurringShow));
    const item = data.items.find((entry) => entry.id === id);
    if (!item) {
      throw new Error(`Recurring report not found: ${id}`);
    }
    outputData(recurringShow, item, "pretty");
  }));

  const recurringCreate = addRecurringMutationOptions(recurring.command("create")
    .description("Create a recurring report configuration")
    .requiredOption("--name <name>", "Name shown in the list and the email")
    .requiredOption("--type <type>", "Classic report type; see ht reports types"));
  recurringCreate.addHelpText("after", `

Examples:
  ht reports recurring create --name "Weekly jobs" --type jobs --frame week --weekday monday --format xlsx --all-members
  ht reports recurring create --name "Daily timesheet" --type timesheet --frame day --weekday monday --weekday tuesday --all-members
`);
  recurringCreate.action((options) => runCommand(async () => {
    const context = contextFor(recurringCreate);
    const notifyMemberIds = await resolveMemberIds(context, options.notify, false);
    const body: JsonRecord = {
      name: options.name,
      type: options.type,
      frame: options.frame,
      weekdays: parseWeekdays(options.weekday),
      notifyMemberIds,
      format: options.format,
      startDate: resolveDateWord(options.startDate),
      memberIds: await resolveMemberIds(context, options.member, options.allMembers),
      placeIds: await resolvePlaceIds(context, options.place, options.allPlaces),
      columns: parseColumns(options.column),
      options: parseOptions(options.option)
    };
    const data = await createRecurringReportAction(context, body);
    outputData(recurringCreate, data.recurringReport, "pretty");
  }));

  const recurringUpdate = addRecurringMutationOptions(recurring.command("update")
    .argument("<id>", "Recurring report id")
    .description("Update a recurring report configuration")
    .option("--name <name>", "Name shown in the list and the email")
    .option("--type <type>", "Classic report type; see ht reports types"));
  recurringUpdate.action((id, options) => runCommand(async () => {
    const context = contextFor(recurringUpdate);
    const body: JsonRecord = {
      name: options.name,
      type: options.type,
      frame: options.frame,
      weekdays: parseWeekdays(options.weekday),
      notifyMemberIds: options.notify?.length ? await resolveMemberIds(context, options.notify, false) : undefined,
      format: options.format,
      startDate: resolveDateWord(options.startDate),
      memberIds: options.member?.length || options.allMembers ? await resolveMemberIds(context, options.member, options.allMembers) : undefined,
      placeIds: options.place?.length || options.allPlaces ? await resolvePlaceIds(context, options.place, options.allPlaces) : undefined,
      columns: parseColumns(options.column),
      options: parseOptions(options.option)
    };
    const data = await updateRecurringReportAction(context, id, body);
    outputData(recurringUpdate, data.recurringReport, "pretty");
  }));

  const recurringPause = recurring.command("pause")
    .argument("<id>", "Recurring report id")
    .description("Pause a recurring report configuration");
  recurringPause.action((id) => runCommand(async () => {
    const data = await updateRecurringReportAction(contextFor(recurringPause), id, { status: "paused" });
    outputData(recurringPause, data.recurringReport, "pretty");
  }));

  const recurringResume = recurring.command("resume")
    .argument("<id>", "Recurring report id")
    .description("Resume a recurring report configuration");
  recurringResume.action((id) => runCommand(async () => {
    const data = await updateRecurringReportAction(contextFor(recurringResume), id, { status: "active" });
    outputData(recurringResume, data.recurringReport, "pretty");
  }));

  const recurringDelete = recurring.command("delete")
    .argument("<id>", "Recurring report id")
    .description("Delete a recurring report configuration");
  recurringDelete.action((id) => runCommand(async () => {
    const context = contextFor(recurringDelete);
    await confirmDangerous(context, `Delete recurring report ${id}?`);
    const data = await deleteRecurringReportAction(context, id);
    outputData(recurringDelete, { id: data.id, deleted: data.deleted }, "pretty");
  }));

  registerReporting(reports);
}
