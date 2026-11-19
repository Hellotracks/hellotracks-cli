// The new reports' request, schedule and saved-report bodies, and waiting for a run's files.
// The CLI and the MCP server both build them here; who and which places come in as ids.
import { getReportRunAction } from "../actions/index.js";
import type { CommandContext } from "../types.js";
import { resolveDateWord } from "../utils.js";

type JsonRecord = Record<string, unknown>;

export const REPORT_PERIODS = ["today", "yesterday", "thisWeek", "lastWeek", "thisMonth", "lastMonth", "last7Days", "last30Days"];
export const REPORT_FREQUENCIES = ["none", "day", "week", "month"];
export const REPORT_DELIVERIES = ["attach", "link", "inbox"];
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const POLL_INTERVAL_MS = 2000;

export interface ReportRequestInput {
  period?: string | undefined;
  /** YYYY-MM-DD or a date word; with until. */
  from?: string | undefined;
  until?: string | undefined;
  view?: string | undefined;
  memberIds?: string[] | undefined;
  teamIds?: number[] | undefined;
  placeIds?: string[] | undefined;
  formId?: string | undefined;
  jobId?: string | undefined;
  /** Columns to include, in order; name renames one. */
  columns?: Array<{ key: string; name?: string | undefined; }> | undefined;
  options?: Record<string, string> | undefined;
  language?: string | undefined;
  compare?: boolean | undefined;
  /** For the date words: the company's time zone when the caller isn't on its clock. */
  timeZone?: string | undefined;
}

export interface ReportScheduleInput {
  every?: string | undefined;
  /** monday to sunday, mon to sun, or 1 to 7. */
  weekdays?: string[] | undefined;
  monthDay?: number | undefined;
  /** HH:mm in the company time zone. */
  at?: string | undefined;
}

export interface SavedReportInput extends ReportRequestInput, ReportScheduleInput {
  name?: string | undefined;
  formats?: string[] | undefined;
  recipientMemberIds?: string[] | undefined;
  recipientEmails?: string[] | undefined;
  delivery?: string | undefined;
  paused?: boolean | undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function reportDayNumber(value: string, label: string, timeZone?: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(resolveDateWord(value, new Date(), timeZone) ?? "");
  if (!match) {
    throw new Error(`${label} must be YYYY-MM-DD, today, yesterday, or tomorrow.`);
  }
  return Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]);
}

export function weekdayNumber(value: string): number {
  const text = value.trim().toLowerCase();
  const index = WEEKDAYS.findIndex((day) => day === text || day.slice(0, 3) === text);
  const number = index >= 0 ? index + 1 : Number(text);
  if (!Number.isInteger(number) || number < 1 || number > 7) {
    throw new Error(`Invalid weekday: ${value}. Use monday to sunday.`);
  }
  return number;
}

// Builds the API's report request on top of base, so an update keeps every field that is not passed again.
export function reportRequest(base: JsonRecord, input: ReportRequestInput): JsonRecord {
  if (input.period && (input.from || input.until)) {
    throw new Error("Use either a period or from and until, not both.");
  }
  if (Boolean(input.from) !== Boolean(input.until)) {
    throw new Error("from and until must be given together.");
  }
  if (input.period && !REPORT_PERIODS.includes(input.period)) {
    throw new Error(`Invalid period: ${input.period}. Use one of ${REPORT_PERIODS.join(", ")}.`);
  }
  if (input.memberIds?.length && input.teamIds?.length) {
    throw new Error("Use either members or teams, not both.");
  }
  const request: JsonRecord = { ...base };
  if (input.period) {
    request.period = input.period;
    delete request.fromDay;
    delete request.untilDay;
  }
  if (input.from && input.until) {
    request.fromDay = reportDayNumber(input.from, "from", input.timeZone);
    request.untilDay = reportDayNumber(input.until, "until", input.timeZone);
    delete request.period;
  }
  if (input.view) {
    request.view = input.view;
  }
  if (input.memberIds?.length) {
    request.who = { kind: "people", memberUids: input.memberIds };
  } else if (input.teamIds?.length) {
    request.who = { kind: "teams", teamIds: input.teamIds };
  }
  if (input.placeIds?.length) {
    request.places = { kind: "list", placeUids: input.placeIds };
  }
  if (input.jobId) {
    request.jobId = input.jobId;
  }
  const options: JsonRecord = { ...(isRecord(base.options) ? base.options : {}), ...input.options };
  if (input.formId) {
    options.formId = input.formId;
  }
  if (input.language) {
    options.language = input.language;
  }
  if (input.columns?.length) {
    options.columns = JSON.stringify(input.columns.map((column) => ({ key: column.key, name: column.name ?? "" })));
  }
  if (Object.keys(options).length > 0) {
    request.options = options;
  }
  if (input.compare === false) {
    request.compare = false;
  }
  return request;
}

export function reportSchedule(base: JsonRecord, input: ReportScheduleInput): JsonRecord {
  const schedule: JsonRecord = { ...base };
  if (input.every) {
    if (!REPORT_FREQUENCIES.includes(input.every)) {
      throw new Error(`Invalid schedule: ${input.every}. Use none, day, week, or month.`);
    }
    schedule.frequency = input.every;
  }
  if (input.weekdays?.length) {
    const days = input.weekdays.map(weekdayNumber);
    schedule.weekdays = days;
    schedule.weekday = days[0];
  }
  if (input.monthDay !== undefined) {
    schedule.monthDay = input.monthDay;
  }
  if (input.at) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(input.at.trim());
    if (!match) {
      throw new Error(`Invalid time: ${input.at}. Use HH:mm.`);
    }
    schedule.hour = Number(match[1]);
    schedule.minute = Number(match[2]);
  }
  return schedule;
}

// The API replaces a whole saved report, so the body starts from the existing one and changes only what is given.
export function savedReportBody(existing: JsonRecord, report: string, input: SavedReportInput): JsonRecord {
  const baseRequest = isRecord(existing.request) ? existing.request : { report };
  const recipients = isRecord(existing.recipients) ? { ...existing.recipients } : {};
  if (input.recipientMemberIds?.length) {
    recipients.memberUids = input.recipientMemberIds;
  }
  if (input.recipientEmails?.length) {
    recipients.emails = input.recipientEmails;
  }
  const body: JsonRecord = {
    name: input.name ?? existing.name,
    request: reportRequest(baseRequest, input),
    formats: input.formats?.length ? input.formats : existing.formats,
    schedule: reportSchedule(isRecord(existing.schedule) ? existing.schedule : {}, input),
    recipients,
    delivery: input.delivery ?? existing.delivery,
    status: input.paused === undefined ? existing.status : input.paused ? "paused" : "active"
  };
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}

export class ReportRunPendingError extends Error {
  constructor(readonly run: JsonRecord, timeoutSeconds: number) {
    super(`Report run ${run.id} is still ${run.status} after ${timeoutSeconds}s.`);
  }
}

// Polls a run until its files are ready; a failed run throws with the API's reason.
export async function waitForReportRun(context: CommandContext, run: JsonRecord, timeoutSeconds: number): Promise<JsonRecord> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let current = run;
  while (current.status === "queued" || current.status === "running") {
    if (Date.now() > deadline) {
      throw new ReportRunPendingError(current, timeoutSeconds);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    current = (await getReportRunAction(context, String(current.id))).run;
  }
  if (current.status === "failed") {
    const error = isRecord(current.error) ? `${current.error.code}: ${current.error.message}` : "unknown error";
    throw new Error(`Report run ${current.id} failed: ${error}`);
  }
  return current;
}

export function reportRunFiles(run: JsonRecord): JsonRecord[] {
  return Array.isArray(run.files) ? run.files.filter(isRecord) : [];
}
