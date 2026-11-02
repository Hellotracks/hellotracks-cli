import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { Command } from "commander";
import {
  attachFormLinkAction,
  createFormTemplateAction,
  deleteFormTemplateAction,
  detachFormLinkAction,
  generateReportAction,
  getFormSubmissionAction,
  getFormTemplateAction,
  getJobAction,
  getPlaceAction,
  listFormLinksAction,
  listFormSubmissionsAction,
  listFormTemplatesAction,
  listJobsAction,
  listMembersAction,
  listPlacesAction,
  submitFormSubmissionAction,
  updateFormTemplateAction,
  uploadFormAttachmentAction,
  type FormSubmissionFilters,
  reportFileUrl
} from "@hellotracks/ht-core/actions/index.js";
import { ApiError } from "@hellotracks/ht-core/client/api-client.js";
import { readStructuredFile, stringifyStructured } from "@hellotracks/ht-core/bulk/index.js";
import { confirmDangerous, contextFor, formatListTable, maybeWarn, outputData, runCommand } from "@hellotracks/ht-core/commands/support.js";
import type { CommandContext } from "@hellotracks/ht-core/types.js";
import { resolveDateWord } from "@hellotracks/ht-core/utils.js";

type JsonRecord = Record<string, unknown>;

const FORM_FIELD_TYPES = [
  { type: "form_title", value: "no", options: "no", description: "Title shown at the top of the form." },
  { type: "form_description", value: "no", options: "no", description: "Text shown under the form title." },
  { type: "section", value: "no", options: "no", description: "Visual section heading; minAnswers asks for at least that many answers in it." },
  { type: "label", value: "no", options: "no", description: "Static helper text." },
  { type: "text", value: "yes", options: "no", description: "Short text answer." },
  { type: "paragraph", value: "yes", options: "no", description: "Long text answer." },
  { type: "checkbox", value: "yes", options: "no", description: "Boolean yes/no answer." },
  { type: "number", value: "yes", options: "no", description: "Integer answer." },
  { type: "decimal", value: "yes", options: "no", description: "Decimal answer." },
  { type: "radio", value: "yes", options: "yes", description: "Single choice from options." },
  { type: "dropdown", value: "yes", options: "yes", description: "Single choice from options." },
  { type: "file", value: "yes", options: "upload", description: "Uploaded file value from attachments upload." },
  { type: "image", value: "yes", options: "upload", description: "Uploaded image value from attachments upload." },
  { type: "signature", value: "yes", options: "upload", description: "Uploaded signature value from attachments upload." }
];

const VALUE_FIELD_TYPES = new Set(["text", "paragraph", "checkbox", "number", "decimal", "radio", "dropdown", "file", "image", "signature"]);
const VALID_FIELD_TYPES = new Set(FORM_FIELD_TYPES.map((entry) => entry.type));

const FORM_TEMPLATE_EXAMPLE = {
  title: "Safety check",
  description: "Daily vehicle and site safety checklist.",
  content: [
    { type: "section", name: "Vehicle" },
    { type: "text", name: "vehicle_id", required: true },
    { type: "radio", name: "vehicle_condition", required: true, options: ["ok", "needs_service"] },
    { type: "paragraph", name: "notes" },
    { type: "signature", name: "customer_signature" }
  ]
};

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function contentArray(template: JsonRecord): JsonRecord[] {
  if (Array.isArray(template.content)) {
    return template.content.filter(isRecord);
  }
  if (isRecord(template.content) && Array.isArray(template.content.content)) {
    return template.content.content.filter(isRecord);
  }
  const formContent = record(template.formContent);
  return Array.isArray(formContent.content) ? formContent.content.filter(isRecord) : [];
}

function formTitle(template: JsonRecord): string {
  return String(template.title ?? template.name ?? record(template.formContent).title ?? "");
}

function formDescription(template: JsonRecord): string {
  return String(template.description ?? record(template.formContent).description ?? "");
}

function normalizeTemplateInput(input: unknown): JsonRecord {
  if (!isRecord(input)) {
    throw new Error("Form template must be a JSON/YAML object.");
  }
  const formContent = isRecord(input.formContent) ? input.formContent : isRecord(input.content) ? input.content : input;
  const content = Array.isArray(formContent.content) ? formContent.content : undefined;
  if (!content) {
    throw new Error("Form template must include a content array.");
  }
  return {
    id: typeof input.id === "string" ? input.id : undefined,
    title: String(input.title ?? formContent.title ?? "").trim(),
    description: String(input.description ?? formContent.description ?? ""),
    content
  };
}

function cleanObject(recordValue: JsonRecord): JsonRecord {
  return Object.fromEntries(Object.entries(recordValue).filter(([, value]) => value !== undefined && value !== ""));
}

function fieldName(item: JsonRecord): string {
  return String(item.name ?? item.id ?? "").trim();
}

function fieldLabel(item: JsonRecord): string {
  return String(item.label ?? item.title ?? item.text ?? fieldName(item));
}

function validateFormTemplate(input: unknown): { template: JsonRecord; warnings: string[]; fields: JsonRecord[] } {
  const template = normalizeTemplateInput(input);
  const warnings: string[] = [];
  if (!String(template.title ?? "").trim()) {
    throw new Error("Template title is required.");
  }
  const content = Array.isArray(template.content) ? template.content : [];
  if (content.length === 0) {
    throw new Error("Template content must include at least one field.");
  }
  const names = new Map<string, number>();
  const fields: JsonRecord[] = [];
  validateFormItems(content, names, fields, "");
  for (const [name, count] of names.entries()) {
    if (count > 1) {
      throw new Error(`Field name "${name}" is duplicated. Duplicate names make values-based submission ambiguous.`);
    }
  }
  if (!fields.some((item) => VALUE_FIELD_TYPES.has(String(item.type ?? "")))) {
    warnings.push("Template has no answer fields.");
  }
  return { template, warnings, fields };
}

function validateFormItems(content: unknown[], names: Map<string, number>, fields: JsonRecord[], prefix: string): void {
  for (const [index, raw] of content.entries()) {
    if (!isRecord(raw)) {
      throw new Error(`Field ${prefix}${index + 1} must be an object.`);
    }
    const type = String(raw.type ?? "").trim();
    if (!VALID_FIELD_TYPES.has(type)) {
      throw new Error(`Field ${prefix}${index + 1} has unsupported type "${type}".`);
    }
    const name = fieldName(raw);
    if (VALUE_FIELD_TYPES.has(type)) {
      if (!name) {
        throw new Error(`Field ${prefix}${index + 1} (${type}) requires a stable name.`);
      }
      const normalized = name.toLowerCase();
      names.set(normalized, (names.get(normalized) ?? 0) + 1);
    }
    if ((type === "radio" || type === "dropdown") && (!Array.isArray(raw.options) || raw.options.length === 0)) {
      throw new Error(`Field ${name || index + 1} (${type}) requires an options array.`);
    }
    if (raw.required !== undefined && typeof raw.required !== "boolean") {
      throw new Error(`Field ${name || index + 1} required must be true or false.`);
    }
    if (raw.conditionals !== undefined && !Array.isArray(raw.conditionals)) {
      throw new Error(`Field ${name || index + 1} conditionals must be an array.`);
    }
    if (Array.isArray(raw.conditionals)) {
      for (const [conditionalIndex, conditional] of raw.conditionals.entries()) {
        if (!isRecord(conditional) || !Array.isArray(conditional.content)) {
          throw new Error(`Field ${name || index + 1} conditional ${conditionalIndex + 1} must include a content array.`);
        }
        validateFormItems(conditional.content, names, fields, `${prefix}${index + 1}.`);
      }
    }
    fields.push(raw);
  }
}

async function readTemplateFile(file: string, format?: string): Promise<JsonRecord> {
  const parsed = await readStructuredFile(file, format);
  return validateFormTemplate(parsed).template;
}

function templateRows(items: JsonRecord[]): JsonRecord[] {
  return items.map((item) => {
    const fields = contentArray(item).filter((entry) => VALUE_FIELD_TYPES.has(String(entry.type ?? "")));
    const required = fields.filter((entry) => entry.required === true);
    return {
      id: item.id ?? item.templateId ?? "",
      title: formTitle(item),
      fields: fields.length,
      required: required.length,
      status: item.statusText ?? item.status ?? "active",
      updated: item.updatedAt ?? item.updatedTs ?? item.timestamp ?? ""
    };
  });
}

function fieldRows(template: JsonRecord): JsonRecord[] {
  return contentArray(template).map((item, index) => ({
    index: index + 1,
    type: item.type ?? "",
    name: fieldName(item),
    label: fieldLabel(item),
    required: item.required === true ? "yes" : "no",
    options: Array.isArray(item.options) ? item.options.join("|") : ""
  }));
}

function renderTemplate(template: JsonRecord): string {
  const fields = fieldRows(template);
  const lines = [
    "Form Template",
    `title: ${formTitle(template)}`,
    template.id || template.templateId ? `id: ${template.id ?? template.templateId}` : undefined,
    formDescription(template) ? `description: ${formDescription(template)}` : undefined,
    `fields: ${fields.length}`,
    "",
    "Fields",
    ...fields.map((field) =>
      `${field.index}. ${field.type} ${field.name ? String(field.name) : "(display)"}${field.required === "yes" ? " required" : ""}${field.options ? ` options=${field.options}` : ""}${field.label ? ` label="${field.label}"` : ""}`
    )
  ].filter(Boolean);
  return lines.join("\n");
}

function answersForSubmission(submission: JsonRecord): JsonRecord {
  return record(submission.answers);
}

function submissionMember(submission: JsonRecord): string {
  if (typeof submission.submittedBy === "string" && submission.submittedBy.trim()) {
    return submission.submittedBy;
  }
  const member = record(submission.submittedBy ?? submission.member);
  return String(member.name ?? member.username ?? member.email ?? member.id ?? submission.memberId ?? "");
}

function completionText(submission: JsonRecord): string {
  const completion = record(submission.completion);
  const answered = Number(completion.answered ?? completion.answeredCount ?? submission.answeredCount ?? Object.keys(answersForSubmission(submission)).length);
  const total = Number(completion.fields ?? completion.total ?? submission.fieldCount ?? "");
  return Number.isFinite(total) && total > 0 ? `${answered}/${total}` : String(answered);
}

function submissionRows(items: JsonRecord[]): JsonRecord[] {
  return items.map((item) => ({
    date: item.createdAt ?? item.timestamp ?? "",
    template: item.title ?? item.templateTitle ?? item.templateId ?? "",
    submittedBy: submissionMember(item),
    target: [item.jobId ? `job:${item.jobId}` : "", item.placeId ? `place:${item.placeId}` : ""].filter(Boolean).join(" "),
    completion: completionText(item),
    id: item.id ?? item.submissionId ?? ""
  }));
}

function renderSubmission(submission: JsonRecord): string {
  const answers = answersForSubmission(submission);
  const lines = [
    "Form Submission",
    `title: ${submission.title ?? submission.templateId ?? ""}`,
    `id: ${submission.id ?? submission.submissionId ?? ""}`,
    submission.createdAt ? `createdAt: ${submission.createdAt}` : undefined,
    submissionMember(submission) ? `submittedBy: ${submissionMember(submission)}` : undefined,
    submission.jobId ? `job: ${submission.jobId}` : undefined,
    submission.placeId ? `place: ${submission.placeId}` : undefined,
    "",
    "Answers",
    ...Object.entries(answers).map(([key, value]) => `${key}: ${Array.isArray(value) || isRecord(value) ? JSON.stringify(value) : String(value ?? "")}`)
  ].filter(Boolean);
  return lines.join("\n");
}

function exportSubmissionRows(items: JsonRecord[]): JsonRecord[] {
  return items.map((item) => ({
    id: item.id ?? item.submissionId ?? "",
    templateId: item.templateId ?? "",
    title: item.title ?? "",
    createdAt: item.createdAt ?? "",
    submittedBy: submissionMember(item),
    jobId: item.jobId ?? "",
    placeId: item.placeId ?? "",
    ...answersForSubmission(item)
  }));
}

function parseLimit(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("--limit must be a positive number.");
  }
  return parsed;
}

function matchesSelector(item: JsonRecord, selector: string, fields: string[]): boolean {
  const normalized = selector.toLowerCase();
  return fields.some((field) => String(item[field] ?? "").toLowerCase() === normalized);
}

async function resolveTemplateId(context: CommandContext, selector: string): Promise<string> {
  const data = await listFormTemplatesAction(context);
  const matches = data.items.filter((item) =>
    matchesSelector(item, selector, ["id", "templateId"]) || formTitle(item).toLowerCase() === selector.toLowerCase()
  );
  if (matches.length === 1) {
    return String(matches[0]?.id ?? matches[0]?.templateId);
  }
  if (matches.length > 1) {
    throw new Error(`Form template selector is ambiguous: ${selector}.`);
  }
  try {
    const dataById = await getFormTemplateAction(context, selector);
    return String(dataById.template.id ?? dataById.template.templateId ?? selector);
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) {
      throw new Error(`No form template matched ${selector}.`);
    }
    throw error;
  }
}

async function resolveMemberId(context: CommandContext, selector: string | undefined): Promise<string | undefined> {
  if (!selector) return undefined;
  const exact = await listMembersAction(context, { uids: selector });
  if (exact.items.length === 1) {
    return String(exact.items[0]?.id);
  }
  const data = await listMembersAction(context);
  const matches = data.items.filter((item) => matchesSelector(item, selector, ["id", "username", "email", "name"]));
  if (matches.length !== 1) {
    throw new Error(matches.length === 0 ? `No member matched ${selector}.` : `Member selector is ambiguous: ${selector}.`);
  }
  return String(matches[0]?.id);
}

async function resolvePlaceId(context: CommandContext, selector: string | undefined): Promise<string | undefined> {
  if (!selector) return undefined;
  const exact = await listPlacesAction(context, { uids: selector });
  if (exact.items.length === 1) {
    return String(exact.items[0]?.id);
  }
  const data = await listPlacesAction(context, { query: selector, max: 50 });
  const matches = data.items.filter((item) => matchesSelector(item, selector, ["id", "name", "address"]));
  if (matches.length === 1) {
    return String(matches[0]?.id);
  }
  if (data.items.length === 1) {
    return String(data.items[0]?.id);
  }
  throw new Error(data.items.length === 0 ? `No place matched ${selector}.` : `Place selector is ambiguous: ${selector}.`);
}

async function resolveJobId(context: CommandContext, selector: string | undefined): Promise<string | undefined> {
  if (!selector) return undefined;
  try {
    const job = await getJobAction(context, selector);
    if (job.id) return String(job.id);
  } catch (error) {
    if (!(error instanceof ApiError && error.statusCode === 404)) throw error;
  }
  const data = await listJobsAction(context, { id: selector, externalId: selector, text: selector, limit: 50 });
  const matches = data.items.filter((item) => matchesSelector(item, selector, ["id", "externalId", "title"]));
  if (matches.length === 1) {
    return String(matches[0]?.id);
  }
  if (data.items.length === 1) {
    return String(data.items[0]?.id);
  }
  throw new Error(data.items.length === 0 ? `No job matched ${selector}.` : `Job selector is ambiguous: ${selector}.`);
}

async function filtersForOptions(context: CommandContext, options: Record<string, string | undefined>): Promise<FormSubmissionFilters> {
  const templateId = options.template ? await resolveTemplateId(context, options.template) : undefined;
  return {
    from: resolveDateWord(options.from),
    until: resolveDateWord(options.until),
    templateId,
    memberId: await resolveMemberId(context, options.member),
    jobId: await resolveJobId(context, options.job),
    placeId: await resolvePlaceId(context, options.place),
    limit: parseLimit(options.limit),
    submissionIds: options.submissionIds
  };
}

async function readValuesFile(file: string, format?: string): Promise<JsonRecord> {
  const parsed = await readStructuredFile(file, format);
  if (!isRecord(parsed)) {
    throw new Error("Submission values must be a JSON/YAML object.");
  }
  return isRecord(parsed.values) ? parsed.values : parsed;
}

async function readContentFile(file: string, format?: string): Promise<JsonRecord[]> {
  const parsed = await readStructuredFile(file, format);
  if (Array.isArray(parsed) && parsed.every(isRecord)) {
    return parsed;
  }
  if (isRecord(parsed) && Array.isArray(parsed.content) && parsed.content.every(isRecord)) {
    return parsed.content;
  }
  throw new Error("Submission content must be a content array or an object with content.");
}

function submissionTemplate(template: JsonRecord): JsonRecord {
  const values = Object.fromEntries(contentArray(template)
    .filter((item) => VALUE_FIELD_TYPES.has(String(item.type ?? "")))
    .map((item) => [fieldName(item), ""])
    .filter(([name]) => name));
  return {
    templateId: template.id ?? template.templateId,
    title: formTitle(template),
    values
  };
}

function targetFromOptions(options: { job?: string; place?: string }): { type: "job" | "place"; selector: string } {
  if (options.job && options.place) {
    throw new Error("Use either --job or --place, not both.");
  }
  if (options.job) {
    return { type: "job", selector: options.job };
  }
  if (options.place) {
    return { type: "place", selector: options.place };
  }
  throw new Error("Provide --job or --place.");
}

async function resolveTarget(context: CommandContext, options: { job?: string; place?: string }): Promise<{ targetType: "job" | "place"; targetId: string }> {
  const target = targetFromOptions(options);
  const targetId = target.type === "job"
    ? await resolveJobId(context, target.selector)
    : await resolvePlaceId(context, target.selector);
  if (!targetId) {
    throw new Error(`Could not resolve ${target.type} ${target.selector}.`);
  }
  return { targetType: target.type, targetId };
}

function defaultReportFilename(format: string | undefined, filename: string | undefined): string {
  return filename?.replace(/[\/\\]/g, "-").trim() || `form-submissions.${format || "report"}`;
}

function contentTypeFor(file: string): string | undefined {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".csv") return "text/csv";
  if (ext === ".txt") return "text/plain";
  return undefined;
}

function addSubmissionFilterOptions(command: Command): Command {
  return command
    .option("--from <date>", "Start date: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--until <date>", "End date: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--template <template>", "Template id or exact title")
    .option("--member <selector>", "Member id, username, email, or exact name")
    .option("--job <selector>", "Job id, external id, or exact title")
    .option("--place <selector>", "Place id or exact name")
    .option("--limit <limit>", "Maximum submissions to list")
    .option("--submission-ids <ids>", "Comma-separated submission ids");
}

function addFileFormatOptions(command: Command): Command {
  return command
    .requiredOption("--file <path>", "JSON or YAML file")
    .option("--format <format>", "auto | json | yaml", "auto");
}

async function loadBuilderDraft(context: CommandContext, options: { from?: string; file?: string; format?: string }): Promise<{ draft: JsonRecord; sourceId?: string | undefined }> {
  if (options.file) {
    return { draft: await readTemplateFile(options.file, options.format) };
  }
  if (options.from) {
    const id = await resolveTemplateId(context, options.from);
    const data = await getFormTemplateAction(context, id);
    return { draft: normalizeTemplateInput(data.template), sourceId: id };
  }
  return { draft: structuredClone(FORM_TEMPLATE_EXAMPLE) as JsonRecord };
}

function previewDraft(draft: JsonRecord): string {
  return renderTemplate({ ...draft, id: draft.id ?? "(new)" });
}

async function saveBuilderDraft(command: Command, draft: JsonRecord, sourceId: string | undefined, options: { save?: boolean; output?: string; format?: string }): Promise<void> {
  const context = contextFor(command);
  validateFormTemplate(draft);
  if (options.output) {
    const format = options.format && options.format !== "auto" ? options.format : path.extname(options.output).toLowerCase().replace(/^\./, "") || "yaml";
    await fs.writeFile(path.resolve(process.cwd(), options.output), stringifyStructured(draft, format));
    outputData(command, { saved: path.resolve(process.cwd(), options.output), fields: contentArray(draft).length }, "pretty");
    return;
  }
  if (!options.save) {
    throw new Error("Builder save needs --output <path> or --save.");
  }
  await confirmDangerous(context, sourceId ? `Update form template ${sourceId}?` : `Create form template "${draft.title}"?`);
  const data = sourceId
    ? await updateFormTemplateAction(context, sourceId, draft)
    : await createFormTemplateAction(context, draft);
  outputData(command, data.template, "pretty");
}

async function runBuilder(command: Command, options: { from?: string; file?: string; format?: string; save?: boolean; output?: string }): Promise<void> {
  const context = contextFor(command);
  if (context.noInput) {
    throw new Error("ht forms builder is interactive. Re-run without --no-input, or use templates template/validate/create/update for file-based automation.");
  }
  const loaded = await loadBuilderDraft(context, options);
  const draft = loaded.draft;
  const content = contentArray(draft);
  draft.content = content;
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  process.stderr.write("Form builder. Type help, preview, validate, save, or quit.\n");
  try {
    while (true) {
      const line = (await rl.question("forms> ")).trim();
      const [commandName = "", ...parts] = line.split(/\s+/);
      if (!commandName) continue;
      if (commandName === "quit" || commandName === "exit") break;
      if (commandName === "help") {
        process.stderr.write("Commands: title <text>, description <text>, add <type> <name>, edit <index> <field> <value>, remove <index>, move <from> <to>, required <index> true|false, options <index> a|b|c, conditional <index> <equalsTo> <type> <name>, list, preview, validate, save, quit\n");
        continue;
      }
      if (commandName === "title") {
        draft.title = parts.join(" ");
        continue;
      }
      if (commandName === "description") {
        draft.description = parts.join(" ");
        continue;
      }
      if (commandName === "add") {
        const [type, name] = parts;
        if (!type || !VALID_FIELD_TYPES.has(type)) throw new Error(`Unsupported field type: ${type ?? ""}`);
        content.push(cleanObject({ type, name, label: name, required: false }));
        continue;
      }
      if (commandName === "edit") {
        const [indexText, field, ...valueParts] = parts;
        const item = content[Number(indexText) - 1];
        if (!item || !field) throw new Error("Use edit <index> <field> <value>.");
        item[field] = valueParts.join(" ");
        continue;
      }
      if (commandName === "remove") {
        const index = Number(parts[0]) - 1;
        if (!content[index]) throw new Error("Unknown field index.");
        content.splice(index, 1);
        continue;
      }
      if (commandName === "move") {
        const from = Number(parts[0]) - 1;
        const to = Number(parts[1]) - 1;
        const item = content[from];
        if (!item || to < 0 || to >= content.length) throw new Error("Use move <from> <to> with valid field numbers.");
        content.splice(from, 1);
        content.splice(to, 0, item);
        continue;
      }
      if (commandName === "required") {
        const item = content[Number(parts[0]) - 1];
        if (!item || !parts[1]) throw new Error("Use required <index> true|false.");
        item.required = ["true", "1", "yes", "on"].includes(parts[1].toLowerCase());
        continue;
      }
      if (commandName === "options") {
        const item = content[Number(parts[0]) - 1];
        if (!item || !parts[1]) throw new Error("Use options <index> a|b|c.");
        item.options = parts.slice(1).join(" ").split("|").map((entry) => entry.trim()).filter(Boolean);
        continue;
      }
      if (commandName === "conditional") {
        const item = content[Number(parts[0]) - 1];
        const [equalsTo, type, name] = parts.slice(1);
        if (!item || !equalsTo || !type || !name) throw new Error("Use conditional <index> <equalsTo> <type> <name>.");
        item.conditionals = [...(Array.isArray(item.conditionals) ? item.conditionals : []), { equalsTo, content: [{ type, name, required: false }] }];
        continue;
      }
      if (commandName === "list") {
        process.stderr.write(`${fieldRows(draft).map((row) => `${row.index}. ${row.type} ${row.name} ${row.required === "yes" ? "required" : ""}`).join("\n")}\n`);
        continue;
      }
      if (commandName === "preview") {
        process.stderr.write(`${previewDraft(draft)}\n`);
        continue;
      }
      if (commandName === "validate") {
        const result = validateFormTemplate(draft);
        process.stderr.write(`valid: true fields: ${result.fields.length}${result.warnings.length ? ` warnings: ${result.warnings.join("; ")}` : ""}\n`);
        continue;
      }
      if (commandName === "save") {
        await saveBuilderDraft(command, draft, loaded.sourceId, options);
        break;
      }
      throw new Error(`Unknown builder command: ${commandName}`);
    }
  } finally {
    rl.close();
  }
}

export function registerForms(program: Command): void {
  const forms = program.command("forms").description("Manage form templates, submissions, links, attachments, and form reports");

  forms.addHelpText("after", `

File workflow:
  ht forms templates template --format yaml > safety-check.yaml
  ht forms templates validate --file safety-check.yaml
  ht forms templates create --file safety-check.yaml
  ht forms submissions template <template-id> --format yaml > answers.yaml
  ht forms submissions submit <template-id> --values answers.yaml --member alice --job job-123

For official PDF/XLSX form submission reports, use:
  ht reports generate formsubmissions --form-template <template-id> --from 2026-05-01 --until 2026-05-28 --format xlsx --all-members

Convenience wrapper:
  ht forms report <template-id> --from 2026-05-01 --until 2026-05-28 --format csv --file submissions.csv
`);

  const templates = forms.command("templates").description("Manage form templates");

  const templateList = templates.command("list").description("List form templates");
  templateList.action(() => runCommand(async () => {
    const context = contextFor(templateList);
    const data = await listFormTemplatesAction(context);
    outputData(templateList, context.output === "json" || context.output === "yaml" ? data : templateRows(data.items), "table");
  }));

  const templateGet = templates.command("get")
    .argument("<template>", "Template id or exact title")
    .description("Show a readable field overview; use --json for canonical content");
  templateGet.action((selector) => runCommand(async () => {
    const context = contextFor(templateGet);
    const id = await resolveTemplateId(context, selector);
    const data = await getFormTemplateAction(context, id);
    if (context.output === "json" || context.output === "yaml") {
      outputData(templateGet, data.template, "pretty");
      return;
    }
    outputData(templateGet, renderTemplate(data.template), "pretty");
  }));

  const templateCreate = addFileFormatOptions(templates.command("create").description("Create a form template from a JSON/YAML file"));
  templateCreate.action((options) => runCommand(async () => {
    const template = await readTemplateFile(options.file, options.format);
    const data = await createFormTemplateAction(contextFor(templateCreate), template);
    outputData(templateCreate, data.template, "pretty");
  }));

  const templateUpdate = addFileFormatOptions(templates.command("update")
    .argument("<template>", "Template id or exact title")
    .description("Update a form template from a JSON/YAML file"));
  templateUpdate.action((selector, options) => runCommand(async () => {
    const context = contextFor(templateUpdate);
    const id = await resolveTemplateId(context, selector);
    const template = await readTemplateFile(options.file, options.format);
    const data = await updateFormTemplateAction(context, id, template);
    outputData(templateUpdate, data.template, "pretty");
  }));

  const templateDelete = templates.command("delete")
    .argument("<template>", "Template id or exact title")
    .description("Soft-delete a form template");
  templateDelete.action((selector) => runCommand(async () => {
    const context = contextFor(templateDelete);
    const id = await resolveTemplateId(context, selector);
    await confirmDangerous(context, `Delete form template ${id}?`);
    const data = await deleteFormTemplateAction(context, id);
    outputData(templateDelete, data, "pretty");
  }));

  const templateDuplicate = templates.command("duplicate")
    .argument("<template>", "Template id or exact title")
    .requiredOption("--title <title>", "Title for the duplicate")
    .description("Duplicate a form template with a new title");
  templateDuplicate.action((selector, options) => runCommand(async () => {
    const context = contextFor(templateDuplicate);
    const id = await resolveTemplateId(context, selector);
    const data = await getFormTemplateAction(context, id);
    const draft = normalizeTemplateInput(data.template);
    draft.title = options.title;
    delete draft.id;
    const created = await createFormTemplateAction(context, draft);
    outputData(templateDuplicate, created.template, "pretty");
  }));

  const templateValidate = addFileFormatOptions(templates.command("validate").description("Validate a form template file without saving it"));
  templateValidate.action((options) => runCommand(async () => {
    const parsed = await readStructuredFile(options.file, options.format);
    const result = validateFormTemplate(parsed);
    outputData(templateValidate, { valid: true, fields: result.fields.length, warnings: result.warnings }, "pretty");
  }));

  const templateFields = templates.command("fields")
    .argument("[template]", "Optional template id or exact title")
    .description("List supported field types or fields in a template");
  templateFields.action((selector) => runCommand(async () => {
    if (!selector) {
      outputData(templateFields, FORM_FIELD_TYPES, "table");
      return;
    }
    const context = contextFor(templateFields);
    const id = await resolveTemplateId(context, selector);
    const data = await getFormTemplateAction(context, id);
    outputData(templateFields, fieldRows(data.template), "table");
  }));

  const templateTemplate = templates.command("template")
    .description("Print a canonical JSON/YAML starter template")
    .option("--format <format>", "json | yaml", "yaml");
  templateTemplate.action((options) => runCommand(async () => {
    outputData(templateTemplate, stringifyStructured(FORM_TEMPLATE_EXAMPLE, options.format), "pretty");
  }));

  const submissions = forms.command("submissions").description("List, view, create, and export form submissions");

  const submissionList = addSubmissionFilterOptions(submissions.command("list").description("List form submissions"));
  submissionList.action((options) => runCommand(async () => {
    const context = contextFor(submissionList);
    const data = await listFormSubmissionsAction(context, await filtersForOptions(context, options));
    outputData(submissionList, context.output === "json" || context.output === "yaml" ? data : submissionRows(data.items), "table");
  }));

  const submissionGet = submissions.command("get")
    .argument("<submission-id>", "Submission id")
    .description("Show readable answers; use --json for raw form content");
  submissionGet.action((id) => runCommand(async () => {
    const context = contextFor(submissionGet);
    const data = await getFormSubmissionAction(context, id);
    if (context.output === "json" || context.output === "yaml") {
      outputData(submissionGet, data.submission, "pretty");
      return;
    }
    outputData(submissionGet, renderSubmission(data.submission), "pretty");
  }));

  const submissionSubmit = submissions.command("submit")
    .argument("<template>", "Template id or exact title")
    .description("Submit a form using --values or full --content")
    .option("--values <file>", "JSON/YAML object keyed by form field name")
    .option("--content <file>", "JSON/YAML filled FormContent content array")
    .option("--format <format>", "auto | json | yaml", "auto")
    .option("--member <selector>", "Member id, username, email, or exact name")
    .option("--job <selector>", "Job id, external id, or exact title")
    .option("--place <selector>", "Place id or exact name")
    .option("--lat <lat>", "Submission latitude")
    .option("--lng <lng>", "Submission longitude");
  submissionSubmit.action((selector, options) => runCommand(async () => {
    if (!options.values && !options.content) {
      throw new Error("Use --values <file> or --content <file>.");
    }
    if (options.values && options.content) {
      throw new Error("Use either --values or --content, not both.");
    }
    const context = contextFor(submissionSubmit);
    const templateId = await resolveTemplateId(context, selector);
    const body = cleanObject({
      templateId,
      memberId: await resolveMemberId(context, options.member),
      jobId: await resolveJobId(context, options.job),
      placeId: await resolvePlaceId(context, options.place),
      location: options.lat && options.lng ? { lat: Number.parseFloat(options.lat), lng: Number.parseFloat(options.lng) } : undefined,
      values: options.values ? await readValuesFile(options.values, options.format) : undefined,
      content: options.content ? { content: await readContentFile(options.content, options.format) } : undefined
    });
    maybeWarn(context, `Submitting form ${templateId}${body.jobId ? ` for job ${body.jobId}` : ""}${body.placeId ? ` for place ${body.placeId}` : ""}`);
    const data = await submitFormSubmissionAction(context, body);
    outputData(submissionSubmit, context.output === "json" || context.output === "yaml" ? data.submission : renderSubmission(data.submission), "pretty");
  }));

  const submissionExport = addSubmissionFilterOptions(submissions.command("export").description("Export submissions as CSV, JSON, YAML, or NDJSON rows"));
  submissionExport.action((options) => runCommand(async () => {
    const context = contextFor(submissionExport);
    const data = await listFormSubmissionsAction(context, await filtersForOptions(context, options));
    outputData(submissionExport, exportSubmissionRows(data.items), context.output === "pretty" || context.output === "table" ? "json" : "table");
  }));

  const submissionTemplateCommand = submissions.command("template")
    .argument("<template>", "Template id or exact title")
    .description("Print a values file starter for a template")
    .option("--format <format>", "json | yaml", "yaml");
  submissionTemplateCommand.action((selector, options) => runCommand(async () => {
    const context = contextFor(submissionTemplateCommand);
    const id = await resolveTemplateId(context, selector);
    const data = await getFormTemplateAction(context, id);
    outputData(submissionTemplateCommand, stringifyStructured(submissionTemplate(data.template), options.format), "pretty");
  }));

  const links = forms.command("links").description("Attach and detach form templates on jobs or places");

  const linkList = links.command("list")
    .description("List linked form templates for a job or place")
    .option("--job <selector>", "Job id, external id, or exact title")
    .option("--place <selector>", "Place id or exact name");
  linkList.action((options) => runCommand(async () => {
    const context = contextFor(linkList);
    const target = await resolveTarget(context, options);
    const data = await listFormLinksAction(context, target);
    outputData(linkList, context.output === "json" || context.output === "yaml" ? data : formatListTable(data.linkedForms, ["id", "title"]), "table");
  }));

  const linkAttach = links.command("attach")
    .argument("<template>", "Template id or exact title")
    .description("Attach a form template to a job or place")
    .option("--job <selector>", "Job id, external id, or exact title")
    .option("--place <selector>", "Place id or exact name");
  linkAttach.action((selector, options) => runCommand(async () => {
    const context = contextFor(linkAttach);
    const templateId = await resolveTemplateId(context, selector);
    const target = await resolveTarget(context, options);
    const data = await attachFormLinkAction(context, { ...target, templateId });
    outputData(linkAttach, context.output === "json" || context.output === "yaml" ? data : formatListTable(data.linkedForms, ["id", "title"]), "table");
  }));

  const linkDetach = links.command("detach")
    .argument("<template>", "Template id or exact title")
    .description("Detach a form template from a job or place")
    .option("--job <selector>", "Job id, external id, or exact title")
    .option("--place <selector>", "Place id or exact name");
  linkDetach.action((selector, options) => runCommand(async () => {
    const context = contextFor(linkDetach);
    const templateId = await resolveTemplateId(context, selector);
    const target = await resolveTarget(context, options);
    await confirmDangerous(context, `Detach form template ${templateId} from ${target.targetType} ${target.targetId}?`);
    const data = await detachFormLinkAction(context, { ...target, templateId });
    outputData(linkDetach, context.output === "json" || context.output === "yaml" ? data : formatListTable(data.linkedForms, ["id", "title"]), "table");
  }));

  const attachments = forms.command("attachments").description("Upload files for file, image, and signature form fields");
  const attachmentUpload = attachments.command("upload")
    .requiredOption("--file <path>", "File to upload")
    .option("--field <name>", "Field name this attachment is intended for")
    .option("--bucket-id <id>", "Storage bucket id")
    .option("--filename <name>", "Override stored filename")
    .description("Upload a form attachment and return the value to place in submission values");
  attachmentUpload.action((options) => runCommand(async () => {
    const filePath = path.resolve(process.cwd(), options.file);
    const body = await fs.readFile(filePath);
    const data = await uploadFormAttachmentAction(contextFor(attachmentUpload), {
      filename: options.filename ?? path.basename(filePath),
      body,
      contentType: contentTypeFor(filePath)
    }, {
      field: options.field,
      bucketId: options.bucketId,
      filename: options.filename
    });
    outputData(attachmentUpload, data, "pretty");
  }));

  const report = forms.command("report")
    .argument("<template>", "Template id or exact title")
    .description("Generate a form submissions report through ht reports")
    .requiredOption("--from <date>", "Start date: YYYY-MM-DD, today, yesterday, or tomorrow")
    .requiredOption("--until <date>", "End date: YYYY-MM-DD, today, yesterday, or tomorrow")
    .option("--format <format>", "csv | xlsx", "csv")
    .option("--member <selector>", "Only answers by this member id, username, email, or exact name; repeatable. Default: everyone", (value: string, previous: string[] = []) => [...previous, value], [])
    .option("--file <path>", "Output file path");
  report.action((selector, options) => runCommand(async () => {
    const context = contextFor(report);
    const templateId = await resolveTemplateId(context, selector);
    // The report needs at least one member, so no --member means everyone.
    const memberIds = options.member.length > 0
      ? await Promise.all((options.member as string[]).map(async (member) => String(await resolveMemberId(context, member))))
      : (await listMembersAction(context)).items.map((item) => String(item.id));
    const result = await generateReportAction(context, {
      type: "formsubmissions",
      formTemplateId: templateId,
      memberIds,
      from: resolveDateWord(options.from),
      until: resolveDateWord(options.until),
      format: options.format
    });
    const filePath = path.resolve(process.cwd(), options.file ?? defaultReportFilename(result.reportFormat ?? options.format, result.filename));
    await fs.writeFile(filePath, result.body);
    outputData(report, { file: filePath, bytes: result.body.length, reportId: result.reportId, link: result.reportLink ? await reportFileUrl(context, result.reportLink) : undefined, type: "formsubmissions", format: result.reportFormat ?? options.format }, "pretty");
  }));

  const builder = forms.command("builder")
    .description("Open a bounded line-oriented form draft editor")
    .option("--from <template>", "Start from an existing template id or exact title")
    .option("--file <path>", "Start from a local JSON/YAML template file")
    .option("--format <format>", "auto | json | yaml", "auto")
    .option("--save", "Create or update the template through the API when the builder save command is used")
    .option("--output <path>", "Write the draft to a local JSON/YAML file when the builder save command is used");
  builder.action((options) => runCommand(async () => {
    await runBuilder(builder, options);
  }));
}
