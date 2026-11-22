// The company, its settings and teams, and the people in it.
import {
  createMemberAction,
  deleteMemberAction,
  getMemberAction,
  listJobsAction,
  listMembersAction,
  showCompanyAction,
  updateCompanyAction,
  updateMemberAction,
  whoamiAction
} from "@hellotracks/ht-core/actions/index.js";
import type { CommandContext } from "@hellotracks/ht-core/types.js";
import { z } from "zod";
import { DATE, HHMM, WEEKDAYS, ago, clean, each, formatHours, given, ids, pick, stringAt, weekHours, weekdayOf, type Json, type Tools, limitInput, limitOf } from "./kit.js";

/** The company switches an admin can turn on and off, as the API names them. */
const SETTINGS: Record<string, string> = {
  workersCreateJobs: "Workers may create jobs in the app.",
  workersEditJob: "Workers may edit their jobs.",
  workersCreatePlaces: "Workers may create places.",
  workersViewPlaces: "Workers see the company's places.",
  workersOptimizeRoute: "Workers may optimize their own route.",
  workersViewJobCalendar: "Workers see the job calendar.",
  workersEditWorkingHours: "Workers may edit their own working hours.",
  workersAllowedTrackingOff: "Workers may switch tracking off.",
  workersEditTrips: "Workers may edit their trips.",
  workersWebForms: "Workers fill forms on the web.",
  tripsEnabled: "Trips (mileage log) are on.",
  tripsRequireApproval: "Trips need an admin's approval.",
  jobGroupsEnabled: "Job groups are on.",
  autoCheckins: "Automatic check-ins at places are on.",
  routeCalcIncludeCompany: "Routes start and end at the company address.",
  etaPageDefaultShowWorkerName: "Arrival pages show the worker's name by default.",
  etaPageDefaultShowMap: "Arrival pages show the map by default.",
  snoozeNotifications: "Notifications are snoozed."
};

const ROLE = z.enum(["worker", "operator", "admin"]).describe("worker uses the phone app; operator dispatches in the dashboard; admin also manages the company.");
const TEAMS = z.array(z.union([z.string(), z.number().int()])).describe("Team names or numbers, from get_company; replaces the person's teams.");

const memberFields = {
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional().describe("Mobile number with country code, e.g. +14155550123."),
  role: ROLE.optional(),
  teams: TEAMS.optional(),
  workDays: z.array(z.enum(WEEKDAYS)).optional().describe("Days they work. Default monday to friday when start and end are given."),
  start: HHMM.optional().describe("Start of their working day, HH:mm."),
  end: HHMM.optional().describe("End of their working day, HH:mm."),
  routeStartTime: z.string().optional().describe("When their route starts, HH:mm, or \"team\" for the team's time."),
  travelMode: z.enum(["car", "bicycle", "pedestrian", "truck", "van", "motorcycle"]).optional(),
  vehicleCapacity: z.number().int().min(0).optional().describe("How much fits in the vehicle, for routes with job sizes."),
  language: z.string().length(2).optional().describe("Language of the app, e.g. en, de, es."),
  timezone: z.string().optional().describe("IANA time zone, e.g. America/Chicago.")
};

type MemberInput = { [K in keyof typeof memberFields]?: z.output<(typeof memberFields)[K]> | undefined };

export function registerTeamTools(tools: Tools): void {
  tools.add("get_company", {
    title: "Get company",
    description: "The company this connection works for: name and address, who signed in, the time zone and today's date there, its teams (numbers and names) and its settings. Use it first to confirm you are in the right company.",
    effect: "read",
    input: {}
  }, async (_args, { context, connection, timeZone, day }) => {
    const [who, company] = await Promise.all([whoamiAction(context), showCompanyAction(context).catch(() => ({} as Json))]);
    return clean({
      company: { ...pick(who.company, ["id", "name"]), ...pick(company, ["name", "address", "city", "countryCode", "phone", "email"]) },
      signedInAs: { name: connection.grant.username, readOnly: connection.grant.readOnly },
      timezone: await timeZone(),
      today: await day("today"),
      teams: teamList(company),
      settings: pick((company.settings ?? {}) as Json, Object.keys(SETTINGS))
    });
  });

  tools.add("update_company", {
    title: "Update company",
    description: "Change the company's name, address, phone or email, or switch settings on and off (what workers may do in the app, trips, automatic check-ins, arrival page defaults). Only the fields given change.",
    effect: "change",
    input: {
      name: z.string().min(1).max(120).optional(),
      address: z.string().max(300).optional(),
      phone: z.string().max(30).optional(),
      email: z.string().email().optional(),
      ...Object.fromEntries(Object.entries(SETTINGS).map(([key, description]) => [key, z.boolean().optional().describe(description)]))
    }
  }, async (args, { context }) => pick(await updateCompanyAction(context, given(args as Json)), ["name", "address", "phone", "email", ...Object.keys(SETTINGS)]));

  tools.add("get_team_status", {
    title: "Get team status",
    description: "Everyone in the team for one day: role, teams, working hours that day, last known position and how long ago, whether tracking is on, and their jobs that day by progress with the next open one. The starting point for any dispatch question.",
    effect: "read",
    input: {
      date: DATE.optional(),
      team: z.string().optional().describe("Only members of this team (name or number).")
    }
  }, async ({ date, team }, { context, day }) => {
    const theDay = await day(date);
    const [members, jobs, company] = await Promise.all([
      listMembersAction(context, { max: 500 }),
      listJobsAction(context, { date: theDay, limit: 1000 }),
      showCompanyAction(context).catch(() => ({} as Json))
    ]);
    const teams = teamList(company);
    const teamName = (entry: unknown) => typeof entry === "number" ? teams.find((item) => item.id === entry)?.name ?? `Team ${entry}` : String(entry);
    const weekday = weekdayOf(theDay);
    const now = Date.now();
    const byAssignee = new Map<string, Json[]>();
    for (const job of jobs.items ?? []) {
      const id = stringAt(job, ["assignee", "id"]) ?? "";
      byAssignee.set(id, [...(byAssignee.get(id) ?? []), job]);
    }
    const people = (members.items ?? [])
      .filter((member) => member.type !== "company")
      .filter((member) => !team || (Array.isArray(member.teams) && member.teams.some((entry) => teamName(entry) === team || String(entry) === team)))
      .map((member) => {
        const own = byAssignee.get(String(member.id)) ?? [];
        const location = (member.location ?? {}) as Json;
        const ts = Number(location.ts ?? 0);
        const open = own.filter((job) => job.progress !== "success" && job.progress !== "failed");
        return clean({
          id: member.id,
          name: member.name,
          role: member.role,
          teams: Array.isArray(member.teams) ? member.teams.map(teamName) : undefined,
          workingHours: formatHours(hoursOn(member.workingHours, weekday)),
          lastSeen: ts > 0 ? ago(now - ts) : "never",
          position: ts > 0 && now - ts < 24 * 60 * 60_000 ? { lat: location.lat, lng: location.lng } : undefined,
          moving: stringAt(member, ["states", "moving"]),
          trackingOn: (member.states as Json | undefined)?.tracking_status,
          jobs: own.length ? countBy(own, "progress") : undefined,
          nextJob: open[0] ? pick(open[0], ["id", "title", "address"]) : undefined
        });
      });
    return clean({
      date: theDay,
      people,
      unassignedJobs: (byAssignee.get("") ?? []).length,
      note: jobs.hasMore ? "More than 1000 jobs that day; counts cover the first 1000. Use find_jobs per person." : undefined
    });
  });

  tools.add("find_members", {
    title: "Find members",
    description: "People in the company by name, username or email, with their login, role, teams, contact, working hours for the week, route settings and last position. Give id for one person.",
    effect: "read",
    input: {
      id: z.string().optional().describe("One member's id."),
      query: z.string().optional().describe("Part of the name, username or email."),
      limit: limitInput(100, 500)
    }
  }, async ({ id, query, limit }, { context }) => {
    const items = id ? [await getMemberAction(context, id)] : (await listMembersAction(context, { query, max: limitOf(limit, 100, 500) })).items;
    return { members: items.filter((member) => member.type !== "company").map(memberRow) };
  });

  tools.add("invite_members", {
    title: "Invite members",
    description: "Add people to the team (up to 20). Each gets an invite by email, and by text message when a phone number is given, with the link to the Hellotracks app; once they sign in, their jobs and route reach their phone and their location shows on the map. Give working hours so routes fit their day.",
    effect: "add",
    openWorld: true,
    input: {
      people: z.array(z.object({
        ...memberFields,
        name: z.string().min(1).max(120),
        email: z.string().email().optional().describe("Their email; it is their login. Give email or phone.")
      })).min(1).max(20)
    }
  }, async ({ people }, { context }) => {
    const { done, failed } = await each(people, (person) => ({ name: person.name }), async (person) => {
      const login = person.email?.trim().toLowerCase() || person.phone?.replace(/[^\d+]/g, "");
      if (!login) {
        throw new Error("Give an email or a phone number.");
      }
      const role = person.role ?? "worker";
      const member = await createMemberAction(context, { username: login, ...await memberBody(context, person), role });
      return clean({ id: member.id, name: member.name ?? person.name, login, role: member.role ?? role });
    });
    return { invited: done, failed };
  });

  tools.add("update_members", {
    title: "Update members",
    description: "Change people's name, contact, role, teams, working hours, route start time, vehicle or app language. Only the fields given change.",
    effect: "change",
    input: { members: z.array(z.object({ id: z.string().describe("Member id."), ...memberFields })).min(1).max(50) }
  }, async ({ members }, { context }) => {
    const { done, failed } = await each(members, (member) => ({ id: member.id }), async ({ id, ...person }) =>
      memberRow(await updateMemberAction(context, id, await memberBody(context, person))));
    return { updated: done, failed };
  });

  tools.add("remove_members", {
    title: "Remove members",
    description: "Take people out of the company; they can no longer sign in. Ask the person first and name who will be removed: this can't be undone here.",
    effect: "remove",
    input: { ids: ids("Member", 20) }
  }, async (args, { context }) => {
    const { done, failed } = await each(args.ids, (id) => ({ id }), async (id) => (await deleteMemberAction(context, id)).id);
    return { removed: done, failed };
  });
}

/** The API's member fields from the tool's: working hours for the week, team numbers. */
async function memberBody(context: CommandContext, person: MemberInput): Promise<Json> {
  return given({
    name: person.name,
    email: person.email?.trim().toLowerCase(),
    phone: person.phone,
    role: person.role,
    teams: person.teams ? await teamNumbers(context, person.teams) : undefined,
    workingHours: weekHours(person.workDays, person.start, person.end),
    routeStartTime: person.routeStartTime,
    travelMode: person.travelMode,
    vehicleCapacity: person.vehicleCapacity,
    language: person.language,
    timezone: person.timezone
  });
}

async function teamNumbers(context: CommandContext, teams: Array<string | number>): Promise<number[]> {
  if (teams.every((team) => typeof team === "number" || /^\d+$/.test(team))) {
    return teams.map(Number);
  }
  const known = teamList(await showCompanyAction(context));
  return teams.map((team) => {
    if (typeof team === "number" || /^\d+$/.test(team)) {
      return Number(team);
    }
    const match = known.find((entry) => entry.name.toLowerCase() === team.trim().toLowerCase());
    if (!match) {
      throw new Error(`No team named "${team}". Teams: ${known.map((entry) => `${entry.id} ${entry.name}`).join(", ") || "none"}.`);
    }
    return match.id;
  });
}

function teamList(company: Json): Array<{ id: number; name: string; }> {
  return (Array.isArray(company.teamsConfig) ? company.teamsConfig as Json[] : [])
    .map((entry) => ({ id: Number(entry.id), name: String(entry.name ?? "") }))
    .filter((entry) => Number.isFinite(entry.id));
}

function memberRow(member: Json): Json {
  const location = (member.location ?? {}) as Json;
  const ts = Number(location.ts ?? 0);
  const hours = member.workingHours && typeof member.workingHours === "object" ? member.workingHours as Json : undefined;
  return clean({
    ...pick(member, ["id", "name", "username", "email", "phone", "role", "teams", "travelMode", "vehicleCapacity", "routeStartTime", "language", "timezone"]),
    workingHours: hours ? clean(Object.fromEntries(WEEKDAYS.map((day) => [day, formatHours(hours[day])]))) : undefined,
    lastSeen: ts > 0 ? ago(Date.now() - ts) : "never",
    position: ts > 0 ? { lat: location.lat, lng: location.lng } : undefined
  });
}

function hoursOn(hours: unknown, weekday: string): unknown {
  return hours && typeof hours === "object" ? (hours as Json)[weekday] ?? null : null;
}

function countBy(items: Json[], key: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = String(item[key] ?? "unknown");
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}
