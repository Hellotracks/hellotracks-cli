import { stringify as stringifyYaml } from "yaml";
import type { CommandContext, OutputMode } from "../types.js";

function widths(rows: string[][]): number[] {
  const result: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      result[index] = Math.max(result[index] ?? 0, cell.length);
    });
  }
  return result;
}

function renderTable(items: Array<Record<string, unknown>>): string {
  if (items.length === 0) {
    return "No results.";
  }
  const headers = Object.keys(items[0] ?? {});
  const rows = [
    headers,
    ...items.map((item) => headers.map((header) => formatScalar(item[header])))
  ];
  const columnWidths = widths(rows);
  return rows
    .map((row, rowIndex) =>
      row
        .map((cell, cellIndex) => cell.padEnd(columnWidths[cellIndex] ?? cell.length))
        .join("  ")
        .concat(rowIndex === 0 ? `\n${headers.map((_, i) => "-".repeat(columnWidths[i] ?? 1)).join("  ")}` : "")
    )
    .join("\n");
}

function selectedFields(context: CommandContext, items: Array<Record<string, unknown>>): string[] {
  const explicit = context.fields?.split(",").map((field) => field.trim()).filter(Boolean);
  if (explicit && explicit.length > 0) {
    return explicit;
  }
  return Object.keys(items[0] ?? {});
}

function prepareItems(context: CommandContext, value: unknown): unknown {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "object" && item !== null)) {
    return value;
  }
  const fields = selectedFields(context, value as Array<Record<string, unknown>>);
  const projected = (value as Array<Record<string, unknown>>).map((item) =>
    Object.fromEntries(fields.map((field) => [field, item[field]]))
  );
  const sortField = context.sort?.trim();
  if (!sortField) {
    return projected;
  }
  const descending = sortField.startsWith("-");
  const field = descending ? sortField.slice(1) : sortField;
  return [...projected].sort((left, right) => {
    const leftValue = formatScalar(left[field]);
    const rightValue = formatScalar(right[field]);
    return descending ? rightValue.localeCompare(leftValue) : leftValue.localeCompare(rightValue);
  });
}

function csvEscape(value: unknown): string {
  const text = formatScalar(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function renderCsv(items: Array<Record<string, unknown>>): string {
  if (items.length === 0) {
    return "";
  }
  const headers = Object.keys(items[0] ?? {});
  return [
    headers.map(csvEscape).join(","),
    ...items.map((item) => headers.map((header) => csvEscape(item[header])).join(","))
  ].join("\n");
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

export function outputMode(context: CommandContext, preferred: OutputMode = "pretty"): OutputMode {
  if (context.output === "json" || context.output === "yaml" || context.output === "csv" || context.output === "ndjson") {
    return context.output;
  }
  if (context.output === "table") {
    return "table";
  }
  return preferred;
}

export function render(context: CommandContext, value: unknown, preferred: OutputMode = "pretty"): void {
  const mode = outputMode(context, preferred);
  const prepared = prepareItems(context, value);
  if (mode === "json") {
    process.stdout.write(`${JSON.stringify(prepared, null, 2)}\n`);
    return;
  }
  if (mode === "yaml") {
    process.stdout.write(`${stringifyYaml(prepared)}\n`);
    return;
  }
  if (mode === "ndjson") {
    const lines = Array.isArray(prepared) ? prepared : [prepared];
    process.stdout.write(`${lines.map((item) => JSON.stringify(item)).join("\n")}${lines.length > 0 ? "\n" : ""}`);
    return;
  }
  if (mode === "csv") {
    const items = Array.isArray(prepared) ? prepared : [prepared];
    if (items.every((item) => typeof item === "object" && item !== null)) {
      process.stdout.write(`${renderCsv(items as Array<Record<string, unknown>>)}\n`);
      return;
    }
    process.stdout.write(`${items.map(csvEscape).join("\n")}\n`);
    return;
  }
  if (mode === "table" && Array.isArray(prepared) && prepared.every((item) => typeof item === "object" && item !== null)) {
    process.stdout.write(`${renderTable(prepared as Array<Record<string, unknown>>)}\n`);
    return;
  }
  if (mode === "table" && typeof prepared === "object" && prepared !== null) {
    process.stdout.write(`${renderTable([prepared as Record<string, unknown>])}\n`);
    return;
  }
  if (typeof prepared === "string") {
    process.stdout.write(`${prepared}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(prepared, null, 2)}\n`);
}
