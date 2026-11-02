type JsonRecord = Record<string, unknown>;

interface WritableField {
  key: string;
  flag: string;
}

const WRITABLE_SETTINGS: WritableField[] = [
  { key: "apiEnabled", flag: "--api-enabled" },
  { key: "workersCreateJobs", flag: "--workers-create-jobs" },
  { key: "workersEditJob", flag: "--workers-edit-job" },
  { key: "workersCreatePlaces", flag: "--workers-create-places" },
  { key: "workersViewPlaces", flag: "--workers-view-places" },
  { key: "workersOptimizeRoute", flag: "--workers-optimize-route" },
  { key: "workersViewJobCalendar", flag: "--workers-view-job-calendar" },
  { key: "assistantEnabled", flag: "--assistant-enabled" },
  { key: "tripsEnabled", flag: "--trips-enabled" },
  { key: "jobGroupsEnabled", flag: "--job-groups-enabled" },
  { key: "snoozeNotifications", flag: "--snooze-notifications" },
  { key: "routeCalcIncludeCompany", flag: "--route-calc-include-company" },
  { key: "etaPageDefaultShowWorkerName", flag: "--eta-page-default-show-worker-name" },
  { key: "etaPageDefaultShowMap", flag: "--eta-page-default-show-map" },
  { key: "workersEditTrips", flag: "--workers-edit-trips" },
  { key: "tripsRequireApproval", flag: "--trips-require-approval" },
  { key: "workersEditWorkingHours", flag: "--workers-edit-working-hours" },
  { key: "workersWebForms", flag: "--workers-web-forms" },
  { key: "workersAllowedTrackingOff", flag: "--workers-allowed-tracking-off" },
  { key: "autoCheckins", flag: "--auto-checkins" }
];

const READ_ONLY_FIELDS = [
  "id",
  "type",
  "username",
  "color",
  "city",
  "postalCode",
  "state",
  "countryCode"
];

const DAYS = [
  ["monday", "Mon"],
  ["tuesday", "Tue"],
  ["wednesday", "Wed"],
  ["thursday", "Thu"],
  ["friday", "Fri"],
  ["saturday", "Sat"],
  ["sunday", "Sun"]
] as const;

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
  return String(value);
}

function settingValue(company: JsonRecord, key: string): unknown {
  const settings = recordValue(company.settings);
  return settings && key in settings ? settings[key] : company[key];
}

function isHiddenCompactSetting(value: unknown): boolean {
  return value === false || value === undefined || value === null || value === "";
}

function renderWritableSettings(company: JsonRecord, options: { verbose?: boolean } = {}): string[] {
  const rows = WRITABLE_SETTINGS
    .map((field) => ({ ...field, value: settingValue(company, field.key) }))
    .filter((field) => options.verbose || !isHiddenCompactSetting(field.value));
  const hiddenCount = WRITABLE_SETTINGS.length - rows.length;
  const lines = [
    "Writable Settings",
    ...rows.map((field) => `  ${field.key}: ${scalar(field.value)}  (${field.flag})`)
  ];
  if (!options.verbose && hiddenCount > 0) {
    lines.push(`  disabled/unset settings: ${hiddenCount} hidden  (use --verbose for all flags)`);
  }
  return lines;
}

function teamItems(company: JsonRecord): JsonRecord[] {
  return Array.isArray(company.teamsConfig)
    ? company.teamsConfig.filter((item): item is JsonRecord => Boolean(recordValue(item)))
    : [];
}

function formatCoord(value: unknown): string | undefined {
  return typeof value === "number" ? value.toFixed(5) : undefined;
}

function routeStart(team: JsonRecord): string {
  const route = recordValue(team.route);
  if (!route) {
    return "-";
  }
  const lat = formatCoord(route.start_lat ?? route.startLat);
  const lng = formatCoord(route.start_lng ?? route.startLng);
  return lat && lng ? `${lat}, ${lng}` : "-";
}

function formatHour(value: unknown): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  if (value === 2400) {
    return "24:00";
  }
  const hour = Math.floor(value / 100);
  const minute = value % 100;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function dayWindow(day: unknown): string {
  const record = recordValue(day);
  if (!record) {
    return "-";
  }
  const start = record.start;
  const end = record.end;
  if (start === 0 && end === 0) {
    return "off";
  }
  if (start === 0 && end === 2400) {
    return "24h";
  }
  return `${formatHour(start)}-${formatHour(end)}`;
}

function summarizeWorkingHours(team: JsonRecord): string {
  const hours = recordValue(team.working_hours ?? team.workingHours);
  if (!hours) {
    return "-";
  }
  const values = DAYS.map(([key]) => dayWindow(hours[key]));
  if (values.every((value) => value === values[0])) {
    return `Mon-Sun ${values[0]}`;
  }
  const weekdays = values.slice(0, 5);
  const weekend = values.slice(5);
  if (weekdays.every((value) => value === weekdays[0]) && weekend.every((value) => value === weekend[0])) {
    return `Mon-Fri ${weekdays[0]}; Sat-Sun ${weekend[0]}`;
  }
  return DAYS.map(([, label], index) => `${label} ${values[index]}`).join("; ");
}

function renderRows(rows: string[][]): string[] {
  const widths = rows.reduce<number[]>((result, row) => {
    row.forEach((cell, index) => {
      result[index] = Math.max(result[index] ?? 0, cell.length);
    });
    return result;
  }, []);
  return rows.map((row) =>
    row.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join("  ").trimEnd()
  );
}

function renderTeamSummary(teams: JsonRecord[]): string[] {
  if (teams.length === 0) {
    return ["  teamsConfig: 0 teams [read-only]"];
  }
  const rows = [
    ["id", "name", "routeStart", "workingHours"],
    ...teams.map((team) => [
      scalar(team.id),
      scalar(team.name),
      routeStart(team),
      summarizeWorkingHours(team)
    ])
  ];
  return [
    `  teamsConfig: ${teams.length} teams [read-only]`,
    ...renderRows(rows).map((line) => `    ${line}`)
  ];
}

export function renderCompanyOverview(company: JsonRecord, options: { verbose?: boolean } = {}): string {
  const teams = teamItems(company);
  const lines = [
    "Company",
    `  name: ${scalar(company.name)}  (--name)`,
    `  address: ${scalar(company.address)}  (--address)`,
    `  phone: ${scalar(company.phone)}  (--phone)`,
    `  email: ${scalar(company.email)}  (--email)`,
    `  teamsConfig: ${teams.length} ${teams.length === 1 ? "team" : "teams"} [read-only]`,
    "",
    ...renderWritableSettings(company, options)
  ];

  if (options.verbose) {
    lines.push(
      "",
      "Read-only Fields",
      ...READ_ONLY_FIELDS.map((field) => `  ${field}: ${scalar(company[field])}  [read-only]`)
    );
    const location = recordValue(company.location);
    if (location) {
      const lat = formatCoord(location.lat);
      const lng = formatCoord(location.lng);
      lines.push(`  location: ${lat && lng ? `${lat}, ${lng}` : scalar(company.location)}  [read-only]`);
    }
    lines.push("", "Teams [read-only]", ...renderTeamSummary(teams));
  } else {
    lines.push("", "Use --verbose to show read-only fields and compact teamsConfig details.");
    lines.push("Use --json or --output yaml for the raw API response.");
  }

  return lines.join("\n");
}
