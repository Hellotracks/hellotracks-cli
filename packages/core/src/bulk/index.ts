import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { stringify as stringifyYaml } from "yaml";
import {
  createJobAction,
  createMemberAction,
  createPlaceAction,
  listAllJobsAction,
  listMembersAction,
  listPlacesAction,
  updateJobAction,
  updateMemberAction,
  updatePlaceAction
} from "../actions/index.js";
import type { CommandContext } from "../types.js";
import { getBulkTemplate } from "./templates.js";

type JsonRecord = Record<string, unknown>;
export type BulkResource = "jobs" | "places" | "members";
export type BulkMode = "import" | "sync";

export interface BulkRunOptions {
  file: string;
  format?: string | undefined;
  upsertBy?: string | undefined;
  dryRun?: boolean | undefined;
  continueOnError?: boolean | undefined;
  batchSize?: number | undefined;
}

export interface BulkRunReport {
  resource: BulkResource;
  mode: BulkMode;
  dryRun: boolean;
  upsertBy: string | undefined;
  summary: {
    input: number;
    plannedCreate: number;
    plannedUpdate: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
  };
  operations: Array<{ action: "create" | "update"; key: string | undefined; id: string | undefined; record: JsonRecord }>;
  // Jobs deleted in Hellotracks stay deleted: the API answers a sync of their externalId with the deleted job.
  skipped: Array<{ index: number; key: string | undefined; id: string | undefined; reason: "deleted" }>;
  errors: Array<{ index: number; code: string; message: string; record?: JsonRecord }>;
}

function isDeletedJob(item: unknown): boolean {
  return isRecord(item) && item.status === "deleted";
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanObject(record: JsonRecord): JsonRecord {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== ""));
}

function setPath(target: JsonRecord, pathValue: string, value: string): void {
  const parts = pathValue.split(".").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0 || value === "") {
    return;
  }
  let current = target;
  for (const [index, part] of parts.entries()) {
    if (index === parts.length - 1) {
      current[part] = value;
      return;
    }
    const next = current[part];
    if (!isRecord(next)) {
      current[part] = {};
    }
    current = current[part] as JsonRecord;
  }
}

function inferFormat(file: string, explicit?: string): string {
  if (explicit && explicit !== "auto") {
    return explicit;
  }
  const ext = path.extname(file).toLowerCase();
  if (ext === ".yaml" || ext === ".yml") return "yaml";
  if (ext === ".csv") return "csv";
  if (ext === ".ndjson" || ext === ".jsonl") return "ndjson";
  return "json";
}

export function inferStructuredFormat(file: string, explicit?: string): string {
  return inferFormat(file, explicit);
}

function parseCsv(raw: string): JsonRecord[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];
    if (quoted && char === "\"" && next === "\"") {
      cell += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  row.push(cell);
  if (row.some((value) => value !== "")) rows.push(row);
  const headers = rows.shift()?.map((header) => header.trim()) ?? [];
  return rows.map((values) => {
    const record: JsonRecord = {};
    headers.forEach((header, index) => setPath(record, header, values[index] ?? ""));
    return cleanObject(record);
  });
}

export async function readBulkRecords(file: string, format?: string): Promise<JsonRecord[]> {
  const raw = await fs.readFile(file, "utf8");
  const resolvedFormat = inferFormat(file, format);
  const parsed = (() => {
    if (resolvedFormat === "csv") return parseCsv(raw);
    if (resolvedFormat === "ndjson") return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as unknown);
    if (resolvedFormat === "yaml" || resolvedFormat === "yml") return parseYaml(raw) as unknown;
    return JSON.parse(raw) as unknown;
  })();
  const records = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.items) ? parsed.items : undefined;
  if (!records || !records.every(isRecord)) {
    throw new Error("Bulk input must be an array of objects or an object with an items array.");
  }
  return records.map(cleanObject);
}

export async function readStructuredFile(file: string, format?: string): Promise<unknown> {
  const raw = await fs.readFile(file, "utf8");
  const resolvedFormat = inferFormat(file, format);
  if (resolvedFormat === "yaml" || resolvedFormat === "yml") {
    return parseYaml(raw) as unknown;
  }
  if (resolvedFormat === "ndjson") {
    return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as unknown);
  }
  if (resolvedFormat === "csv") {
    return parseCsv(raw);
  }
  return JSON.parse(raw) as unknown;
}

export function stringifyStructured(value: unknown, format = "json"): string {
  if (format === "yaml" || format === "yml") {
    return stringifyYaml(value);
  }
  if (format === "ndjson") {
    const items = Array.isArray(value) ? value : [value];
    return `${items.map((item) => JSON.stringify(item)).join("\n")}\n`;
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}

// the API returns 500 places unless asked for more
const ALL_PLACES = 1_000_000;

async function existingByKey(context: CommandContext, resource: BulkResource, key: string): Promise<Map<string, JsonRecord>> {
  // all of them: matching only against a first page would create duplicates in bigger accounts
  const items = resource === "jobs"
    ? (await listAllJobsAction(context, { allDates: true })).items
    : resource === "places"
      ? (await listPlacesAction(context, { max: ALL_PLACES })).items
      : (await listMembersAction(context)).items;
  const map = new Map<string, JsonRecord>();
  for (const item of items) {
    const value = item[key];
    if (value !== undefined && value !== null) {
      map.set(String(value).toLowerCase(), item);
    }
  }
  return map;
}

const DEFAULT_JOB_BATCH_SIZE = 50;

// Writes the creates and the updates of a batch as one request each; returns what is still unwritten.
async function writeJobBatch<T extends { action: "create" | "update"; id: string; record: JsonRecord }>(
  context: CommandContext,
  batch: T[]
): Promise<{ rest: T[]; deleted: T[]; }> {
  const rest: T[] = [];
  const deleted: T[] = [];
  const creates = batch.filter((operation) => operation.action === "create");
  const updates = batch.filter((operation) => operation.action === "update");
  if (creates.length > 0) {
    try {
      // the API answers one job per job sent, in the same order
      const answer = await createJobAction(context, { jobs: creates.map((operation) => operation.record) });
      creates.forEach((operation, index) => {
        if (isDeletedJob(answer?.items?.[index])) deleted.push(operation);
      });
    } catch {
      rest.push(...creates);
    }
  }
  if (updates.length > 0) {
    try {
      await updateJobAction(context, { jobs: Object.fromEntries(updates.map((operation) => [operation.id, operation.record])) });
    } catch {
      rest.push(...updates);
    }
  }
  return { rest, deleted };
}

async function createRecord(context: CommandContext, resource: BulkResource, record: JsonRecord): Promise<unknown> {
  if (resource === "jobs") return createJobAction(context, record);
  if (resource === "places") return createPlaceAction(context, record);
  return createMemberAction(context, record);
}

async function updateRecord(context: CommandContext, resource: BulkResource, id: string, record: JsonRecord): Promise<unknown> {
  if (resource === "jobs") return updateJobAction(context, { ...record, id });
  if (resource === "places") return updatePlaceAction(context, id, record);
  return updateMemberAction(context, id, record);
}

function defaultUpsertKey(resource: BulkResource): string {
  if (resource === "jobs") return "externalId";
  if (resource === "places") return "name";
  return "username";
}

// CSV cells are text; the columns typed number or integer in the template are sent as numbers.
export function typeCsvNumbers(resource: BulkResource, records: JsonRecord[]): JsonRecord[] {
  const numeric = getBulkTemplate(resource).columns.filter((column) => column.type === "number" || column.type.startsWith("integer"));
  for (const record of records) {
    for (const column of numeric) {
      const parts = column.field.split(".");
      let holder: unknown = record;
      for (const part of parts.slice(0, -1)) {
        holder = isRecord(holder) ? holder[part] : undefined;
      }
      const key = parts[parts.length - 1]!;
      if (isRecord(holder) && typeof holder[key] === "string" && holder[key].trim() !== "" && Number.isFinite(Number(holder[key]))) {
        holder[key] = Number(holder[key]);
      }
    }
  }
  return records;
}

export async function runBulkAction(context: CommandContext, resource: BulkResource, mode: BulkMode, options: BulkRunOptions): Promise<BulkRunReport> {
  const read = await readBulkRecords(options.file, options.format);
  const records = inferFormat(options.file, options.format) === "csv" ? typeCsvNumbers(resource, read) : read;
  const upsertBy = options.upsertBy ?? (mode === "sync" ? defaultUpsertKey(resource) : undefined);
  const existing = upsertBy ? await existingByKey(context, resource, upsertBy) : new Map<string, JsonRecord>();
  const report: BulkRunReport = {
    resource,
    mode,
    dryRun: Boolean(options.dryRun),
    upsertBy,
    summary: { input: records.length, plannedCreate: 0, plannedUpdate: 0, created: 0, updated: 0, skipped: 0, failed: 0 },
    operations: [],
    skipped: [],
    errors: []
  };

  const planned: Array<{ index: number; action: "create" | "update"; id: string; record: JsonRecord }> = [];
  for (const [index, record] of records.entries()) {
    const keyValue = upsertBy ? record[upsertBy] : undefined;
    const existingRecord = keyValue === undefined || keyValue === null ? undefined : existing.get(String(keyValue).toLowerCase());
    const id = String(existingRecord?.id ?? "");
    const action = mode === "sync" && id ? "update" : "create";
    report.operations.push({ action, key: keyValue === undefined || keyValue === null ? undefined : String(keyValue), id: id || undefined, record });
    if (action === "update") report.summary.plannedUpdate += 1;
    else report.summary.plannedCreate += 1;
    planned.push({ index, action, id, record });
  }
  if (options.dryRun) {
    return report;
  }

  const skip = (operation: typeof planned[number]): void => {
    report.summary.skipped += 1;
    const keyValue = upsertBy ? operation.record[upsertBy] : undefined;
    report.skipped.push({ index: operation.index, key: keyValue === undefined || keyValue === null ? undefined : String(keyValue), id: operation.id || undefined, reason: "deleted" });
  };

  const runOne = async (operation: typeof planned[number]): Promise<boolean> => {
    try {
      if (operation.action === "update") {
        await updateRecord(context, resource, operation.id, operation.record);
        report.summary.updated += 1;
      } else {
        const answer = await createRecord(context, resource, operation.record) as { items?: unknown[] } | undefined;
        if (resource === "jobs" && isDeletedJob(answer?.items?.[0])) {
          skip(operation);
        } else {
          report.summary.created += 1;
        }
      }
      return true;
    } catch (error) {
      report.summary.failed += 1;
      report.errors.push({
        index: operation.index,
        code: "bulk_record_failed",
        message: error instanceof Error ? error.message : String(error),
        record: operation.record
      });
      return Boolean(options.continueOnError);
    }
  };

  // Only jobs can be written many at once; a batch the API refuses is written again one by one, to name the bad rows.
  const batchSize = resource === "jobs" ? Math.max(1, Number(options.batchSize ?? DEFAULT_JOB_BATCH_SIZE) || 1) : 1;
  for (let start = 0; start < planned.length; start += batchSize) {
    const batch = planned.slice(start, start + batchSize);
    const { rest, deleted } = batch.length > 1 ? await writeJobBatch(context, batch) : { rest: batch, deleted: [] };
    for (const operation of batch.filter((entry) => !rest.includes(entry))) {
      if (deleted.includes(operation)) skip(operation);
      else if (operation.action === "update") report.summary.updated += 1;
      else report.summary.created += 1;
    }
    for (const operation of rest) {
      if (!await runOne(operation)) {
        return report;
      }
    }
  }

  return report;
}
