type JsonRecord = Record<string, unknown>;

interface WritableField {
  label: string;
  flag: string;
  value: (member: JsonRecord) => unknown;
}

const IDENTITY_FIELDS: WritableField[] = [
  { label: "username", flag: "--username", value: (member) => member.username },
  { label: "name", flag: "--name", value: (member) => member.name },
  { label: "email", flag: "--email", value: (member) => member.email },
  { label: "phone", flag: "--phone", value: (member) => member.phone },
  { label: "role", flag: "--role", value: (member) => member.role },
  { label: "color", flag: "--color", value: (member) => member.color },
  { label: "statusLabel", flag: "--status-label", value: (member) => member.statusLabel }
];

const LOCALE_FIELDS: WritableField[] = [
  { label: "timezone", flag: "--timezone", value: (member) => recordValue(member.locale)?.timezone ?? member.timezone },
  { label: "language", flag: "--language", value: (member) => recordValue(member.locale)?.language ?? member.language },
  { label: "unitDistance", flag: "--unit-distance", value: (member) => recordValue(member.units)?.distance ?? member.unitDistance },
  { label: "unitTime", flag: "--unit-time", value: (member) => recordValue(member.units)?.time ?? member.unitTime },
  { label: "unitDate", flag: "--unit-date", value: (member) => recordValue(member.units)?.date ?? member.unitDate }
];

const ROUTING_FIELDS: WritableField[] = [
  { label: "routeStartLat", flag: "--route-start-lat", value: (member) => member.routeStartLat },
  { label: "routeStartLng", flag: "--route-start-lng", value: (member) => member.routeStartLng },
  { label: "routeEndLat", flag: "--route-end-lat", value: (member) => member.routeEndLat },
  { label: "routeEndLng", flag: "--route-end-lng", value: (member) => member.routeEndLng },
  { label: "travelMode", flag: "--travel-mode", value: (member) => member.travelMode },
  { label: "vehicleCapacity", flag: "--vehicle-capacity", value: (member) => member.vehicleCapacity },
  { label: "routeStartTime", flag: "--route-start-time", value: (member) => member.routeStartTime },
  { label: "workingHours", flag: "--working-hours-json", value: (member) => member.workingHours },
  { label: "workingHoursOverrides", flag: "--working-hours-overrides-json", value: (member) => member.workingHoursOverrides }
];

const READ_ONLY_FIELDS = [
  "id",
  "type",
  "companyId",
  "activeStatus",
  "profileImageUrl"
];

function recordValue(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function scalar(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map((item) => scalar(item)).join(", ") : "-";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function formatCoord(value: unknown): string | undefined {
  return typeof value === "number" ? value.toFixed(5) : undefined;
}

function renderWritableFields(title: string, fields: WritableField[], member: JsonRecord): string[] {
  return [
    title,
    ...fields.map((field) => `  ${field.label}: ${scalar(field.value(member))}  (${field.flag})`)
  ];
}

function teamSummary(member: JsonRecord): string {
  const teams = Array.isArray(member.teams) ? member.teams : [];
  return teams.length > 0 ? teams.map((team) => scalar(team)).join(", ") : "-";
}

function locationSummary(member: JsonRecord): string {
  const location = recordValue(member.location);
  if (!location) {
    return "-";
  }
  const lat = formatCoord(location.lat);
  const lng = formatCoord(location.lng);
  return lat && lng ? `${lat}, ${lng}` : scalar(location);
}

export function renderMemberOverview(member: JsonRecord, options: { verbose?: boolean } = {}): string {
  const lines = [
    "Member",
    `  name: ${scalar(member.name)}  (--name)`,
    `  username: ${scalar(member.username)}  (--username)`,
    `  role: ${scalar(member.role)}  (--role)`,
    `  teams: ${teamSummary(member)}  (--team)`,
    "",
    ...renderWritableFields("Writable Identity", IDENTITY_FIELDS, member),
    "",
    ...renderWritableFields("Writable Locale & Units", LOCALE_FIELDS, member),
    "",
    ...renderWritableFields("Writable Routing Defaults", ROUTING_FIELDS, member)
  ];

  if (options.verbose) {
    lines.push(
      "",
      "Read-only Fields",
      ...READ_ONLY_FIELDS.map((field) => `  ${field}: ${scalar(member[field])}  [read-only]`),
      `  location: ${locationSummary(member)}  [read-only]`,
      `  states: ${scalar(member.states)}  [read-only]`,
      `  timestamps: ${scalar(member.timestamps)}  [read-only]`
    );
  } else {
    lines.push("", "Use --verbose to show read-only fields like id, activeStatus, location, states, and timestamps.");
    lines.push("Use --json or --output yaml for the raw API response.");
  }

  return lines.join("\n");
}
