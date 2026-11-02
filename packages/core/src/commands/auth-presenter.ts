import type { AuthWhoAmIResponse, CommandContext } from "../types.js";

type JsonRecord = Record<string, unknown>;

function recordValue(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function scalar(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : "-";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function nested(record: JsonRecord | undefined, key: string): JsonRecord | undefined {
  return recordValue(record?.[key]);
}

function locationSummary(record: JsonRecord | undefined): string {
  const location = nested(record, "location");
  if (!location) {
    return "-";
  }
  const lat = typeof location.lat === "number" ? location.lat.toFixed(5) : scalar(location.lat);
  const lng = typeof location.lng === "number" ? location.lng.toFixed(5) : scalar(location.lng);
  return lat !== "-" && lng !== "-" ? `${lat}, ${lng}` : scalar(location);
}

function timezoneSummary(record: JsonRecord | undefined): string {
  const locale = nested(record, "locale");
  return scalar(locale?.timezone);
}

function settingsSummary(company: JsonRecord | undefined): string[] {
  const settings = nested(company, "settings");
  if (!settings) {
    return ["  settings: - [read-only]"];
  }
  return Object.entries(settings)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `  settings.${key}: ${scalar(value)}  [read-only]`);
}

export function renderAuthWhoamiOverview(whoami: AuthWhoAmIResponse, context: Pick<CommandContext, "profile" | "apiUrl" | "verbose">): string {
  const account = recordValue(whoami.account);
  const company = recordValue(whoami.company);
  const apiKey = recordValue(whoami.apiKey);
  const companyTeams = arrayValue(company?.teamsConfig);
  const accountTeams = arrayValue(account?.teams);
  const apiKeyLegacy = apiKey?.legacy;

  const lines = [
    "Authenticated",
    `  profile: ${scalar(context.profile)}  [local]`,
    `  apiUrl: ${scalar(context.apiUrl)}  [local]`,
    "",
    "Account",
    `  name: ${scalar(account?.name)}`,
    `  username: ${scalar(account?.username)}`,
    `  role/type: ${scalar(account?.role ?? account?.type)}`,
    `  timezone: ${timezoneSummary(account)}`,
    "",
    "Company",
    `  name: ${scalar(company?.name)}`,
    `  username: ${scalar(company?.username)}`,
    `  apiEnabled: ${scalar(nested(company, "settings")?.apiEnabled)}  [read-only]`,
    `  teamsConfig: ${companyTeams.length} ${companyTeams.length === 1 ? "team" : "teams"}  [read-only]`,
    "",
    "API Key",
    `  id: ${scalar(apiKey?.id)}  [read-only]`
  ];

  if (context.verbose || apiKeyLegacy === true) {
    lines.push(`  legacy: ${scalar(apiKeyLegacy)}  [read-only]`);
  }

  if (context.verbose) {
    lines.push(
      "",
      "Account Details [read-only]",
      `  id: ${scalar(account?.id)}  [read-only]`,
      `  email: ${scalar(account?.email)}  [read-only]`,
      `  phone: ${scalar(account?.phone)}  [read-only]`,
      `  location: ${locationSummary(account)}  [read-only]`,
      `  teams: ${accountTeams.length > 0 ? accountTeams.join(", ") : "-"}  [read-only]`,
      "",
      "Company Details [read-only]",
      `  id: ${scalar(company?.id)}  [read-only]`,
      `  email: ${scalar(company?.email)}  [read-only]`,
      `  phone: ${scalar(company?.phone)}  [read-only]`,
      `  address: ${scalar(company?.address)}  [read-only]`,
      `  location: ${locationSummary(company)}  [read-only]`,
      ...settingsSummary(company)
    );
  } else {
    lines.push("", "Use --verbose for read-only account/company details.");
    lines.push("Use --json or --output yaml for the raw API response.");
  }

  return lines.join("\n");
}
