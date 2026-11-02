import { ApiClient, ApiError } from "../client/api-client.js";
import type { ApiDownloadResult, ApiUploadFile } from "../client/api-client.js";
import { clearProfile, persistProfile, resolveProfile } from "../config/store.js";
import type { CredentialStorage } from "../config/keychain.js";
import type { AuthWhoAmIResponse, CommandContext } from "../types.js";
import { toolName } from "../utils.js";

type JsonRecord = Record<string, unknown>;
export type WebhookReadConfig = { url?: string; hasHeaders?: boolean; headerNames?: string[]; };
export type WebhookWriteConfig = { url?: string; headers?: Record<string, string>; };
export interface ReportDescriptor {
  type: string;
  label: string;
  filename: string;
  canSelectMembers: boolean;
  canSelectPlaces: boolean;
  allowMultipleDates: boolean;
  allowMultipleAccounts: boolean;
  maxDays: number;
  defaultFormat: string;
  supportsRecurring: boolean;
  requiresFormTemplate: boolean;
  availableFormats: string[];
  columns: Array<{ key: string; label?: string }>;
  options: Array<{ key: string; type: string; defaultValue?: string; values?: Array<{ value: string; label: string }> }>;
}

export interface ReportDownloadResult extends ApiDownloadResult {
  reportId: string | undefined;
  reportLink: string | undefined;
  reportType: string | undefined;
  reportFormat: string | undefined;
}

export interface TimesheetListFilters {
  date?: string | undefined;
  from?: string | undefined;
  until?: string | undefined;
  memberId?: string | undefined;
}

export interface TimesheetListResponse {
  items: JsonRecord[];
  summary: {
    totalSeconds: number;
    entryCount: number;
    openEntryCount: number;
    memberCount: number;
  };
}

export interface FormSubmissionFilters {
  from?: string | undefined;
  until?: string | undefined;
  templateId?: string | undefined;
  memberId?: string | undefined;
  jobId?: string | undefined;
  placeId?: string | undefined;
  limit?: number | undefined;
  submissionIds?: string | undefined;
}

export interface FormLinksFilters {
  targetType: "job" | "place";
  targetId: string;
}

export interface AlertInstanceFilters {
  configId?: string | undefined;
  status?: string | undefined;
  from?: string | undefined;
  until?: string | undefined;
  limit?: number | undefined;
}

export interface MapRenderBody extends JsonRecord {
  kind?: string | undefined;
  layers?: Array<{ kind: string; title?: string | undefined; }> | undefined;
  title?: string | undefined;
  memberId?: string | undefined;
  placeIds?: string[] | undefined;
  date?: string | undefined;
  from?: string | undefined;
  until?: string | undefined;
  minutes?: number | undefined;
  profile?: string | undefined;
  skip?: number | undefined;
  max?: number | undefined;
  locations?: boolean | undefined;
  markers?: boolean | undefined;
  waypoints?: boolean | undefined;
  stops?: boolean | undefined;
  force?: boolean | undefined;
  inhouse?: boolean | undefined;
  jobs?: boolean | undefined;
  at?: string | undefined;
  expires?: string | undefined;
}

export interface EtaSessionCreateBody extends JsonRecord {
  jobId: string;
  recipientName?: string | undefined;
  recipientPhone?: string | undefined;
  recipientEmail?: string | undefined;
  title?: string | undefined;
  showWorkerName?: boolean | undefined;
  showMap?: boolean | undefined;
  expires?: string | undefined;
}

export interface EtaSessionUpdateBody extends JsonRecord {
  recipientName?: string | undefined;
  recipientPhone?: string | undefined;
  recipientEmail?: string | undefined;
  title?: string | undefined;
  showWorkerName?: boolean | undefined;
  showMap?: boolean | undefined;
  expires?: string | undefined;
}

export interface ActionEnvironment {
  context: CommandContext;
  profileName: string;
  apiUrl: string;
  apiKey: string | undefined;
  client: ApiClient | undefined;
}

interface ResolveOptions {
  requireAuth?: boolean;
}

async function resolveEnvironment(context: CommandContext, options: ResolveOptions = {}): Promise<ActionEnvironment> {
  const requireAuth = options.requireAuth ?? true;
  const profile = await resolveProfile(context);
  if (requireAuth && !profile.apiKey) {
    throw new Error(`No API key configured for profile "${profile.profileName}". Run "${toolName()} auth login" or set HELLOTRACKS_API_KEY_FILE.`);
  }
  return {
    context,
    profileName: profile.profileName,
    apiUrl: profile.apiUrl,
    apiKey: profile.apiKey,
    client: profile.apiKey ? new ApiClient(profile.apiUrl, profile.apiKey, context) : undefined
  };
}

function requireClient(environment: ActionEnvironment): ApiClient {
  if (!environment.client) {
    throw new Error(`No API key configured for profile "${environment.profileName}". Run "${toolName()} auth login" or set HELLOTRACKS_API_KEY_FILE.`);
  }
  return environment.client;
}

export async function resolveActionEnvironment(context: CommandContext, options: ResolveOptions = {}): Promise<ActionEnvironment> {
  return resolveEnvironment(context, options);
}

export async function loginAction(
  context: CommandContext,
  input: { apiUrl: string; apiKey: string; }
): Promise<{ profileName: string; apiUrl: string; whoami: AuthWhoAmIResponse; credentialStorage: CredentialStorage | "external"; }> {
  if (!input.apiKey) {
    throw new Error("API key is required.");
  }
  const environment = await resolveEnvironment(context, { requireAuth: false });
  const client = new ApiClient(input.apiUrl, input.apiKey, context);
  const whoami = await client.get<AuthWhoAmIResponse>("/auth/whoami");
  const credentialStorage = await persistProfile(environment.profileName, input.apiUrl, input.apiKey);
  return {
    profileName: environment.profileName,
    apiUrl: input.apiUrl,
    whoami,
    credentialStorage
  };
}

export interface EmailCodeSent {
  email: string;
  codeExpiresInSeconds: number;
}

export interface IssuedApiKey {
  apiKey: string;
  apiKeyExpiresAt: number;
  accountId: string;
  username: string;
  companyId: string;
  companyName: string;
}

export interface SignupCompanyInput {
  name: string;
  address?: string | undefined;
  location?: { lat: number; lng: number; } | undefined;
}

export interface StoredEmailCodeKey {
  issued: IssuedApiKey;
  profileName: string;
  apiUrl: string;
  credentialStorage: CredentialStorage | "external";
  whoami: AuthWhoAmIResponse;
}

async function anonymousClient(context: CommandContext): Promise<{ environment: ActionEnvironment; client: ApiClient; }> {
  const environment = await resolveEnvironment(context, { requireAuth: false });
  return { environment, client: new ApiClient(environment.apiUrl, "", context) };
}

// The key from an email code becomes the profile's key, as if it had been pasted into `auth login`.
async function storeIssuedKey(context: CommandContext, environment: ActionEnvironment, issued: IssuedApiKey): Promise<StoredEmailCodeKey> {
  const credentialStorage = await persistProfile(environment.profileName, environment.apiUrl, issued.apiKey);
  const whoami = await new ApiClient(environment.apiUrl, issued.apiKey, context).get<AuthWhoAmIResponse>("/auth/whoami");
  return { issued, profileName: environment.profileName, apiUrl: environment.apiUrl, credentialStorage, whoami };
}

export async function startSignupAction(
  context: CommandContext,
  input: { email: string; name: string; timezone?: string | undefined; language?: string | undefined; acceptTerms: boolean; }
): Promise<EmailCodeSent> {
  const { client } = await anonymousClient(context);
  return client.post<EmailCodeSent>("/signup", input);
}

export async function finishSignupAction(
  context: CommandContext,
  input: { email: string; code: string; company: SignupCompanyInput; keyLabel?: string | undefined; }
): Promise<StoredEmailCodeKey> {
  const { environment, client } = await anonymousClient(context);
  const issued = await client.post<IssuedApiKey>("/signup/verify", input);
  return storeIssuedKey(context, environment, issued);
}

export async function startEmailLoginAction(context: CommandContext, input: { email: string; }): Promise<EmailCodeSent> {
  const { client } = await anonymousClient(context);
  return client.post<EmailCodeSent>("/auth/email-code", input);
}

export async function finishEmailLoginAction(
  context: CommandContext,
  input: { email: string; code: string; keyLabel?: string | undefined; }
): Promise<StoredEmailCodeKey> {
  const { environment, client } = await anonymousClient(context);
  const issued = await client.post<IssuedApiKey>("/auth/email-code/verify", input);
  return storeIssuedKey(context, environment, issued);
}

export async function logoutAction(context: CommandContext): Promise<{ profileName: string; }> {
  const environment = await resolveEnvironment(context, { requireAuth: false });
  await clearProfile(environment.profileName);
  return { profileName: environment.profileName };
}

export async function whoamiAction(context: CommandContext): Promise<AuthWhoAmIResponse> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<AuthWhoAmIResponse>("/auth/whoami");
}

export async function validateAuthAction(context: CommandContext): Promise<AuthWhoAmIResponse> {
  return whoamiAction(context);
}

export async function showCompanyAction(context: CommandContext): Promise<JsonRecord> {
  const environment = await resolveEnvironment(context);
  const data = await requireClient(environment).get<{ company: JsonRecord }>("/company");
  return data.company;
}

export async function updateCompanyAction(context: CommandContext, body: JsonRecord): Promise<JsonRecord> {
  const environment = await resolveEnvironment(context);
  const data = await requireClient(environment).patch<{ company: JsonRecord }>("/company", body);
  return data.company;
}

export async function listMembersAction(
  context: CommandContext,
  filters?: { uids?: string | undefined; query?: string | undefined; max?: number | undefined; }
): Promise<{ items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ items: JsonRecord[] }>("/members", { uids: filters?.uids, query: filters?.query, max: filters?.max });
}

// The API answers an unknown id with an empty list, so turn that into the not-found error a client expects.
function firstItem(items: JsonRecord[], label: string, id: string): JsonRecord {
  const item = items[0];
  if (!item) {
    throw new ApiError(`${label} not found: ${id}`, "not_found", 404);
  }
  return item;
}

export async function getMemberAction(context: CommandContext, id: string): Promise<JsonRecord> {
  const environment = await resolveEnvironment(context);
  const data = await requireClient(environment).get<{ items: JsonRecord[] }>(`/members/${id}`);
  return firstItem(data.items, "Member", id);
}

// The API reads routeStartTime as a number like 800 for 08:00, and -1 for the team's start time.
export function routeStartTimeValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const text = value.trim().toLowerCase();
  if (text === "team" || text === "-1") {
    return -1;
  }
  const match = /^(\d{1,2}):?(\d{2})$/.exec(text);
  if (!match) {
    throw new Error(`Invalid routeStartTime: ${value}. Use HH:mm, for example 08:00, or team.`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    throw new Error(`Invalid routeStartTime: ${value}. Use HH:mm, for example 08:00, or team.`);
  }
  return hours * 100 + minutes;
}

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

// The API ignores working hours that miss a day, without an error, so check them before sending.
export function checkWorkingHours(value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return;
  }
  const days = value as Record<string, unknown>;
  if (Object.keys(days).every((key) => key === "source")) {
    return;
  }
  const missing = WEEKDAYS.filter((day) => {
    const hours = days[day];
    return typeof hours !== "object" || hours === null || !("start" in hours) || !("end" in hours);
  });
  if (missing.length > 0) {
    throw new Error(`workingHours needs start and end for all seven days; missing: ${missing.join(", ")}. Use {"start":0,"end":0} for a day off.`);
  }
}

function memberBody(body: JsonRecord): JsonRecord {
  checkWorkingHours(body.workingHours);
  return body.routeStartTime === undefined ? body : { ...body, routeStartTime: routeStartTimeValue(body.routeStartTime) };
}

const MEMBER_CREATE_FIELDS = new Set(["username", "name", "phone", "password", "role"]);

// Creating a member only saves username, name, phone, password and role, so the other fields follow as an update.
export async function createMemberAction(context: CommandContext, body: JsonRecord): Promise<JsonRecord> {
  const environment = await resolveEnvironment(context);
  const client = requireClient(environment);
  const fullBody = memberBody(body);
  const data = await client.post<{ member: JsonRecord }>("/members", fullBody);
  const rest = Object.fromEntries(Object.entries(fullBody).filter(([key, value]) => !MEMBER_CREATE_FIELDS.has(key) && value !== undefined));
  if (Object.keys(rest).length === 0 || !data.member?.id) {
    return data.member;
  }
  const updated = await client.patch<{ member: JsonRecord }>(`/members/${data.member.id}`, rest);
  return updated.member ?? data.member;
}

export async function updateMemberAction(context: CommandContext, id: string, body: JsonRecord): Promise<JsonRecord> {
  const environment = await resolveEnvironment(context);
  const data = await requireClient(environment).patch<{ member: JsonRecord }>(`/members/${id}`, memberBody(body));
  return data.member;
}

export async function deleteMemberAction(context: CommandContext, id: string): Promise<{ id: string; deleted: boolean; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).delete<{ id: string; deleted: boolean }>(`/members/${id}`);
}

export async function listApiKeysAction(context: CommandContext): Promise<{ items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ items: JsonRecord[] }>("/apikeys");
}

export async function createApiKeyAction(context: CommandContext, body: JsonRecord): Promise<{ plainTextKey: string; apiKey?: JsonRecord; items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).post<{ plainTextKey: string; apiKey?: JsonRecord; items: JsonRecord[] }>("/apikeys", body);
}

export async function revokeApiKeyAction(context: CommandContext, id: string): Promise<{ items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).post<{ items: JsonRecord[] }>(`/apikeys/${id}/revoke`, {});
}

export async function deleteApiKeyAction(context: CommandContext, id: string): Promise<{ items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).delete<{ items: JsonRecord[] }>(`/apikeys/${id}`);
}

export async function listWebhooksAction(
  context: CommandContext
): Promise<{ webhooks: Record<string, WebhookReadConfig>; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ webhooks: Record<string, WebhookReadConfig> }>("/webhooks");
}

export async function updateWebhooksAction(
  context: CommandContext,
  body: { webhooks: Record<string, WebhookWriteConfig>; }
): Promise<{ webhooks: Record<string, WebhookReadConfig>; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).put<{ webhooks: Record<string, WebhookReadConfig> }>("/webhooks", body);
}

export async function listPlacesAction(
  context: CommandContext,
  filters?: { query?: string | undefined; uids?: string | undefined; max?: number | undefined; }
): Promise<{ items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ items: JsonRecord[] }>("/places", filters);
}

export async function getPlaceAction(context: CommandContext, id: string): Promise<JsonRecord> {
  const environment = await resolveEnvironment(context);
  const data = await requireClient(environment).get<{ items: JsonRecord[] }>(`/places/${encodeURIComponent(id)}`);
  return firstItem(data.items, "Place", id);
}

export async function deletePlaceAction(context: CommandContext, id: string): Promise<{ id: string; deleted: boolean; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).delete<{ id: string; deleted: boolean }>(`/places/${encodeURIComponent(id)}`);
}

export async function createPlaceAction(context: CommandContext, body: JsonRecord): Promise<JsonRecord> {
  const environment = await resolveEnvironment(context);
  const data = await requireClient(environment).post<{ place: JsonRecord }>("/places", body);
  return data.place;
}

export async function updatePlaceAction(context: CommandContext, id: string, body: JsonRecord): Promise<JsonRecord> {
  const environment = await resolveEnvironment(context);
  const data = await requireClient(environment).patch<{ place: JsonRecord }>(`/places/${id}`, body);
  return data.place;
}

export async function listJobsAction(
  context: CommandContext,
  filters?: { id?: string | undefined; externalId?: string | undefined; date?: string | undefined; assigneeId?: string | undefined; assigneeUsername?: string | undefined; includeArchived?: boolean | undefined; allDates?: boolean | undefined; progress?: string | undefined; text?: string | undefined; updatedSince?: string | undefined; createdSince?: string | undefined; limit?: number | undefined; skip?: number | undefined; }
): Promise<{ items: JsonRecord[]; totalCount?: number; hasMore?: boolean; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ items: JsonRecord[]; totalCount?: number; hasMore?: boolean; }>("/jobs", filters);
}

const JOB_PAGE_SIZE = 500;

// Every job that matches, page by page, for exports and syncs that must not stop at the first page.
export async function listAllJobsAction(
  context: CommandContext,
  filters: Omit<NonNullable<Parameters<typeof listJobsAction>[1]>, "limit" | "skip"> = {}
): Promise<{ items: JsonRecord[]; totalCount?: number; }> {
  const items: JsonRecord[] = [];
  let totalCount: number | undefined;
  for (let skip = 0; ; skip += JOB_PAGE_SIZE) {
    const page = await listJobsAction(context, { ...filters, limit: JOB_PAGE_SIZE, skip });
    items.push(...page.items);
    totalCount = page.totalCount ?? totalCount;
    if (!page.hasMore || page.items.length === 0) {
      break;
    }
  }
  return totalCount === undefined ? { items } : { items, totalCount };
}

export async function getJobAction(context: CommandContext, id: string): Promise<JsonRecord> {
  const environment = await resolveEnvironment(context);
  const data = await requireClient(environment).get<{ items: JsonRecord[] }>(`/jobs/${encodeURIComponent(id)}`);
  return firstItem(data.items, "Job", id);
}

export async function createJobAction(context: CommandContext, body: JsonRecord): Promise<{ items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).post<{ items: JsonRecord[] }>("/jobs", body);
}

export async function updateJobAction(context: CommandContext, body: JsonRecord): Promise<{ items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).patch<{ items: JsonRecord[] }>("/jobs", body);
}

export async function archiveJobAction(context: CommandContext, id: string): Promise<{ items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).post<{ items: JsonRecord[] }>(`/jobs/${encodeURIComponent(id)}/archive`, {});
}

export async function restoreJobAction(context: CommandContext, id: string): Promise<{ items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).post<{ items: JsonRecord[] }>(`/jobs/${encodeURIComponent(id)}/restore`, {});
}

export async function deleteJobAction(context: CommandContext, id: string): Promise<{ items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).delete<{ items: JsonRecord[] }>(`/jobs/${encodeURIComponent(id)}`);
}

export async function optimizeRoutingAction(context: CommandContext, body: JsonRecord): Promise<JsonRecord> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).post<JsonRecord>("/routing/optimize", body);
}

export async function listEtaSessionsAction(context: CommandContext, filters?: { jobId?: string | undefined; date?: string | undefined; limit?: number | undefined; }): Promise<{ items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ items: JsonRecord[] }>("/eta/sessions", filters);
}

export async function createEtaSessionAction(context: CommandContext, body: EtaSessionCreateBody): Promise<{ session: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).post<{ session: JsonRecord }>("/eta/sessions", body);
}

export async function getEtaSessionAction(context: CommandContext, id: string): Promise<{ session: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ session: JsonRecord }>(`/eta/sessions/${encodeURIComponent(id)}`);
}

export async function updateEtaSessionAction(context: CommandContext, id: string, body: EtaSessionUpdateBody): Promise<{ session: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).patch<{ session: JsonRecord }>(`/eta/sessions/${encodeURIComponent(id)}`, body);
}

export async function revokeEtaSessionAction(context: CommandContext, id: string): Promise<{ id: string; token: string; revoked: boolean; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).delete<{ id: string; token: string; revoked: boolean }>(`/eta/sessions/${encodeURIComponent(id)}`);
}

export async function refreshEtaSessionAction(context: CommandContext, id: string): Promise<{ session: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).post<{ session: JsonRecord }>(`/eta/sessions/${encodeURIComponent(id)}/refresh`, {});
}

export async function listEtaSessionEventsAction(context: CommandContext, id: string, filters?: { limit?: number | undefined; }): Promise<{ items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ items: JsonRecord[] }>(`/eta/sessions/${encodeURIComponent(id)}/events`, filters);
}

export async function listZonesAction(context: CommandContext): Promise<{ items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ items: JsonRecord[] }>("/zones");
}

export async function listMapLayersAction(context: CommandContext): Promise<{ items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ items: JsonRecord[] }>("/maps/layers");
}

export async function renderMapAction(context: CommandContext, body: MapRenderBody): Promise<{ map: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).post<{ map: JsonRecord }>("/maps/render", body, { timeoutMs: 120_000 });
}

export async function createMapShareAction(context: CommandContext, body: MapRenderBody): Promise<{ share: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).post<{ share: JsonRecord }>("/maps/shares", body, { timeoutMs: 120_000 });
}

export async function listMapSharesAction(context: CommandContext, filters?: { limit?: number | undefined; }): Promise<{ items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ items: JsonRecord[] }>("/maps/shares", filters);
}

export async function getMapShareAction(context: CommandContext, id: string): Promise<{ share: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ share: JsonRecord }>(`/maps/shares/${encodeURIComponent(id)}`);
}

export async function revokeMapShareAction(context: CommandContext, id: string): Promise<{ id: string; revoked: boolean; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).delete<{ id: string; revoked: boolean }>(`/maps/shares/${encodeURIComponent(id)}`);
}

export async function listAlertActionsAction(context: CommandContext): Promise<{ items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ items: JsonRecord[] }>("/alerts/actions");
}

export async function listAlertConfigsAction(context: CommandContext, filters?: { status?: string | undefined; }): Promise<{ items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ items: JsonRecord[] }>("/alerts/configs", filters);
}

export async function getAlertConfigAction(context: CommandContext, id: string): Promise<{ config: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ config: JsonRecord }>(`/alerts/configs/${encodeURIComponent(id)}`);
}

export async function createAlertConfigAction(context: CommandContext, body: JsonRecord): Promise<{ config: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).post<{ config: JsonRecord }>("/alerts/configs", body);
}

export async function updateAlertConfigAction(context: CommandContext, id: string, body: JsonRecord): Promise<{ config: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).patch<{ config: JsonRecord }>(`/alerts/configs/${encodeURIComponent(id)}`, body);
}

export async function deleteAlertConfigAction(context: CommandContext, id: string): Promise<{ id: string; deleted: boolean; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).delete<{ id: string; deleted: boolean }>(`/alerts/configs/${encodeURIComponent(id)}`);
}

export async function listAlertInstancesAction(context: CommandContext, filters?: AlertInstanceFilters): Promise<{ items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ items: JsonRecord[] }>("/alerts/instances", filters as Record<string, string | number | boolean | undefined> | undefined);
}

export async function getAlertInstanceAction(context: CommandContext, id: string): Promise<{ instance: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ instance: JsonRecord }>(`/alerts/instances/${encodeURIComponent(id)}`);
}

export async function updateAlertInstanceAction(context: CommandContext, id: string, body: JsonRecord): Promise<{ instance: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).patch<{ instance: JsonRecord }>(`/alerts/instances/${encodeURIComponent(id)}`, body);
}

export async function deleteAlertInstanceAction(context: CommandContext, id: string): Promise<{ id: string; deleted: boolean; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).delete<{ id: string; deleted: boolean }>(`/alerts/instances/${encodeURIComponent(id)}`);
}

export async function listReportTypesAction(context: CommandContext): Promise<{ items: ReportDescriptor[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ items: ReportDescriptor[] }>("/reports/types");
}

export async function generateReportAction(context: CommandContext, body: JsonRecord): Promise<ReportDownloadResult> {
  const environment = await resolveEnvironment(context);
  const result = await requireClient(environment).download("POST", "/reports/generate", body, undefined, { timeoutMs: 120_000 });
  return {
    ...result,
    reportId: result.headers.get("x-ht-report-id") ?? undefined,
    reportLink: result.headers.get("x-ht-report-link") ?? undefined,
    reportType: result.headers.get("x-ht-report-type") ?? undefined,
    reportFormat: result.headers.get("x-ht-report-format") ?? undefined
  };
}

// A classic report made in the background: no request timeout, poll the job, then download its file.
export async function startReportJobAction(context: CommandContext, body: JsonRecord): Promise<{ job: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).post<{ job: JsonRecord }>("/reports/generate", { ...body, async: true });
}

export async function getReportJobAction(context: CommandContext, id: string): Promise<{ job: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ job: JsonRecord }>(`/reports/jobs/${encodeURIComponent(id)}`);
}

export async function listReportJobsAction(context: CommandContext): Promise<{ items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ items: JsonRecord[] }>("/reports/jobs");
}

// Report job links are relative to the API's host.
export async function reportFileUrl(context: CommandContext, link: string): Promise<string> {
  const environment = await resolveEnvironment(context, { requireAuth: false });
  return new URL(link, environment.apiUrl).toString();
}

export async function listReportUploadsAction(context: CommandContext): Promise<{ items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ items: JsonRecord[] }>("/reports/uploads");
}

export async function listRecurringReportsAction(context: CommandContext): Promise<{ items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ items: JsonRecord[] }>("/reports/recurring");
}

export async function createRecurringReportAction(context: CommandContext, body: JsonRecord): Promise<{ recurringReport: JsonRecord; items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).post<{ recurringReport: JsonRecord; items: JsonRecord[] }>("/reports/recurring", body);
}

export async function updateRecurringReportAction(context: CommandContext, id: string, body: JsonRecord): Promise<{ recurringReport: JsonRecord; items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).patch<{ recurringReport: JsonRecord; items: JsonRecord[] }>(`/reports/recurring/${encodeURIComponent(id)}`, body);
}

export async function deleteRecurringReportAction(context: CommandContext, id: string): Promise<{ id: string; deleted: boolean; items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).delete<{ id: string; deleted: boolean; items: JsonRecord[] }>(`/reports/recurring/${encodeURIComponent(id)}`);
}

// The new reports: catalog, preview, runs that make files in the background, and saved reports that can run on a schedule.

export async function listReportCatalogAction(context: CommandContext): Promise<{ reports: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ reports: JsonRecord[] }>("/reports/catalog");
}

export async function previewReportAction(context: CommandContext, request: JsonRecord): Promise<{ model: JsonRecord; html: string; columns: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).post<{ model: JsonRecord; html: string; columns: JsonRecord[] }>("/reports/preview", { request });
}

export async function startReportRunAction(context: CommandContext, request: JsonRecord, formats?: string[]): Promise<{ run: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).post<{ run: JsonRecord }>("/reports/run", formats && formats.length > 0 ? { request, formats } : { request });
}

export async function getReportRunAction(context: CommandContext, id: string): Promise<{ run: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ run: JsonRecord }>(`/reports/run/${encodeURIComponent(id)}`);
}

export async function listSavedReportsAction(context: CommandContext): Promise<{ saved: JsonRecord[]; classic: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ saved: JsonRecord[]; classic: JsonRecord[] }>("/reports/saved");
}

export async function createSavedReportAction(context: CommandContext, body: JsonRecord): Promise<{ saved: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).post<{ saved: JsonRecord }>("/reports/saved", body);
}

// The API replaces the whole saved report, so the body carries every field, not only the changed ones.
export async function replaceSavedReportAction(context: CommandContext, id: string, body: JsonRecord): Promise<{ saved: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).patch<{ saved: JsonRecord }>(`/reports/saved/${encodeURIComponent(id)}`, body);
}

export async function deleteSavedReportAction(context: CommandContext, id: string): Promise<{ removed: string; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).delete<{ removed: string }>(`/reports/saved/${encodeURIComponent(id)}`);
}

export async function sendSavedReportAction(context: CommandContext, id: string): Promise<{ run: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).post<{ run: JsonRecord }>(`/reports/saved/${encodeURIComponent(id)}/send`, {});
}

export async function listTimesheetsAction(context: CommandContext, filters?: TimesheetListFilters): Promise<TimesheetListResponse> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<TimesheetListResponse>("/timesheets", filters as Record<string, string | number | boolean | undefined> | undefined);
}

export async function createTimesheetEntryAction(context: CommandContext, body: JsonRecord): Promise<{ entry: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).post<{ entry: JsonRecord }>("/timesheets/entries", body);
}

export async function updateTimesheetEntryAction(context: CommandContext, id: string, body: JsonRecord): Promise<{ entry: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).patch<{ entry: JsonRecord }>(`/timesheets/entries/${encodeURIComponent(id)}`, body);
}

export async function deleteTimesheetEntryAction(context: CommandContext, id: string): Promise<{ id: string; deleted: boolean; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).delete<{ id: string; deleted: boolean }>(`/timesheets/entries/${encodeURIComponent(id)}`);
}

export async function listFormTemplatesAction(context: CommandContext): Promise<{ items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ items: JsonRecord[] }>("/forms/templates");
}

export async function getFormTemplateAction(context: CommandContext, id: string): Promise<{ template: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ template: JsonRecord }>(`/forms/templates/${encodeURIComponent(id)}`);
}

export async function createFormTemplateAction(context: CommandContext, body: JsonRecord): Promise<{ template: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).post<{ template: JsonRecord }>("/forms/templates", body);
}

export async function updateFormTemplateAction(context: CommandContext, id: string, body: JsonRecord): Promise<{ template: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).patch<{ template: JsonRecord }>(`/forms/templates/${encodeURIComponent(id)}`, body);
}

export async function deleteFormTemplateAction(context: CommandContext, id: string): Promise<{ id: string; deleted: boolean; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).delete<{ id: string; deleted: boolean }>(`/forms/templates/${encodeURIComponent(id)}`);
}

export async function listFormSubmissionsAction(context: CommandContext, filters?: FormSubmissionFilters): Promise<{ items: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ items: JsonRecord[] }>("/forms/submissions", filters as Record<string, string | number | boolean | undefined> | undefined);
}

export async function getFormSubmissionAction(context: CommandContext, id: string): Promise<{ submission: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ submission: JsonRecord }>(`/forms/submissions/${encodeURIComponent(id)}`);
}

export async function submitFormSubmissionAction(context: CommandContext, body: JsonRecord): Promise<{ submission: JsonRecord; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).post<{ submission: JsonRecord }>("/forms/submissions", body);
}

export async function uploadFormAttachmentAction(
  context: CommandContext,
  file: ApiUploadFile,
  fields?: { field?: string | undefined; bucketId?: string | undefined; filename?: string | undefined; }
): Promise<JsonRecord> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).upload<JsonRecord>("/forms/attachments", file, fields);
}

export async function listFormLinksAction(context: CommandContext, filters: FormLinksFilters): Promise<{ targetType: string; targetId: string; linkedForms: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).get<{ targetType: string; targetId: string; linkedForms: JsonRecord[] }>("/forms/links", {
    targetType: filters.targetType,
    targetId: filters.targetId
  });
}

export async function attachFormLinkAction(context: CommandContext, body: { targetType: "job" | "place"; targetId: string; templateId: string; }): Promise<{ targetType: string; targetId: string; linkedForms: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  return requireClient(environment).post<{ targetType: string; targetId: string; linkedForms: JsonRecord[] }>("/forms/links", body);
}

export async function detachFormLinkAction(context: CommandContext, filters: { targetType: "job" | "place"; targetId: string; templateId: string; }): Promise<{ targetType: string; targetId: string; linkedForms: JsonRecord[]; }> {
  const environment = await resolveEnvironment(context);
  const path = `/forms/links?targetType=${encodeURIComponent(filters.targetType)}&targetId=${encodeURIComponent(filters.targetId)}&templateId=${encodeURIComponent(filters.templateId)}`;
  return requireClient(environment).delete<{ targetType: string; targetId: string; linkedForms: JsonRecord[] }>(path);
}
