// Timesheets: the clock-in and clock-out entries behind the timesheet report.
import {
  createTimesheetEntryAction,
  deleteTimesheetEntryAction,
  listTimesheetsAction,
  updateTimesheetEntryAction
} from "@hellotracks/ht-core/actions/index.js";
import { z } from "zod";
import { DATE, HHMM, clean, each, given, ids, pick, type Json, type Tools } from "./kit.js";

const entryFields = {
  date: DATE.describe("Day of the clock-in."),
  clockIn: HHMM.optional().describe("HH:mm local."),
  clockOut: HHMM.optional().describe("HH:mm local; leave out for someone still clocked in."),
  clockOutDate: DATE.optional().describe("Day of the clock-out when it is the next day.")
};

export function registerTimesheetTools(tools: Tools): void {
  tools.add("get_timesheets", {
    title: "Get timesheets",
    description: "Clock-in and clock-out entries per person for a day or a date range, with each entry's id and the totals.",
    effect: "read",
    input: {
      date: DATE.optional().describe("One day. Or use from and until."),
      from: DATE.optional(),
      until: DATE.optional(),
      memberId: z.string().optional()
    }
  }, async ({ date, from, until, memberId }, { context, day }) => {
    const result = await listTimesheetsAction(context, {
      date: from ? undefined : await day(date),
      from: from ? await day(from) : undefined,
      until: until ? await day(until) : undefined,
      memberId
    });
    return {
      summary: result.summary,
      entries: result.items.map((entry) => clean({
        ...pick(entry, ["id", "date", "clockIn", "clockOut", "open"]),
        member: pick(entry.member as Json | undefined, ["id", "name"]),
        hours: typeof entry.durationSeconds === "number" ? Math.round(entry.durationSeconds / 36) / 100 : undefined
      }))
    };
  });

  tools.add("add_timesheet_entries", {
    title: "Add timesheet entries",
    description: "Add clock-in and clock-out entries a person forgot, e.g. \"Bo worked 08:00 to 16:30 yesterday\". They count in the timesheet report.",
    effect: "add",
    input: { entries: z.array(z.object({ memberId: z.string(), ...entryFields })).min(1).max(50) }
  }, async ({ entries }, { context, day }) => {
    const { done, failed } = await each(entries, (entry) => ({ memberId: entry.memberId, date: entry.date }), async (entry) =>
      (await createTimesheetEntryAction(context, await entryBody(entry, day))).entry);
    return { added: done, failed };
  });

  tools.add("update_timesheet_entries", {
    title: "Update timesheet entries",
    description: "Correct clock-in or clock-out times of entries from get_timesheets. Only the fields given change.",
    effect: "change",
    input: { entries: z.array(z.object({ id: z.string().describe("Entry id."), ...entryFields, date: entryFields.date.optional() })).min(1).max(50) }
  }, async ({ entries }, { context, day }) => {
    const { done, failed } = await each(entries, (entry) => ({ id: entry.id }), async ({ id, ...entry }) =>
      (await updateTimesheetEntryAction(context, id, await entryBody(entry, day))).entry);
    return { updated: done, failed };
  });

  tools.add("delete_timesheet_entries", {
    title: "Delete timesheet entries",
    description: "Delete wrong clock entries. Ask the person first: the hours leave the timesheet report.",
    effect: "remove",
    input: { ids: ids("Entry") }
  }, async (args, { context }) => {
    const { done, failed } = await each(args.ids, (id) => ({ id }), async (id) => (await deleteTimesheetEntryAction(context, id)).id);
    return { deleted: done, failed };
  });
}

async function entryBody(entry: { memberId?: string | undefined; date?: string | undefined; clockIn?: string | undefined; clockOut?: string | undefined; clockOutDate?: string | undefined; }, day: (value: string | undefined) => Promise<string>): Promise<Json> {
  return given({
    memberId: entry.memberId,
    date: entry.date ? await day(entry.date) : undefined,
    clockIn: entry.clockIn,
    clockOut: entry.clockOut,
    clockOutDate: entry.clockOutDate ? await day(entry.clockOutDate) : undefined
  });
}
