// Alerts: rules that tell the office when someone arrives, leaves, misses a place, stands still or loses connection.
import {
  createAlertConfigAction,
  deleteAlertConfigAction,
  listAlertConfigsAction,
  listAlertInstancesAction,
  updateAlertConfigAction,
  updateAlertInstanceAction
} from "@hellotracks/ht-core/actions/index.js";
import { z } from "zod";
import { DATE, HHMM, WEEKDAYS, clean, each, given, ids, iso, pick, type Json, type Tools, limitInput, limitOf } from "./kit.js";

const ACTIONS = ["checks_in", "checks_out", "checks_any", "no_check_in", "no_check_out", "no_check_any", "idle", "enters_zone", "leaves_zone",
  "no_connection_to_device", "enters_danger_zone", "battery_low"] as const;

const ruleFields = {
  title: z.string().min(1).max(120),
  action: z.enum(ACTIONS).describe("What triggers it: checking in or out at places (or not by a time), standing still (idle), a zone, no connection, low battery."),
  message: z.string().max(1000).optional().describe("Text sent with the alert."),
  memberIds: z.array(z.string()).optional().describe("Whose movements count. Or teamIds. Default everyone."),
  teamIds: z.array(z.number().int()).optional(),
  placeIds: z.array(z.string()).optional().describe("Places, for the check-in kinds."),
  zoneIds: z.array(z.string()).optional().describe("Zones from find_zones; needed for the zone kinds."),
  minutes: z.number().int().min(1).max(1440).optional().describe("For idle and no_connection_to_device: how long before it triggers."),
  weekdays: z.array(z.enum(WEEKDAYS)).optional().describe("Days it watches. Default every day."),
  timeStart: HHMM.optional().describe("Watch from, HH:mm."),
  timeEnd: HHMM.optional().describe("Watch until, HH:mm."),
  emails: z.array(z.string().email()).optional().describe("Who gets an email."),
  paused: z.boolean().optional()
};

type RuleInput = { [K in keyof typeof ruleFields]?: z.output<(typeof ruleFields)[K]> | undefined };

export function registerAlertTools(tools: Tools): void {
  tools.add("find_alerts", {
    title: "Find alerts",
    description: "The alert rules (what is watched, for whom, who is told) and the alerts that went off recently, newest first, with whether they were read.",
    effect: "read",
    input: {
      ruleId: z.string().optional().describe("Only alerts of this rule."),
      from: DATE.optional(),
      until: DATE.optional(),
      limit: limitInput(30, 200).describe("Alerts to show. Default 30, at most 200.")
    }
  }, async ({ ruleId, from, until, limit }, { context, day }) => {
    const [rules, alerts] = await Promise.all([
      listAlertConfigsAction(context),
      listAlertInstancesAction(context, { configId: ruleId, from: from ? await day(from) : undefined, until: until ? await day(until) : undefined, limit: limitOf(limit, 30, 200) })
    ]);
    return {
      rules: rules.items.map((rule) => pick(rule, ["id", "title", "action", "andAction", "description", "status", "statusText", "memberIds", "teamIds", "placeIds", "zoneIds", "emails", "weekdays", "timeStart", "timeEnd", "duration"])),
      alerts: alerts.items.map((alert) => clean({ ...pick(alert, ["id", "message", "configId", "configTitle", "action", "statusText"]), at: iso(alert.createdAt ?? alert.tsCreated) }))
    };
  });

  tools.add("create_alert_rules", {
    title: "Create alert rules",
    description: "Set up alerts, e.g. \"email me when nobody checked in at the depot by 9\" (no_check_in with timeEnd 09:00) or \"tell me when a van stands still for 30 minutes\" (idle, minutes 30). They go off on their own from then on.",
    effect: "add",
    openWorld: true,
    input: { rules: z.array(z.object(ruleFields)).min(1).max(20) }
  }, async ({ rules }, { context }) => {
    const { done, failed } = await each(rules, (rule) => ({ title: rule.title }), async (rule) => pick((await createAlertConfigAction(context, ruleBody(rule))).config, ["id", "title", "action", "statusText"]));
    return { created: done, failed };
  });

  tools.add("update_alert_rules", {
    title: "Update alert rules",
    description: "Change alert rules, or pause and resume them (paused). Only the fields given change.",
    effect: "change",
    openWorld: true,
    input: { rules: z.array(z.object({ id: z.string(), ...ruleFields, title: ruleFields.title.optional(), action: ruleFields.action.optional() })).min(1).max(20) }
  }, async ({ rules }, { context }) => {
    const { done, failed } = await each(rules, (rule) => ({ id: rule.id }), async ({ id, ...rule }) => pick((await updateAlertConfigAction(context, id, ruleBody(rule))).config, ["id", "title", "action", "statusText"]));
    return { updated: done, failed };
  });

  tools.add("delete_alert_rules", {
    title: "Delete alert rules",
    description: "Delete alert rules for good. To stop one for a while, update_alert_rules with paused true instead.",
    effect: "remove",
    input: { ids: ids("Alert rule", 20) }
  }, async (args, { context }) => {
    const { done, failed } = await each(args.ids, (id) => ({ id }), async (id) => (await deleteAlertConfigAction(context, id)).id);
    return { deleted: done, failed };
  });

  tools.add("mark_alerts_read", {
    title: "Mark alerts read",
    description: "Mark alerts that went off as read (or archive them), so the dashboard shows them as handled.",
    effect: "change",
    input: { ids: ids("Alert"), archive: z.boolean().optional() }
  }, async ({ ids: alertIds, archive }, { context }) => {
    const { done, failed } = await each(alertIds, (id) => ({ id }), async (id) => (await updateAlertInstanceAction(context, id, { status: archive ? "archived" : "read" }), id));
    return { [archive ? "archived" : "read"]: done, failed };
  });
}

function ruleBody(rule: RuleInput): Json {
  return given({
    title: rule.title,
    action: rule.action,
    description: rule.message,
    memberIds: rule.memberIds,
    teamIds: rule.teamIds,
    placeIds: rule.placeIds,
    zoneIds: rule.zoneIds,
    duration: rule.minutes === undefined ? undefined : rule.minutes * 60_000,
    weekdays: rule.weekdays,
    timeStart: rule.timeStart,
    timeEnd: rule.timeEnd,
    emails: rule.emails,
    status: rule.paused === undefined ? undefined : rule.paused ? "paused" : "active"
  });
}
