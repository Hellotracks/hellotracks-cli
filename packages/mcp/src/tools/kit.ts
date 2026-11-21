// What every tool shares: how it is registered, what it may do, and how answers and errors go back to the AI app.
// The tools only describe themselves and shape answers; every API call is one of the core's actions.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { whoamiAction } from "@hellotracks/ht-core/actions/index.js";
import { ApiError } from "@hellotracks/ht-core/client/api-client.js";
import type { CommandContext } from "@hellotracks/ht-core/types.js";
import { resolveDateWord } from "@hellotracks/ht-core/utils.js";
import { z } from "zod";
import type { Connection } from "../provider.js";

export type Json = Record<string, unknown>;

/** What a tool does to the company's data; it sets the hints AI apps show and whether a read-only connection may use it. */
export type Effect = "read" | "add" | "change" | "remove";

const HINTS: Record<Effect, { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; }> = {
  read: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  add: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  change: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  remove: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
};

export interface ToolContext {
  /** The core's context with this person's key. */
  context: CommandContext;
  /** YYYY-MM-DD for a date or today, tomorrow, yesterday, in the company's time zone. */
  day(value: string | undefined): Promise<string>;
  timeZone(): Promise<string>;
  connection: Connection;
}

export interface ToolSpec<Shape extends z.ZodRawShape> {
  title: string;
  description: string;
  effect: Effect;
  /** It reaches people or the web outside Hellotracks: invites, public links, emails. */
  openWorld?: boolean;
  input: Shape;
}

export class Tools {
  private zone: string | undefined;
  readonly ctx: ToolContext;

  constructor(private readonly server: McpServer, connection: Connection, context: CommandContext) {
    this.ctx = {
      context,
      connection,
      timeZone: () => this.timeZone(),
      day: async (value) => checkedDay(resolveDateWord(value ?? "today", new Date(), await this.timeZone()) ?? "", value)
    };
  }

  add<Shape extends z.ZodRawShape>(name: string, spec: ToolSpec<Shape>, handler: (args: z.output<z.ZodObject<Shape>>, ctx: ToolContext) => Promise<unknown>): void {
    // A read-only connection is offered only the tools that read, so the AI app never shows changes it can't make.
    // The check in the handler below stays as the guard.
    if (spec.effect !== "read" && this.ctx.connection.grant.readOnly) {
      return;
    }
    const register = this.server.registerTool.bind(this.server) as (name: string, config: unknown, callback: (args: unknown) => Promise<CallToolResult>) => void;
    register(name, {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.input,
      annotations: { title: spec.title, ...HINTS[spec.effect], openWorldHint: spec.openWorld ?? false }
    }, async (args) => run(async () => {
      if (spec.effect !== "read" && this.ctx.connection.grant.readOnly) {
        throw new ApiError("This connection is read only. Reconnect Hellotracks without \"Read only\" to make changes.", "read_only", 403);
      }
      return handler(args as z.output<z.ZodObject<Shape>>, this.ctx);
    }));
  }

  private async timeZone(): Promise<string> {
    if (!this.zone) {
      const grantId = this.ctx.connection.grant.id;
      const known = ZONES.get(grantId);
      if (known && Date.now() - known.at < ZONE_TTL_MS) {
        this.zone = known.zone;
      } else {
        const who = await whoamiAction(this.ctx.context).catch(() => undefined);
        const zone = stringAt(who, ["account", "locale", "timezone"]);
        this.zone = zone ?? "UTC";
        if (zone) {
          ZONES.set(grantId, { zone, at: Date.now() });
        }
      }
    }
    return this.zone;
  }
}

/**
 * Each request gets a new server, so without this every tool call with a date asked the API who the person is. The
 * API refuses more than 20 identical requests per key and minute, so a busy AI app was throttled on everything.
 */
const ZONES = new Map<string, { zone: string; at: number }>();
const ZONE_TTL_MS = 60 * 60 * 1000;

async function run(work: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const result = await work();
    return { content: [{ type: "text", text: JSON.stringify(result ?? { ok: true }) }] };
  } catch (error) {
    const message = error instanceof ApiError ? `${error.message} (${error.code})` : (error as Error).message;
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}

function checkedDay(resolved: string, original: string | undefined): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resolved) || Number.isNaN(Date.parse(`${resolved}T00:00:00Z`))) {
    throw new ApiError(`"${original}" is not a date; use YYYY-MM-DD, today, tomorrow or yesterday`, "invalid_date", 400);
  }
  return resolved;
}

/** Runs one call per item, so one bad item doesn't stop the rest; returns what worked and what failed with why. */
export async function each<T, R>(items: T[], label: (item: T) => Json, work: (item: T) => Promise<R>): Promise<{ done: R[]; failed: Json[]; }> {
  const done: R[] = [];
  const failed: Json[] = [];
  for (const item of items) {
    try {
      done.push(await work(item));
    } catch (error) {
      failed.push({ ...label(item), error: (error as Error).message });
    }
  }
  return { done, failed };
}

// Shared input pieces.
export const DATE = z.string().describe("YYYY-MM-DD, or today, tomorrow, yesterday (company time zone).");
export const HHMM = z.string().regex(/^\d\d:\d\d$/);
export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
export const ids = (what: string, max = 50) => z.array(z.string()).min(1).max(max).describe(`${what} ids.`);

// Answer helpers: AI apps read compact JSON best, so empty values are left out.
export function clean(record: Json): Json {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== null && value !== ""
    && !(Array.isArray(value) && value.length === 0)));
}

export function pick(record: Json | undefined, keys: string[]): Json {
  return clean(Object.fromEntries(keys.map((key) => [key, record?.[key]])));
}

/** Only the fields given, so an update changes nothing else. */
export function given(record: Json): Json {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

export function stringAt(record: unknown, path: string[]): string | undefined {
  let current: unknown = record;
  for (const key of path) {
    current = current && typeof current === "object" ? (current as Json)[key] : undefined;
  }
  return typeof current === "string" && current ? current : undefined;
}

export function iso(ms: unknown): string | undefined {
  return typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : undefined;
}

export function ago(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  if (minutes < 48 * 60) {
    return `${Math.round(minutes / 60)} h ago`;
  }
  return `${Math.round(minutes / 1440)} days ago`;
}

export function weekdayOf(date: string): string {
  return WEEKDAYS[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7] ?? "monday";
}

/** Seven days as the API wants them ({start: 800, end: 1700}, equal for a day off), or undefined without start and end. */
export function weekHours(days: readonly string[] | undefined, start: string | undefined, end: string | undefined): Json | undefined {
  if (!start || !end) {
    return undefined;
  }
  const value = (hhmm: string) => Number(hhmm.slice(0, 2)) * 100 + Number(hhmm.slice(3, 5));
  const working = new Set(days?.length ? days : WEEKDAYS.slice(0, 5));
  return Object.fromEntries(WEEKDAYS.map((day) => [day, working.has(day) ? { start: value(start), end: value(end) } : { start: 0, end: 0 }]));
}

/** 900 → "09:00"; a day with no hours (start = end) is off. */
export function formatHours(day: unknown): string | undefined {
  if (!day || typeof day !== "object") {
    return undefined;
  }
  const { start, end } = day as { start?: number; end?: number };
  if (typeof start !== "number" || typeof end !== "number") {
    return undefined;
  }
  if (start === end) {
    return "off";
  }
  const hhmm = (value: number) => `${String(Math.floor(value / 100)).padStart(2, "0")}:${String(value % 100).padStart(2, "0")}`;
  return `${hhmm(start)}-${hhmm(end)}`;
}
