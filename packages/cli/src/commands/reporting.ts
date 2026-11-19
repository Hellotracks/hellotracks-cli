import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  createSavedReportAction,
  deleteSavedReportAction,
  getReportRunAction,
  listReportCatalogAction,
  listSavedReportsAction,
  previewReportAction,
  replaceSavedReportAction,
  sendSavedReportAction,
  startReportRunAction
} from "@hellotracks/ht-core/actions/index.js";
import { confirmDangerous, contextFor, maybeWarn, outputData, runCommand } from "@hellotracks/ht-core/commands/support.js";
import type { CommandContext } from "@hellotracks/ht-core/types.js";
import { REPORT_PERIODS, ReportRunPendingError, reportRequest, reportRunFiles, savedReportBody, waitForReportRun, type ReportRequestInput, type SavedReportInput } from "@hellotracks/ht-core/reports/requests.js";
import { collect, resolveMemberIds, resolvePlaceIds } from "./selectors.js";

type JsonRecord = Record<string, unknown>;


interface RequestOptions {
  period?: string;
  from?: string;
  until?: string;
  view?: string;
  member: string[];
  team: string[];
  place: string[];
  form?: string;
  job?: string;
  column: string[];
  option: string[];
  language?: string;
  compare?: boolean;
}

interface SavedOptions extends RequestOptions {
  name?: string;
  format: string[];
  every?: string;
  weekday: string[];
  monthDay?: string;
  at?: string;
  to: string[];
  email: string[];
  delivery?: string;
  paused?: boolean;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rawMode(context: CommandContext): boolean {
  return context.output === "json" || context.output === "yaml";
}

function dayText(day: unknown): string {
  const value = String(day ?? "");
  return /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : "";
}

function timestampText(value: unknown): string {
  return typeof value === "number" && value > 0 ? new Date(value).toISOString().replace("T", " ").slice(0, 16) : "";
}

function keyValues(values: string[], label: string): Record<string, string> {
  return Object.fromEntries(values.map((value) => {
    const index = value.indexOf("=");
    if (index <= 0) {
      throw new Error(`Invalid ${label} value: ${value}. Use key=value.`);
    }
    return [value.slice(0, index), value.slice(index + 1)];
  }));
}

function addRequestOptions(command: Command): Command {
  return command
    .option("--period <period>", `Relative period: ${REPORT_PERIODS.join(", ")}`)
    .option("--from <date>", "First day: YYYY-MM-DD, today, yesterday, or tomorrow; use with --until")
    .option("--until <date>", "Last day: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--view <view>", "One of the report's views; see ht reports catalog")
    .option("--member <selector>", "Only this member: id, username, email, or exact name; repeatable. Default: everyone", collect, [])
    .option("--team <id>", "Only this team id, following new members; repeatable", collect, [])
    .option("--place <selector>", "Only this place: id or exact name; repeatable", collect, [])
    .option("--form <templateId>", "Form template id; required for form-answers")
    .option("--job <jobId>", "Job id; required for visit-report")
    .option("--column <key=Name>", "Column to include, in order, optionally renamed; repeatable", collect, [])
    .option("--option <key=value>", "Report option, for example status=open,done or rate=0.42; repeatable", collect, [])
    .option("--language <code>", "Language of the report text, for example en, de, or es")
    .option("--no-compare", "Leave out the comparison with the period before");
}

// Turns the options into the core's request input, finding members and places by id, username, email or name.
async function requestInput(context: CommandContext, options: RequestOptions): Promise<ReportRequestInput> {
  const columns = options.column.map((column) => {
    const index = column.indexOf("=");
    return index > 0 ? { key: column.slice(0, index), name: column.slice(index + 1) } : { key: column };
  });
  return {
    period: options.period,
    from: options.from,
    until: options.until,
    view: options.view,
    memberIds: options.member.length > 0 ? await resolveMemberIds(context, options.member, false) : undefined,
    teamIds: options.team.map((team) => Number.parseInt(team, 10)),
    placeIds: options.place.length > 0 ? await resolvePlaceIds(context, options.place, false) : undefined,
    formId: options.form,
    jobId: options.job,
    columns,
    options: keyValues(options.option, "--option"),
    language: options.language,
    compare: options.compare
  };
}

async function buildRequest(context: CommandContext, base: JsonRecord, options: RequestOptions): Promise<JsonRecord> {
  if (options.member.length > 0 && options.team.length > 0) {
    throw new Error("Use either --member or --team, not both.");
  }
  return reportRequest(base, await requestInput(context, options));
}

function catalogRows(reports: JsonRecord[]): JsonRecord[] {
  return reports.map((report) => ({
    report: report.id,
    title: report.title,
    formats: Array.isArray(report.formats) ? report.formats.join(",") : "",
    period: report.defaultPeriod || "-",
    maxDays: report.maxDays || "-",
    views: Array.isArray(report.views) ? report.views.map((view) => isRecord(view) ? view.id : view).join(",") : ""
  }));
}

function runText(run: JsonRecord): string {
  const lines = [
    `run: ${run.id}`,
    `title: ${run.title ?? ""}`,
    `status: ${run.status}`
  ];
  if (isRecord(run.error)) {
    lines.push(`error: ${run.error.code}: ${run.error.message}`);
  }
  for (const file of reportRunFiles(run)) {
    lines.push(`file: ${file.name} (${file.format}, ${file.bytes} bytes) ${file.url}`);
  }
  return lines.join("\n");
}

async function waitForRun(context: CommandContext, run: JsonRecord, timeoutSeconds: number): Promise<JsonRecord> {
  try {
    return await waitForReportRun(context, run, timeoutSeconds);
  } catch (error) {
    if (error instanceof ReportRunPendingError) {
      throw new Error(`${error.message} Check later with: ht reports status ${error.run.id} --download`);
    }
    throw error;
  }
}

// File links are signed, so downloads send no API key.
async function downloadFiles(run: JsonRecord, options: { dir?: string; file?: string }): Promise<Array<{ path: string; bytes: number; format: unknown }>> {
  const files = reportRunFiles(run);
  if (options.file && files.length > 1) {
    throw new Error("--file takes one format; use --dir for several.");
  }
  const saved = [];
  for (const file of files) {
    const response = await fetch(String(file.url));
    if (!response.ok) {
      throw new Error(`Download of ${file.name} failed with HTTP ${response.status}.`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const name = String(file.name ?? `${file.id}.${file.format}`).replace(/[\/\\]/g, "-");
    const target = path.resolve(process.cwd(), options.file ?? path.join(options.dir ?? ".", name));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
    saved.push({ path: target, bytes: bytes.length, format: file.format });
  }
  return saved;
}

async function finishRun(command: Command, context: CommandContext, run: JsonRecord, options: { wait?: boolean; timeout: string; dir?: string; file?: string; stdout?: boolean }): Promise<void> {
  if (options.wait === false) {
    outputData(command, rawMode(context) ? run : `${runText(run)}\n\nCheck it with: ht reports status ${run.id} --download`, "pretty");
    return;
  }
  maybeWarn(context, `Waiting for report run ${run.id}`);
  const done = await waitForRun(context, run, Number.parseInt(options.timeout, 10));
  if (options.stdout) {
    const files = reportRunFiles(done);
    if (files.length !== 1 || !["csv", "json"].includes(String(files[0]?.format))) {
      throw new Error("--stdout needs exactly one csv or json file.");
    }
    const response = await fetch(String(files[0]?.url));
    if (!response.ok) {
      throw new Error(`Download of ${files[0]?.name} failed with HTTP ${response.status}.`);
    }
    process.stdout.write(Buffer.from(await response.arrayBuffer()));
    return;
  }
  const saved = await downloadFiles(done, options);
  if (rawMode(context)) {
    outputData(command, { run: done, saved }, "pretty");
    return;
  }
  outputData(command, saved.map((file) => `saved: ${file.path} (${file.bytes} bytes)`).join("\n") || runText(done), "pretty");
}

function addRunOutputOptions(command: Command): Command {
  return command
    .option("--no-wait", "Start the run and return its id without waiting for the files")
    .option("--timeout <seconds>", "How long to wait for the files", "300")
    .option("--dir <dir>", "Folder for the downloaded files", ".")
    .option("--file <path>", "File path when one format is made")
    .option("--stdout", "Write a single csv or json file to stdout");
}

function savedRows(saved: JsonRecord[]): JsonRecord[] {
  return saved.map((item) => ({
    id: item.id,
    name: item.name,
    report: item.report ?? item.type,
    schedule: item.scheduleText ?? item.frame ?? "",
    status: item.status,
    nextRun: timestampText(item.nextRunTs),
    lastSent: timestampText(item.lastSentTs),
    kind: item.classic ? "classic" : "saved"
  }));
}

async function findSaved(context: CommandContext, id: string): Promise<JsonRecord> {
  const data = await listSavedReportsAction(context);
  const saved = data.saved.find((item) => item.id === id);
  if (!saved) {
    if (data.classic.some((item) => item.id === id)) {
      throw new Error(`${id} is a classic recurring report; manage it with ht reports recurring.`);
    }
    throw new Error(`Saved report not found: ${id}`);
  }
  return saved;
}

function addSavedOptions(command: Command): Command {
  return addRequestOptions(command)
    .option("--name <name>", "Name shown in the list and in the email")
    .option("--format <format>", "File format, up to three; repeatable", collect, [])
    .option("--every <frequency>", "Schedule: none, day, week, or month")
    .option("--weekday <day>", "With day: the days it runs (default monday to friday); with week: the day it runs; repeatable", collect, [])
    .option("--month-day <day>", "With month: day of the month, 1 to 28")
    .option("--at <time>", "Time it runs, HH:mm in the company time zone (default 07:00)")
    .option("--to <member>", "Member who receives it: id, username, email, or exact name; repeatable", collect, [])
    .option("--email <address>", "Outside email address that receives it; repeatable", collect, [])
    .option("--delivery <delivery>", "attach (default), link, or inbox")
    .option("--paused", "Save it paused");
}

async function savedBody(context: CommandContext, existing: JsonRecord, report: string, options: SavedOptions): Promise<JsonRecord> {
  if (options.member.length > 0 && options.team.length > 0) {
    throw new Error("Use either --member or --team, not both.");
  }
  const input: SavedReportInput = {
    ...await requestInput(context, options),
    name: options.name,
    formats: options.format,
    every: options.every,
    weekdays: options.weekday,
    monthDay: options.monthDay ? Number.parseInt(options.monthDay, 10) : undefined,
    at: options.at,
    recipientMemberIds: options.to.length > 0 ? await resolveMemberIds(context, options.to, false) : undefined,
    recipientEmails: options.email,
    delivery: options.delivery,
    paused: options.paused ? true : undefined
  };
  return savedReportBody(existing, report, input);
}

export function registerReporting(reports: Command): void {
  const catalog = reports.command("catalog")
    .description("List the new reports with their views, formats, and default periods");
  catalog.action(() => runCommand(async () => {
    const context = contextFor(catalog);
    const data = await listReportCatalogAction(context);
    outputData(catalog, rawMode(context) ? data.reports : catalogRows(data.reports), "table");
  }));

  const preview = addRequestOptions(reports.command("preview")
    .argument("<report>", "Report id from ht reports catalog")
    .description("Show a report's headline numbers right away, without making a file")
    .option("--html <path>", "Also save the preview page as HTML"));
  preview.action((report, options) => runCommand(async () => {
    const context = contextFor(preview);
    const data = await previewReportAction(context, await buildRequest(context, { report }, options));
    if (options.html) {
      await fs.writeFile(path.resolve(process.cwd(), options.html), data.html);
    }
    if (rawMode(context)) {
      outputData(preview, data.model, "pretty");
      return;
    }
    const model = data.model;
    const period = isRecord(model.period) ? model.period : {};
    const lines = [
      String(model.title ?? report),
      `period: ${period.label ?? ""} (${dayText(period.fromDay)} to ${dayText(period.untilDay)})`
    ];
    if (model.headline) {
      lines.push("", String(model.headline));
    }
    for (const kpi of Array.isArray(model.kpis) ? model.kpis.filter(isRecord) : []) {
      const delta = isRecord(kpi.delta) && kpi.delta.display ? `  (${kpi.delta.display})` : "";
      lines.push(`${kpi.label ?? kpi.key}: ${kpi.display ?? kpi.value ?? ""}${delta}`);
    }
    for (const table of Array.isArray(model.tables) ? model.tables.filter(isRecord) : []) {
      lines.push(`table ${table.key}: ${table.totalRows ?? (Array.isArray(table.rows) ? table.rows.length : 0)} rows`);
    }
    lines.push("", "Use --json for the full model, or ht reports run to make the file.");
    outputData(preview, lines.join("\n"), "pretty");
  }));

  const run = addRunOutputOptions(addRequestOptions(reports.command("run")
    .argument("<report>", "Report id from ht reports catalog")
    .description("Make a report file in the background, wait for it, and download it")
    .option("--format <format>", "File format, up to three; repeatable. Default: the report's own", collect, [])));
  run.addHelpText("after", `

Examples:
  ht reports catalog
  ht reports run timesheet --period lastWeek --format xlsx
  ht reports run jobs --from 2026-10-01 --until 2026-10-31 --format csv --stdout
  ht reports run form-answers --form <template-id> --period lastMonth --format csv --format pdf --dir reports/
  ht reports run mileage --period lastMonth --member alice --option rate=0.42 --option currency=EUR

Reports from ht reports catalog run in the background. The command waits for the files
and saves them; --no-wait returns the run id for ht reports status.
`);
  run.action((report, options) => runCommand(async () => {
    const context = contextFor(run);
    const data = await startReportRunAction(context, await buildRequest(context, { report }, options), options.format);
    await finishRun(run, context, data.run, options);
  }));

  const status = reports.command("status")
    .argument("<run-id>", "Run id from ht reports run --no-wait or ht reports saved send")
    .description("Show a report run and its files")
    .option("--download", "Download the files once the run is done")
    .option("--dir <dir>", "Folder for the downloaded files", ".");
  status.action((runId, options) => runCommand(async () => {
    const context = contextFor(status);
    const data = await getReportRunAction(context, runId);
    if (options.download && data.run.status === "done") {
      const saved = await downloadFiles(data.run, { dir: options.dir });
      outputData(status, rawMode(context) ? { run: data.run, saved } : saved.map((file) => `saved: ${file.path} (${file.bytes} bytes)`).join("\n"), "pretty");
      return;
    }
    outputData(status, rawMode(context) ? data.run : runText(data.run), "pretty");
  }));

  const saved = reports.command("saved").description("Saved reports: the new reports kept by name, optionally sent on a schedule");

  const savedList = saved.command("list").description("List saved reports, including classic recurring reports");
  savedList.action(() => runCommand(async () => {
    const context = contextFor(savedList);
    const data = await listSavedReportsAction(context);
    outputData(savedList, rawMode(context) ? data : savedRows([...data.saved, ...data.classic]), "table");
  }));

  const savedGet = saved.command("get").argument("<id>", "Saved report id").description("Show one saved report");
  savedGet.action((id) => runCommand(async () => {
    const context = contextFor(savedGet);
    outputData(savedGet, await findSaved(context, id), "pretty");
  }));

  const savedCreate = addSavedOptions(saved.command("create")
    .argument("<report>", "Report id from ht reports catalog")
    .description("Save a report, optionally on a schedule with recipients"));
  savedCreate.addHelpText("after", `

Examples:
  ht reports saved create timesheet --name "Weekly hours" --every week --weekday monday --at 07:00 --to alice --format xlsx
  ht reports saved create jobs --every day --weekday mon --weekday wed --weekday fri --email office@example.com --delivery link
  ht reports saved create mileage --name "Mileage, on demand"

A schedule needs at least one --to or --email. It covers yesterday, last week, or last month unless --period says otherwise.
`);
  savedCreate.action((report, options) => runCommand(async () => {
    const context = contextFor(savedCreate);
    const data = await createSavedReportAction(context, await savedBody(context, {}, report, options));
    outputData(savedCreate, data.saved, "pretty");
  }));

  const savedUpdate = addSavedOptions(saved.command("update")
    .argument("<id>", "Saved report id")
    .description("Change a saved report; everything not passed stays as it is"));
  savedUpdate.action((id, options) => runCommand(async () => {
    const context = contextFor(savedUpdate);
    const existing = await findSaved(context, id);
    const data = await replaceSavedReportAction(context, id, await savedBody(context, existing, String(existing.report), options));
    outputData(savedUpdate, data.saved, "pretty");
  }));

  for (const [name, statusValue, description] of [["pause", "paused", "Stop sending a saved report on its schedule"], ["resume", "active", "Send a paused saved report on its schedule again"]] as const) {
    const command = saved.command(name).argument("<id>", "Saved report id").description(description);
    command.action((id) => runCommand(async () => {
      const context = contextFor(command);
      const existing = await findSaved(context, id);
      const { name: savedName, request, formats, schedule, recipients, delivery } = existing;
      const data = await replaceSavedReportAction(context, id, { name: savedName, request, formats, schedule, recipients, delivery, status: statusValue });
      outputData(command, data.saved, "pretty");
    }));
  }

  const savedSend = saved.command("send")
    .argument("<id>", "Saved report id")
    .description("Send a saved report to its recipients now")
    .option("--download", "Also wait for the files and download them")
    .option("--timeout <seconds>", "How long to wait with --download", "300")
    .option("--dir <dir>", "Folder for the downloaded files", ".");
  savedSend.action((id, options) => runCommand(async () => {
    const context = contextFor(savedSend);
    const data = await sendSavedReportAction(context, id);
    await finishRun(savedSend, context, data.run, { ...options, wait: Boolean(options.download) });
  }));

  const savedDelete = saved.command("delete").argument("<id>", "Saved report id").description("Delete a saved report");
  savedDelete.action((id) => runCommand(async () => {
    const context = contextFor(savedDelete);
    await confirmDangerous(context, `Delete saved report ${id}?`);
    outputData(savedDelete, await deleteSavedReportAction(context, id), "pretty");
  }));
}

