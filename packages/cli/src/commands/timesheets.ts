import { Command } from "commander";
import {
  createTimesheetEntryAction,
  deleteTimesheetEntryAction,
  listMembersAction,
  listTimesheetsAction,
  updateTimesheetEntryAction,
  type TimesheetListFilters,
  type TimesheetListResponse
} from "@hellotracks/ht-core/actions/index.js";
import { confirmDangerous, contextFor, maybeWarn, outputData, runCommand } from "@hellotracks/ht-core/commands/support.js";
import type { CommandContext } from "@hellotracks/ht-core/types.js";
import { resolveDateWord } from "@hellotracks/ht-core/utils.js";

type JsonRecord = Record<string, unknown>;

const TIMESHEET_COLUMNS = [
  { column: "memberId", description: "Hellotracks member id." },
  { column: "member", description: "Member display name." },
  { column: "date", description: "Entry date in YYYY-MM-DD." },
  { column: "clockIn", description: "Clock-in time in HH:mm." },
  { column: "clockOut", description: "Clock-out time in HH:mm, empty for open shifts." },
  { column: "clockInAt", description: "Clock-in millisecond timestamp for automation." },
  { column: "clockOutAt", description: "Clock-out millisecond timestamp for automation." },
  { column: "durationSeconds", description: "Closed entry duration in seconds." },
  { column: "open", description: "true when the entry has no clock-out." },
  { column: "entryId", description: "Stable id used by update and delete." }
];

function matchesMember(item: JsonRecord, selector: string): boolean {
  const normalized = selector.toLowerCase();
  return ["id", "username", "email", "name"].some((field) => String(item[field] ?? "").toLowerCase() === normalized);
}

async function resolveMemberId(context: CommandContext, selector: string): Promise<string> {
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

async function filtersForOptions(context: CommandContext, options: Record<string, unknown>): Promise<TimesheetListFilters> {
  const date = resolveDateWord(String(options.date ?? ""));
  const from = resolveDateWord(String(options.from ?? ""));
  const until = resolveDateWord(String(options.until ?? ""));
  if (date && (from || until)) {
    throw new Error("Use either --date or --from/--until, not both.");
  }
  if ((from && !until) || (!from && until)) {
    throw new Error("--from and --until must be provided together.");
  }
  return {
    date: date || (!from && !until ? resolveDateWord("today") : undefined),
    from: from || undefined,
    until: until || undefined,
    memberId: typeof options.member === "string" && options.member ? await resolveMemberId(context, options.member) : undefined
  };
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function entryMember(entry: JsonRecord): JsonRecord {
  return record(entry.member);
}

function entryClock(entry: JsonRecord, field: "clockIn" | "clockOut"): JsonRecord {
  return record(entry[field]);
}

function formatDuration(seconds: unknown): string {
  const total = Number(seconds ?? 0);
  if (!Number.isFinite(total) || total <= 0) {
    return "";
  }
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  if (hours <= 0) {
    return `${minutes}m`;
  }
  if (minutes <= 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

function compactEntryRows(items: JsonRecord[]): JsonRecord[] {
  return items.map((entry) => {
    const member = entryMember(entry);
    const clockIn = entryClock(entry, "clockIn");
    const clockOut = entryClock(entry, "clockOut");
    return {
      member: member.name ?? member.username ?? member.id ?? "",
      date: entry.date,
      in: clockIn.time ?? "",
      out: clockOut.time ?? "",
      duration: formatDuration(entry.durationSeconds),
      status: entry.open ? "open" : "closed",
      entryId: entry.id
    };
  });
}

function exportRows(items: JsonRecord[]): JsonRecord[] {
  return items.map((entry) => {
    const member = entryMember(entry);
    const clockIn = entryClock(entry, "clockIn");
    const clockOut = entryClock(entry, "clockOut");
    return {
      memberId: member.id ?? "",
      member: member.name ?? member.username ?? "",
      date: entry.date ?? "",
      clockIn: clockIn.time ?? "",
      clockOut: clockOut.time ?? "",
      clockInAt: clockIn.timestamp ?? "",
      clockOutAt: clockOut.timestamp ?? "",
      durationSeconds: entry.durationSeconds ?? 0,
      open: entry.open === true,
      entryId: entry.id ?? ""
    };
  });
}

function summaryRows(items: JsonRecord[]): JsonRecord[] {
  const byMember = new Map<string, { member: string; totalSeconds: number; entries: number; open: number }>();
  for (const entry of items) {
    const member = entryMember(entry);
    const key = String(member.id ?? member.username ?? member.name ?? "unknown");
    const existing = byMember.get(key) ?? {
      member: String(member.name ?? member.username ?? member.id ?? "unknown"),
      totalSeconds: 0,
      entries: 0,
      open: 0
    };
    existing.totalSeconds += Number(entry.durationSeconds ?? 0);
    existing.entries += 1;
    existing.open += entry.open ? 1 : 0;
    byMember.set(key, existing);
  }
  return [...byMember.values()].map((row) => ({
    member: row.member,
    total: formatDuration(row.totalSeconds),
    entries: row.entries,
    open: row.open
  }));
}

function mutationBody(options: Record<string, unknown>, includeDateDefault = false): JsonRecord {
  return {
    date: resolveDateWord(typeof options.date === "string" ? options.date : includeDateDefault ? "today" : undefined),
    clockOutDate: resolveDateWord(typeof options.outDate === "string" ? options.outDate : undefined),
    clockIn: typeof options.in === "string" ? options.in : undefined,
    clockOut: typeof options.out === "string" ? options.out : undefined,
    clockInAt: typeof options.clockInAt === "string" ? Number(options.clockInAt) : undefined,
    clockOutAt: typeof options.clockOutAt === "string" ? Number(options.clockOutAt) : undefined
  };
}

function renderEntry(command: Command, entry: JsonRecord): void {
  const context = contextFor(command);
  if (context.output === "json" || context.output === "yaml") {
    outputData(command, entry, "pretty");
    return;
  }
  outputData(command, compactEntryRows([entry]), "table");
}

function targetPreview(action: string, memberOrEntry: string, body: JsonRecord): string {
  const pieces = [
    action,
    memberOrEntry,
    body.date ? `date ${body.date}` : undefined,
    body.clockIn ? `in ${body.clockIn}` : undefined,
    body.clockOut ? `out ${body.clockOut}` : undefined,
    body.clockInAt ? `clockInAt ${body.clockInAt}` : undefined,
    body.clockOutAt ? `clockOutAt ${body.clockOutAt}` : undefined
  ].filter(Boolean);
  return pieces.join(" ");
}

export function registerTimesheets(program: Command): void {
  const timesheets = program.command("timesheets")
    .description("Inspect, correct, create, delete, summarize, and export timesheet clock entries");

  timesheets.addHelpText("after", `

Timesheet entries are raw clock-in/clock-out records. For official PDF/XLSX reports, use:
  ht reports generate timesheet --date today --member alice --format xlsx
`);

  const list = timesheets.command("list")
    .description("List timesheet entries as a compact table")
    .option("--date <date>", "YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--from <date>", "Start date: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--until <date>", "End date: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--member <selector>", "Member id, username, email, or exact name");
  list.action((options) => runCommand(async () => {
    const context = contextFor(list);
    const data = await listTimesheetsAction(context, await filtersForOptions(context, options));
    outputData(list, context.output === "json" || context.output === "yaml" ? data : compactEntryRows(data.items), "table");
  }));

  const summary = timesheets.command("summary")
    .description("Summarize total timesheet hours by member")
    .option("--date <date>", "YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--from <date>", "Start date: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--until <date>", "End date: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--member <selector>", "Member id, username, email, or exact name");
  summary.action((options) => runCommand(async () => {
    const context = contextFor(summary);
    const data = await listTimesheetsAction(context, await filtersForOptions(context, options));
    const rows = summaryRows(data.items);
    if (context.output === "json" || context.output === "yaml") {
      outputData(summary, { ...data, memberSummary: rows }, "pretty");
      return;
    }
    outputData(summary, rows, "table");
  }));

  const add = timesheets.command("add")
    .description("Create a manual timesheet entry for one member")
    .requiredOption("--member <selector>", "Member id, username, email, or exact name")
    .option("--date <date>", "YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--in <HH:mm>", "Clock-in time")
    .option("--out <HH:mm>", "Clock-out time")
    .option("--out-date <date>", "Clock-out date for overnight entries")
    .option("--clock-in-at <ms>", "Clock-in millisecond timestamp")
    .option("--clock-out-at <ms>", "Clock-out millisecond timestamp");
  add.addHelpText("after", `

Examples:
  ht timesheets add --member alice --date today --in 08:30 --out 17:15
  ht timesheets add --member alice --date 2026-05-28 --in 22:00 --out 06:00 --out-date 2026-05-29
`);
  add.action((options) => runCommand(async () => {
    const context = contextFor(add);
    const memberId = await resolveMemberId(context, options.member);
    const body = {
      memberId,
      ...mutationBody(options, true)
    };
    maybeWarn(context, targetPreview("Creating timesheet entry for", memberId, body));
    const data = await createTimesheetEntryAction(context, body);
    renderEntry(add, data.entry);
  }));

  const update = timesheets.command("update")
    .argument("<entry-id>", "Entry id from ht timesheets list")
    .description("Update the clock-in and/or clock-out time for one entry")
    .option("--date <date>", "YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--in <HH:mm>", "Clock-in time")
    .option("--out <HH:mm>", "Clock-out time")
    .option("--out-date <date>", "Clock-out date for overnight entries")
    .option("--clock-in-at <ms>", "Clock-in millisecond timestamp")
    .option("--clock-out-at <ms>", "Clock-out millisecond timestamp");
  update.addHelpText("after", `

Examples:
  ht timesheets update 6658741c9f39a9d1a87f1111_6658741c9f39a9d1a87f2222 --in 08:45 --out 17:00
  ht timesheets update 6658741c9f39a9d1a87f1111_- --out 17:00
`);
  update.action((entryId, options) => runCommand(async () => {
    const context = contextFor(update);
    const body = mutationBody(options);
    if (!body.clockIn && !body.clockOut && !body.clockInAt && !body.clockOutAt) {
      throw new Error("Provide --in, --out, --clock-in-at, or --clock-out-at.");
    }
    maybeWarn(context, targetPreview("Updating timesheet entry", entryId, body));
    const data = await updateTimesheetEntryAction(context, entryId, body);
    renderEntry(update, data.entry);
  }));

  const del = timesheets.command("delete")
    .argument("<entry-id>", "Entry id from ht timesheets list")
    .description("Delete one timesheet entry clock pair");
  del.action((entryId) => runCommand(async () => {
    const context = contextFor(del);
    await confirmDangerous(context, `Delete timesheet entry ${entryId}?`);
    const data = await deleteTimesheetEntryAction(context, entryId);
    outputData(del, data, "pretty");
  }));

  const exportCommand = timesheets.command("export")
    .description("Export timesheet entries; use --output csv, json, yaml, or ndjson")
    .option("--date <date>", "YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--from <date>", "Start date: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--until <date>", "End date: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--member <selector>", "Member id, username, email, or exact name");
  exportCommand.action((options) => runCommand(async () => {
    const context = contextFor(exportCommand);
    const data = await listTimesheetsAction(context, await filtersForOptions(context, options));
    outputData(exportCommand, exportRows(data.items), "table");
  }));

  const columns = timesheets.command("columns")
    .description("Show export columns and their meaning");
  columns.action(() => runCommand(async () => {
    outputData(columns, TIMESHEET_COLUMNS, "table");
  }));

  const template = timesheets.command("template")
    .description("Print a CSV template for timesheet exports");
  template.action(() => runCommand(async () => {
    const headers = TIMESHEET_COLUMNS.map((column) => column.column).join(",");
    outputData(template, `${headers}\nmember-1,Alice Field,2026-05-28,08:30,17:15,,,31500,false,clockinid_clockoutid`, "pretty");
  }));
}
