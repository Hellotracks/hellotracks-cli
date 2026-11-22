// Places (customer sites, depots), zones, and planning a person's route.
import {
  createPlaceAction,
  deletePlaceAction,
  getPlaceAction,
  listPlacesAction,
  listZonesAction,
  optimizeRoutingAction,
  updatePlaceAction
} from "@hellotracks/ht-core/actions/index.js";
import { z } from "zod";
import { compactJob } from "./jobs.js";
import { DATE, clean, each, given, ids, pick, type Json, type Tools, limitInput, limitOf } from "./kit.js";

const placeFields = {
  name: z.string().min(1).max(200),
  address: z.string().max(300).optional().describe("Street address; Hellotracks finds it on the map. Or give lat and lng."),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  radius: z.number().int().min(10).max(5000).optional().describe("Check-in radius in meters: people at the place within it are checked in."),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional(),
  teams: z.array(z.number().int()).optional().describe("Team numbers from get_company. On create, without teams the place goes to your teams."),
  customFields: z.record(z.string(), z.string().nullable()).optional().describe("Custom fields; only the names given change, null removes one.")
};

const PLACE_KEYS = ["id", "name", "address", "city", "postalCode", "countryCode", "phone", "email", "teams", "radius", "location", "extendedData"];

export function registerPlaceTools(tools: Tools): void {
  tools.add("find_places", {
    title: "Find places",
    description: "Saved places (customer sites, depots) by part of their name, with address, check-in radius, teams and custom fields. A job can use a place's id instead of an address. Give id for one place.",
    effect: "read",
    input: {
      id: z.string().optional().describe("One place's id."),
      query: z.string().optional().describe("Part of the name."),
      limit: limitInput(50, 500)
    }
  }, async ({ id, query, limit }, { context }) => {
    const items = id ? [await getPlaceAction(context, id)] : (await listPlacesAction(context, { query, max: limitOf(limit, 50, 500) })).items;
    return { places: items.map((place) => pick(place, PLACE_KEYS)) };
  });

  tools.add("create_places", {
    title: "Create places",
    description: "Save places (up to 50), e.g. customer sites, so jobs can use them and people are checked in when they arrive.",
    effect: "add",
    input: { places: z.array(z.object(placeFields)).min(1).max(50) }
  }, async ({ places }, { context }) => {
    const { done, failed } = await each(places, (place) => ({ name: place.name }), async (place) => pick(await createPlaceAction(context, placeBody(place)), PLACE_KEYS));
    return { created: done, failed };
  });

  tools.add("update_places", {
    title: "Update places",
    description: "Change saved places: name, address, check-in radius, contact, teams or custom fields. Only the fields given change.",
    effect: "change",
    input: { places: z.array(z.object({ id: z.string().describe("Place id."), ...placeFields, name: placeFields.name.optional() })).min(1).max(50) }
  }, async ({ places }, { context }) => {
    const { done, failed } = await each(places, (place) => ({ id: place.id }), async ({ id, ...place }) => pick(await updatePlaceAction(context, id, placeBody(place)), PLACE_KEYS));
    return { updated: done, failed };
  });

  tools.add("delete_places", {
    title: "Delete places",
    description: "Delete saved places. Ask the person first and name the places: this can't be undone here.",
    effect: "remove",
    input: { ids: ids("Place") }
  }, async (args, { context }) => {
    const { done, failed } = await each(args.ids, (id) => ({ id }), async (id) => (await deletePlaceAction(context, id)).id);
    return { deleted: done, failed };
  });

  tools.add("find_zones", {
    title: "Find zones",
    description: "The company's zones (areas drawn on the map), with their ids for alert rules. Zones are drawn in the dashboard.",
    effect: "read",
    input: {}
  }, async (_args, { context }) => ({
    zones: (await listZonesAction(context)).items.map((zone) => pick(zone, ["id", "name", "title", "center", "memberIds", "teamIds"]))
  }));

  tools.add("optimize_route", {
    title: "Optimize route",
    description: "Plan one person's day with the Hellotracks route solver on real roads, honoring working hours, time windows, skills and capacity, and save the new order to their phone. Returns the stops in order and the jobs that did not fit, with the reason.",
    effect: "change",
    input: {
      memberId: z.string().describe("Member id."),
      date: DATE.optional(),
      ignoreTimeWindows: z.boolean().optional().describe("Plan as if jobs had no time windows."),
      ignoreWorkingHours: z.boolean().optional().describe("Allow the route to run past the person's hours."),
      ignoreSkills: z.boolean().optional(),
      ignoreCapacity: z.boolean().optional()
    }
  }, async ({ memberId, date, ignoreTimeWindows, ignoreWorkingHours, ignoreSkills, ignoreCapacity }, { context, day }) => {
    const result = await optimizeRoutingAction(context, {
      accountId: memberId,
      date: await day(date),
      solve: true,
      constraints: given({
        time_window: ignoreTimeWindows ? false : undefined,
        working_hours: ignoreWorkingHours ? false : undefined,
        skills: ignoreSkills ? false : undefined,
        capacity: ignoreCapacity ? false : undefined
      })
    });
    const items = Array.isArray(result.items) ? (result.items as Json[]) : [];
    const unassigned = new Set(Array.isArray(result.unassigned) ? result.unassigned.map(String) : []);
    return clean({
      routeUpdated: result.routeUpdated,
      reason: result.abortReason ?? result.routeReason,
      stops: items.filter((job) => !unassigned.has(String(job.id))).map(compactJob),
      didNotFit: items.filter((job) => unassigned.has(String(job.id))).map(compactJob)
    });
  });
}

type PlaceInput = { [K in keyof typeof placeFields]?: z.output<(typeof placeFields)[K]> | undefined };

function placeBody(place: PlaceInput): Json {
  const body = given({
    name: place.name,
    address: place.address,
    radius: place.radius,
    phone: place.phone,
    email: place.email,
    teams: place.teams,
    extendedData: place.customFields
  });
  if (place.lat !== undefined && place.lng !== undefined) {
    body.location = { lat: place.lat, lng: place.lng };
  }
  return body;
}
