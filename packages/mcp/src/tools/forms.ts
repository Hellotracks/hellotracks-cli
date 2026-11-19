// Forms: the templates workers fill in on their phones, the answers they send, and which jobs and places ask for them.
import {
  attachFormLinkAction,
  createFormTemplateAction,
  deleteFormTemplateAction,
  detachFormLinkAction,
  getFormSubmissionAction,
  getFormTemplateAction,
  listFormLinksAction,
  listFormSubmissionsAction,
  listFormTemplatesAction,
  updateFormTemplateAction
} from "@hellotracks/ht-core/actions/index.js";
import { FORM_FIELD_TYPES, FORM_TEMPLATE_EXAMPLE, VALUE_FIELD_TYPES, contentArray, fieldLabel, fieldName, formDescription, formTitle, validateFormTemplate } from "@hellotracks/ht-core/forms/templates.js";
import { z } from "zod";
import { DATE, clean, iso, pick, type Json, type Tools } from "./kit.js";

const FIELD = z.object({
  type: z.enum(FORM_FIELD_TYPES.map((entry) => entry.type) as [string, ...string[]]),
  name: z.string().optional().describe("Stable name; required for answer fields, unique in the form."),
  label: z.string().optional().describe("What the worker reads; default the name."),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional().describe("Choices, for radio and dropdown.")
}).passthrough();

const FIELD_TYPES_TEXT = FORM_FIELD_TYPES.map((entry) => `${entry.type} (${entry.description.replace(/\.$/, "")})`).join("; ");

const templateInput = {
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  fields: z.array(FIELD).min(1).max(200).describe(`The form's fields in order. Types: ${FIELD_TYPES_TEXT}.`)
};

const TARGET = { targetType: z.enum(["job", "place"]), targetId: z.string().describe("Job or place id.") };

export function registerFormTools(tools: Tools): void {
  tools.add("find_forms", {
    title: "Find forms",
    description: "The company's form templates (checklists, reports, sign-offs workers fill in on the phone). Give id for one form with all its fields, or a job or place to see which forms it asks for.",
    effect: "read",
    input: {
      id: z.string().optional().describe("One form template's id."),
      ...Object.fromEntries(Object.entries(TARGET).map(([key, value]) => [key, value.optional()]))
    }
  }, async (args, { context }) => {
    const { id, targetType, targetId } = args as { id?: string; targetType?: "job" | "place"; targetId?: string };
    if (id) {
      const { template } = await getFormTemplateAction(context, id);
      return {
        ...pick(template, ["id"]),
        title: formTitle(template),
        description: formDescription(template),
        fields: contentArray(template).map((item) => clean({ ...pick(item, ["type", "required", "options"]), name: fieldName(item), label: fieldLabel(item) }))
      };
    }
    if (targetType && targetId) {
      return listFormLinksAction(context, { targetType, targetId });
    }
    const { items } = await listFormTemplatesAction(context);
    return {
      forms: items.map((item) => clean({
        id: item.id ?? item.templateId,
        title: formTitle(item),
        answerFields: contentArray(item).filter((entry) => VALUE_FIELD_TYPES.has(String(entry.type ?? ""))).length,
        status: item.statusText ?? item.status
      }))
    };
  });

  tools.add("create_form", {
    title: "Create form",
    description: `Make a new form template that workers fill in on their phone, e.g. a safety checklist or a delivery sign-off. Then link it to jobs or places with link_form. Example: ${JSON.stringify({ title: FORM_TEMPLATE_EXAMPLE.title, fields: FORM_TEMPLATE_EXAMPLE.content.slice(0, 3) })}`,
    effect: "add",
    input: templateInput
  }, async ({ title, description, fields }, { context }) => {
    const { template, warnings } = validateFormTemplate({ title, description: description ?? "", content: fields });
    const created = await createFormTemplateAction(context, template);
    return clean({ id: created.template.id ?? created.template.templateId, title, warnings });
  });

  tools.add("update_form", {
    title: "Update form",
    description: "Replace a form template's title, description and fields. Read it with find_forms first and send the whole field list back with your changes.",
    effect: "change",
    input: { id: z.string().describe("Form template id."), ...templateInput }
  }, async ({ id, title, description, fields }, { context }) => {
    const { template, warnings } = validateFormTemplate({ title, description: description ?? "", content: fields });
    await updateFormTemplateAction(context, id, template);
    return clean({ id, title, warnings });
  });

  tools.add("delete_form", {
    title: "Delete form",
    description: "Delete a form template so workers no longer see it. Ask the person first.",
    effect: "remove",
    input: { id: z.string().describe("Form template id.") }
  }, async ({ id }, { context }) => pick(await deleteFormTemplateAction(context, id), ["id", "deleted"]));

  tools.add("link_form", {
    title: "Link form",
    description: "Ask for a form at a job or a place, so the worker fills it in there; or stop asking (unlink).",
    effect: "change",
    input: { formId: z.string().describe("Form template id."), ...TARGET, unlink: z.boolean().optional() }
  }, async ({ formId, targetType, targetId, unlink }, { context }) => {
    const target = { targetType, targetId, templateId: formId };
    return unlink ? detachFormLinkAction(context, target) : attachFormLinkAction(context, target);
  });

  tools.add("find_form_answers", {
    title: "Find form answers",
    description: "Filled-in forms: who sent which form when, for which job or place, where they were, and the answers. Filter by form, person, job, place or days. Give id for one in full. For a file (PDF, Excel) use run_report with form-answers.",
    effect: "read",
    input: {
      id: z.string().optional().describe("One submission's id."),
      formId: z.string().optional(),
      memberId: z.string().optional(),
      jobId: z.string().optional(),
      placeId: z.string().optional(),
      from: DATE.optional(),
      until: DATE.optional(),
      limit: z.number().int().min(1).max(200).optional().describe("Default 50.")
    }
  }, async ({ id, formId, memberId, jobId, placeId, from, until, limit }, { context, day }) => {
    if (id) {
      return answerRow((await getFormSubmissionAction(context, id)).submission);
    }
    const { items } = await listFormSubmissionsAction(context, {
      templateId: formId, memberId, jobId, placeId,
      from: from ? await day(from) : undefined,
      until: until ? await day(until) : undefined,
      limit: limit ?? 50
    });
    return { answers: items.map(answerRow) };
  });
}

function answerRow(submission: Json): Json {
  return clean({
    ...pick(submission, ["id", "templateId", "title", "submittedBy", "jobId", "placeId", "location"]),
    sentAt: iso(submission.createdAt ?? submission.createdTs),
    answers: submission.answers
  });
}
