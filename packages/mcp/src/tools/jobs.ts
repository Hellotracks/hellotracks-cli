// Jobs: the visits, deliveries and appointments on people's days.
import {
  archiveJobAction,
  createJobAction,
  deleteJobAction,
  getJobAction,
  listJobsAction,
  restoreJobAction,
  updateJobAction
} from "@hellotracks/ht-core/actions/index.js";
import { z } from "zod";
import { DATE, HHMM, clean, each, given, ids, iso, type Json, type ToolContext, type Tools } from "./kit.js";

const PROGRESS = z.enum(["unassigned", "scheduled", "accepted", "in_progress", "success", "failed"]);

const jobFields = {
  title: z.string().max(200).describe("What to do, e.g. \"Install router\"."),
  address: z.string().optional().describe("Street address; Hellotracks finds it on the map. Or give placeId or lat and lng."),
  placeId: z.string().optional().describe("A saved place instead of an address."),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  date: DATE.optional().describe("Day of the job. \"\" removes the day. Leave out for a job without a day."),
  assigneeId: z.string().optional().describe("Member id who does it; \"\" unassigns. Leave out to keep it as it is."),
  timeWindowStart: HHMM.optional().describe("Earliest arrival, HH:mm local."),
  timeWindowEnd: HHMM.optional().describe("Latest arrival, HH:mm local."),
  onSiteMinutes: z.number().int().min(0).max(1440).optional().describe("Time on site."),
  priority: z.number().int().min(0).max(10).optional().describe("0 normal, higher is more urgent."),
  notes: z.string().max(4000).optional().describe("Notes the worker sees."),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().email().optional(),
  customFields: z.record(z.string(), z.string()).optional().describe("The job's custom fields; replaces all of them."),
  externalId: z.string().optional().describe("Your own id, e.g. an order number. Creating a job with an externalId that exists updates that job, so a retry is safe.")
};

type JobInput = Partial<{ [K in keyof typeof jobFields]: z.output<(typeof jobFields)[K]> | undefined }>;

export function registerJobTools(tools: Tools): void {
  tools.add("find_jobs", {
    title: "Find jobs",
    description: "Jobs for one day, a person, a progress state or a text search (title, address, notes, order number). Returns compact rows; use get_job for one job's full details.",
    effect: "read",
    input: {
      date: DATE.optional().describe("Day of the jobs. Default today. Ignored with allDates."),
      assigneeId: z.string().optional().describe("Only this member's jobs. Use \"\" for unassigned jobs."),
      progress: PROGRESS.optional(),
      text: z.string().optional().describe("Search in title, address, notes, job id or order number."),
      externalId: z.string().optional().describe("The job with this order number or other own id."),
      allDates: z.boolean().optional().describe("Search every date (with text or externalId)."),
      includeArchived: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).optional().describe("Default 50.")
    }
  }, async ({ date, assigneeId, progress, text, externalId, allDates, includeArchived, limit }, { context, day }) => {
    const max = limit ?? 50;
    const result = await listJobsAction(context, {
      date: allDates || externalId ? undefined : await day(date),
      allDates: allDates || undefined,
      assigneeId,
      progress,
      text,
      externalId,
      includeArchived,
      limit: max
    });
    const items = (result.items ?? []).slice(0, max);
    return { count: result.totalCount ?? items.length, jobs: items.map(compactJob) };
  });

  tools.add("get_job", {
    title: "Get job",
    description: "One job with everything: address, location, time window, on-site minutes, assignee, progress and timestamps, contact, notes, custom fields and its customer arrival link.",
    effect: "read",
    input: { id: z.string().describe("Job id.") }
  }, async ({ id }, { context }) => {
    const job = await getJobAction(context, id);
    return clean({
      ...compactJob(job), placeId: job.placeId, contact: job.contact, notes: job.notes, customFields: job.customFields, location: job.location,
      createdAt: iso(job.createdAt), completedAt: iso(job.completedAt), etaUrl: job.etaUrl
    });
  });

  tools.add("create_jobs", {
    title: "Create jobs",
    description: "Create one or more jobs (up to 50). They appear on the dashboard and, when assigned, on the person's phone at once. Give externalId to make a retry safe. Run optimize_route afterwards to fit them into the person's day.",
    effect: "add",
    input: { jobs: z.array(z.object(jobFields)).min(1).max(50) }
  }, async ({ jobs }, ctx) => {
    const { done, failed } = await each(jobs, (job) => ({ title: job.title }), async (job) =>
      (await createJobAction(ctx.context, await jobBody(job, ctx))).items.map(compactJob));
    return { created: done.flat(), failed };
  });

  tools.add("update_jobs", {
    title: "Update jobs",
    description: "Change existing jobs (up to 50): assign or unassign (assigneeId \"\"), move to another day, change the time window, address, on-site time, priority, contact, notes or custom fields. Only the fields given change.",
    effect: "change",
    input: { jobs: z.array(z.object({ id: z.string().describe("Job id."), ...partial(jobFields) })).min(1).max(50) }
  }, async ({ jobs }, ctx) => {
    const changes = Object.fromEntries(await Promise.all(jobs.map(async ({ id, ...job }) => [id, await jobBody(job, ctx)] as const)));
    const result = await updateJobAction(ctx.context, { jobs: changes });
    const updated = (result.items ?? []).map(compactJob);
    // The API leaves out ids it doesn't know instead of failing; say so, or the AI app reports a change that never happened.
    const returned = new Set(updated.map((job) => String((job as Json).id)));
    const failed = jobs.filter(({ id }) => !returned.has(id)).map(({ id }) => ({ id, error: "No job with this id in this company; find_jobs gives the ids." }));
    return failed.length ? { updated, failed } : { updated };
  });

  tools.add("archive_jobs", {
    title: "Archive jobs",
    description: "Archive jobs that are no longer needed, e.g. cancelled visits. They leave the dashboard and the phones; restore_jobs brings them back.",
    effect: "change",
    input: { ids: ids("Job") }
  }, async (args, { context }) => {
    const { done, failed } = await each(args.ids, (id) => ({ id }), async (id) => (await archiveJobAction(context, id), id));
    return { archived: done, failed };
  });

  tools.add("restore_jobs", {
    title: "Restore jobs",
    description: "Bring archived jobs back to the dashboard and, when assigned, to the person's phone.",
    effect: "change",
    input: { ids: ids("Job") }
  }, async (args, { context }) => {
    const { done, failed } = await each(args.ids, (id) => ({ id }), async (id) => (await restoreJobAction(context, id), id));
    return { restored: done, failed };
  });

  tools.add("delete_jobs", {
    title: "Delete jobs",
    description: "Delete jobs for good, e.g. ones created by mistake. A deleted job can't be restored, and creating it again with its externalId gives back the deleted job. Prefer archive_jobs unless the person asks to delete.",
    effect: "remove",
    input: { ids: ids("Job") }
  }, async (args, { context }) => {
    const { done, failed } = await each(args.ids, (id) => ({ id }), async (id) => (await deleteJobAction(context, id), id));
    return { deleted: done, failed };
  });
}

/** The API's job fields from the tool's: minutes to seconds, one time window, one contact. */
async function jobBody(job: JobInput, { day }: ToolContext): Promise<Json> {
  const body = given({
    title: job.title,
    address: job.address,
    placeId: job.placeId,
    assigneeId: job.assigneeId,
    priority: job.priority,
    notes: job.notes,
    externalId: job.externalId,
    customFields: job.customFields,
    date: job.date === undefined ? undefined : job.date === "" ? "" : await day(job.date),
    onSiteDurationSeconds: job.onSiteMinutes === undefined ? undefined : job.onSiteMinutes * 60
  });
  if (job.lat !== undefined && job.lng !== undefined) {
    body.location = { lat: job.lat, lng: job.lng };
  }
  if (job.timeWindowStart !== undefined || job.timeWindowEnd !== undefined) {
    body.timeWindow = { start: job.timeWindowStart ?? "00:00", end: job.timeWindowEnd ?? "24:00" };
  }
  if (job.contactName !== undefined || job.contactPhone !== undefined || job.contactEmail !== undefined) {
    body.contact = given({ name: job.contactName, phone: job.contactPhone, email: job.contactEmail });
  }
  return body;
}

function partial<T extends Record<string, z.ZodTypeAny>>(shape: T): { [K in keyof T]: z.ZodOptional<T[K]> } {
  return Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, value.optional()])) as { [K in keyof T]: z.ZodOptional<T[K]> };
}

export function compactJob(job: Json): Json {
  const window = job.timeWindow as { start?: string; end?: string } | undefined;
  const hasWindow = window && (window.start !== "00:00" || window.end !== "24:00");
  const assignee = job.assignee as Json | undefined;
  return clean({
    id: job.id,
    title: job.title,
    date: job.date,
    progress: job.progress,
    assignee: assignee?.id ? { id: assignee.id, name: assignee.name } : undefined,
    address: job.address,
    timeWindow: hasWindow ? `${window?.start}-${window?.end}` : undefined,
    onSiteMinutes: typeof job.onSiteDurationSeconds === "number" && job.onSiteDurationSeconds > 0 ? Math.round(job.onSiteDurationSeconds / 60) : undefined,
    priority: job.priority || undefined,
    externalId: job.externalId || undefined,
    status: job.status === "deleted" || job.status === "archived" ? job.status : undefined
  });
}
