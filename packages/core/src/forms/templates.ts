// Form templates as the API stores them: the field types, a starter, and the checks to run before saving one.
// The CLI and the MCP server both use these.

type JsonRecord = Record<string, unknown>;

export const FORM_FIELD_TYPES = [
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

export const VALUE_FIELD_TYPES = new Set(["text", "paragraph", "checkbox", "number", "decimal", "radio", "dropdown", "file", "image", "signature"]);
export const VALID_FIELD_TYPES = new Set(FORM_FIELD_TYPES.map((entry) => entry.type));

export const FORM_TEMPLATE_EXAMPLE = {
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

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

export function contentArray(template: JsonRecord): JsonRecord[] {
  if (Array.isArray(template.content)) {
    return template.content.filter(isRecord);
  }
  if (isRecord(template.content) && Array.isArray(template.content.content)) {
    return template.content.content.filter(isRecord);
  }
  const formContent = record(template.formContent);
  return Array.isArray(formContent.content) ? formContent.content.filter(isRecord) : [];
}

export function formTitle(template: JsonRecord): string {
  return String(template.title ?? template.name ?? record(template.formContent).title ?? "");
}

export function formDescription(template: JsonRecord): string {
  return String(template.description ?? record(template.formContent).description ?? "");
}

export function normalizeTemplateInput(input: unknown): JsonRecord {
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

export function fieldName(item: JsonRecord): string {
  return String(item.name ?? item.id ?? "").trim();
}

export function fieldLabel(item: JsonRecord): string {
  return String(item.label ?? item.title ?? item.text ?? fieldName(item));
}

export function validateFormTemplate(input: unknown): { template: JsonRecord; warnings: string[]; fields: JsonRecord[] } {
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
