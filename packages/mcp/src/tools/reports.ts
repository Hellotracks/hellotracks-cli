// Reports: numbers right away, files (PDF, Excel, CSV) in the background, and reports sent on a schedule.
import {
  createSavedReportAction,
  deleteSavedReportAction,
  listReportCatalogAction,
  listSavedReportsAction,
  previewReportAction,
  replaceSavedReportAction,
  sendSavedReportAction,
  startReportRunAction
} from "@hellotracks/ht-core/actions/index.js";
import {
  REPORT_DELIVERIES,
  REPORT_FREQUENCIES,
  REPORT_PERIODS,
  ReportRunPendingError,
  reportRequest,
  reportRunFiles,
  savedReportBody,
  waitForReportRun,
  type ReportRequestInput
} from "@hellotracks/ht-core/reports/requests.js";
import { z } from "zod";
import { DATE, WEEKDAYS, clean, iso, pick, type Json, type Tools } from "./kit.js";

/** How long a tool call waits for a report's files before handing back the run id. */
const RUN_WAIT_SECONDS = 50;

const requestFields = {
  report: z.string().describe("Report id from list_reports, e.g. timesheet, jobs, place-visits, mileage, form-answers."),
  period: z.enum(REPORT_PERIODS as [string, ...string[]]).optional().describe("A relative period. Or from and until. Default last week."),
  from: DATE.optional(),
  until: DATE.optional(),
  view: z.string().optional().describe("One of the report's views from list_reports."),
  memberIds: z.array(z.string()).optional().describe("Only these people. Default everyone."),
  teamIds: z.array(z.number().int()).optional().describe("Only these teams, instead of memberIds."),
  placeIds: z.array(z.string()).optional(),
  formId: z.string().optional().describe("The form, for form-answers."),
  jobId: z.string().optional().describe("The job, for visit-report."),
  options: z.record(z.string(), z.string()).optional().describe("Report options from list_reports, e.g. {\"rate\":\"0.42\"}."),
  language: z.string().length(2).optional()
};

type RequestArgs = { [K in keyof typeof requestFields]?: z.output<(typeof requestFields)[K]> | undefined };

export function registerReportTools(tools: Tools): void {
  tools.add("list_reports", {
    title: "List reports",
    description: "The reports this company can run (team week, jobs, place visits, timesheet, mileage, alerts, form answers, visit report) with their views, formats, periods and options, and the saved reports with their schedules.",
    effect: "read",
    input: {}
  }, async (_args, { context }) => {
    const [catalog, saved] = await Promise.all([listReportCatalogAction(context), listSavedReportsAction(context)]);
    return {
      reports: catalog.reports.map((report) => pick(report, ["id", "title", "description", "views", "formats", "defaultPeriod", "maxDays", "options"])),
      saved: saved.saved.map((item) => clean({
        ...pick(item, ["id", "name", "report", "status", "scheduleText", "formats", "recipients"]),
        nextRun: iso(item.nextRunTs),
        lastSent: iso(item.lastSentTs)
      }))
    };
  });

  tools.add("preview_report", {
    title: "Preview report",
    description: "A report's numbers right away, without a file: its headline, key figures with the change from the period before, and the first rows of its tables. Use it to answer questions like \"how many hours did the team work last week\".",
    effect: "read",
    input: requestFields
  }, async (args, { context, timeZone }) => {
    const { model } = await previewReportAction(context, reportRequest({ report: args.report }, await requestInput(args, timeZone)));
    return pick(model, ["title", "period", "headline", "kpis", "tables"]);
  });

  tools.add("run_report", {
    title: "Run report",
    description: "Make a report file (PDF, Excel, CSV, as list_reports offers) and return signed download links; anyone with a link can download it until it expires. Big reports may take longer than this call waits: then it returns the run id, and calling run_report again with runId picks up the files.",
    effect: "read",
    input: {
      ...requestFields,
      report: requestFields.report.optional(),
      formats: z.array(z.string()).max(3).optional().describe("Default: the report's own."),
      runId: z.string().optional().describe("A run that was still being made.")
    }
  }, async (args, { context, timeZone }) => {
    let run: Json;
    if (args.runId) {
      run = { id: args.runId, status: "running" };
    } else if (args.report) {
      run = (await startReportRunAction(context, reportRequest({ report: args.report }, await requestInput(args, timeZone)), args.formats)).run;
    } else {
      throw new Error("Give report, or runId for a run that was still being made.");
    }
    try {
      const done = await waitForReportRun(context, run, RUN_WAIT_SECONDS);
      return { runId: done.id, files: reportRunFiles(done).map((file) => pick(file, ["name", "format", "bytes", "url"])) };
    } catch (error) {
      if (error instanceof ReportRunPendingError) {
        return { runId: error.run.id, status: error.run.status, note: "Still being made; call run_report with this runId in a minute." };
      }
      throw error;
    }
  });

  const scheduleFields = {
    name: z.string().max(120).optional(),
    formats: z.array(z.string()).max(3).optional(),
    every: z.enum(REPORT_FREQUENCIES as [string, ...string[]]).optional().describe("How often it sends itself; none keeps it for running by hand."),
    weekdays: z.array(z.enum(WEEKDAYS)).optional().describe("With day: the days it runs (default monday to friday). With week: the day."),
    monthDay: z.number().int().min(1).max(28).optional().describe("With month."),
    at: z.string().regex(/^\d{1,2}:\d\d$/).optional().describe("Time it runs, HH:mm in the company time zone (default 07:00)."),
    recipientMemberIds: z.array(z.string()).optional().describe("Members who get it."),
    recipientEmails: z.array(z.string().email()).optional().describe("Outside addresses that get it."),
    delivery: z.enum(REPORT_DELIVERIES as [string, ...string[]]).optional().describe("attach the file (default), send a link, or put it in the Hellotracks inbox."),
    paused: z.boolean().optional()
  };

  tools.add("save_report", {
    title: "Save report",
    description: "Keep a report by name and, with every, send it on a schedule by email, e.g. last week's timesheet every Monday at 07:00. A schedule needs at least one recipient. Give id to change a saved report; only the fields given change.",
    effect: "change",
    openWorld: true,
    input: { id: z.string().optional().describe("A saved report to change."), ...requestFields, report: requestFields.report.optional(), ...scheduleFields }
  }, async (args, { context, timeZone }) => {
    const input = { ...await requestInput(args, timeZone), ...pick(args as Json, Object.keys(scheduleFields)) };
    if (args.id) {
      const existing = (await listSavedReportsAction(context)).saved.find((item) => item.id === args.id);
      if (!existing) {
        throw new Error(`No saved report ${args.id}. Classic recurring reports are changed in the dashboard.`);
      }
      return (await replaceSavedReportAction(context, args.id, savedReportBody(existing, String(existing.report), input))).saved;
    }
    if (!args.report) {
      throw new Error("Give report for a new saved report.");
    }
    return (await createSavedReportAction(context, savedReportBody({}, args.report, input))).saved;
  });

  tools.add("send_saved_report", {
    title: "Send saved report",
    description: "Send a saved report to its recipients now, outside its schedule.",
    effect: "add",
    openWorld: true,
    input: { id: z.string() }
  }, async ({ id }, { context }) => pick((await sendSavedReportAction(context, id)).run, ["id", "status"]));

  tools.add("delete_saved_report", {
    title: "Delete saved report",
    description: "Delete a saved report and stop its schedule. To stop it for a while, save_report with paused true instead.",
    effect: "remove",
    input: { id: z.string() }
  }, async ({ id }, { context }) => deleteSavedReportAction(context, id));
}

async function requestInput(args: RequestArgs, timeZone: () => Promise<string>): Promise<ReportRequestInput> {
  return {
    period: args.period,
    from: args.from,
    until: args.until,
    view: args.view,
    memberIds: args.memberIds,
    teamIds: args.teamIds,
    placeIds: args.placeIds,
    formId: args.formId,
    jobId: args.jobId,
    options: args.options,
    language: args.language,
    timeZone: args.from || args.until ? await timeZone() : undefined
  };
}
