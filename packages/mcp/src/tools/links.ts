// Links people outside the company can open: a job's live arrival page, and a shared map.
import {
  createEtaSessionAction,
  createMapShareAction,
  getEtaSessionAction,
  listEtaSessionEventsAction,
  listEtaSessionsAction,
  listMapSharesAction,
  revokeEtaSessionAction,
  revokeMapShareAction
} from "@hellotracks/ht-core/actions/index.js";
import { z } from "zod";
import { DATE, clean, given, iso, pick, type Json, type Tools, limitInput, limitOf } from "./kit.js";

const EXPIRES = z.string().regex(/^\d+[mhd]$/).describe("How long it works, e.g. 24h or 3d.");
const MAP_KINDS = ["places", "members", "jobs", "zones", "trips", "waypoints", "dayroute", "timeline", "heatmap", "isochrone"] as const;

export function registerLinkTools(tools: Tools): void {
  tools.add("create_arrival_link", {
    title: "Create arrival link",
    description: "Make a live arrival page for a job's customer: arrival window, status and, if allowed, the worker on a map. Returns the link for you or the person to send; Hellotracks does not send it. Anyone with the link can open it until it expires or is revoked.",
    effect: "add",
    openWorld: true,
    input: {
      jobId: z.string(),
      expiresIn: EXPIRES.optional().describe("How long it works, e.g. 24h or 3d. Default 30 days, at most 90."),
      recipientName: z.string().optional().describe("Default: the job's contact."),
      title: z.string().max(120).optional().describe("Default: the job title."),
      showMap: z.boolean().optional().describe("Default from the company settings."),
      showWorkerName: z.boolean().optional().describe("Default from the company settings.")
    }
  }, async ({ jobId, expiresIn, recipientName, title, showMap, showWorkerName }, { context }) => {
    const { session } = await createEtaSessionAction(context, { jobId, ...given({ expiresIn, recipientName, title, showMap, showWorkerName }) });
    return sessionRow(session);
  });

  tools.add("find_arrival_links", {
    title: "Find arrival links",
    description: "Arrival pages made for jobs, with their status and whether the customer opened them. Give id for one link with what happened on it.",
    effect: "read",
    input: {
      id: z.string().optional().describe("One arrival link's id."),
      jobId: z.string().optional(),
      date: DATE.optional(),
      limit: limitInput(50, 200)
    }
  }, async ({ id, jobId, date, limit }, { context, day }) => {
    if (id) {
      const [{ session }, events] = await Promise.all([getEtaSessionAction(context, id), listEtaSessionEventsAction(context, id, { limit: 50 })]);
      return { ...sessionRow(session), events: events.items.map((event) => clean({ ...pick(event, ["type", "kind", "status"]), at: iso(event.createdAt ?? event.ts) })) };
    }
    const result = await listEtaSessionsAction(context, { jobId, date: date ? await day(date) : undefined, limit: limitOf(limit, 50, 200) });
    return { links: result.items.map(sessionRow) };
  });

  tools.add("revoke_arrival_link", {
    title: "Revoke arrival link",
    description: "Stop an arrival page from working, e.g. when it went to the wrong person.",
    effect: "remove",
    input: { id: z.string().describe("Arrival link id.") }
  }, async ({ id }, { context }) => pick(await revokeEtaSessionAction(context, id), ["id", "revoked"]));

  tools.add("share_map", {
    title: "Share map",
    description: "Make a link to a live map anyone can open without signing in: places, members, jobs, zones, a person's trips, day route or timeline, a heatmap, or how far one can drive from a place. Several kinds can go on one map. Returns the link; it expires (default 7 days, at most 30). Give date for the day kinds (trips, waypoints, dayroute, timeline).",
    effect: "add",
    openWorld: true,
    input: {
      kinds: z.array(z.enum(MAP_KINDS)).min(1).max(6).describe("What the map shows."),
      title: z.string().max(120).optional(),
      memberId: z.string().optional().describe("The person, for trips, waypoints, dayroute, timeline and isochrone."),
      placeIds: z.array(z.string()).optional().describe("Only these places."),
      date: DATE.optional(),
      minutes: z.number().int().min(1).max(120).optional().describe("isochrone: travel minutes."),
      expiresIn: EXPIRES.optional()
    }
  }, async ({ kinds, title, memberId, placeIds, date, minutes, expiresIn }, { context, day }) => {
    const { share } = await createMapShareAction(context, {
      ...(kinds.length === 1 ? { kind: kinds[0] } : { layers: kinds.map((kind) => ({ kind })) }),
      ...given({ title, memberId, placeIds, minutes, expires: expiresIn }),
      ...(date ? { date: await day(date) } : {})
    });
    return clean({ ...pick(share, ["id", "url", "title", "featureCount"]), expiresAt: iso(share.expiresAt) });
  });

  tools.add("find_map_links", {
    title: "Find map links",
    description: "Map links made for this company, with when they expire.",
    effect: "read",
    input: { limit: limitInput(50, 200) }
  }, async ({ limit }, { context }) => ({
    links: (await listMapSharesAction(context, { limit: limitOf(limit, 50, 200) })).items.map((share) => clean({
      ...pick(share, ["id", "url", "title", "kind", "createdByName", "revoked", "expired"]), expiresAt: iso(share.expiresAt)
    }))
  }));

  tools.add("revoke_map_link", {
    title: "Revoke map link",
    description: "Stop a shared map link from working.",
    effect: "remove",
    input: { id: z.string().describe("Map link id or token.") }
  }, async ({ id }, { context }) => pick(await revokeMapShareAction(context, id), ["id", "revoked"]));
}

function sessionRow(session: Json): Json {
  return clean({
    ...pick(session, ["id", "jobId", "title", "recipientName", "status", "recipientStatus", "etaConfidence"]),
    url: session.publicUrl ?? session.url,
    arrivalWindow: session.etaWindowStart ? `${iso(session.etaWindowStart)} - ${iso(session.etaWindowEnd)}` : undefined,
    viewedAt: iso(session.viewedAt),
    expiresAt: iso(session.expiresAt)
  });
}
