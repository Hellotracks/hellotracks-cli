type JsonRecord = Record<string, unknown>;

interface WritableField {
  label: string;
  flag: string;
  value: (place: JsonRecord) => unknown;
}

const WRITABLE_FIELDS: WritableField[] = [
  { label: "name", flag: "--name", value: (place) => place.name },
  { label: "address", flag: "--address", value: (place) => place.address },
  { label: "email", flag: "--email", value: (place) => place.email },
  { label: "phone", flag: "--phone", value: (place) => place.phone },
  { label: "city", flag: "--city", value: (place) => place.city },
  { label: "postalCode", flag: "--postal-code", value: (place) => place.postalCode },
  { label: "state", flag: "--state", value: (place) => place.state },
  { label: "countryCode", flag: "--country-code", value: (place) => place.countryCode },
  { label: "color", flag: "--color", value: (place) => place.color },
  { label: "radius", flag: "--radius", value: (place) => place.radius },
  { label: "lat", flag: "--lat", value: (place) => recordValue(place.location)?.lat },
  { label: "lng", flag: "--lng", value: (place) => recordValue(place.location)?.lng },
  { label: "teams", flag: "--team", value: (place) => place.teams },
  { label: "extendedData", flag: "--extended-data-json", value: (place) => place.extendedData }
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

function locationSummary(place: JsonRecord): string {
  const location = recordValue(place.location);
  if (!location) {
    return "-";
  }
  const lat = typeof location.lat === "number" ? location.lat.toFixed(5) : undefined;
  const lng = typeof location.lng === "number" ? location.lng.toFixed(5) : undefined;
  return lat && lng ? `${lat}, ${lng}` : scalar(location);
}

export function renderPlaceOverview(place: JsonRecord, options: { verbose?: boolean } = {}): string {
  const lines = [
    "Place",
    `  name: ${scalar(place.name)}  (--name)`,
    `  address: ${scalar(place.address)}  (--address)`,
    `  location: ${locationSummary(place)}  (--lat, --lng)`,
    `  teams: ${scalar(place.teams)}  (--team)`,
    "",
    "Writable Fields",
    ...WRITABLE_FIELDS.map((field) => `  ${field.label}: ${scalar(field.value(place))}  (${field.flag})`)
  ];

  if (options.verbose) {
    lines.push(
      "",
      "Read-only Fields",
      `  id: ${scalar(place.id)}  [read-only]`,
      `  type: ${scalar(place.type)}  [read-only]`
    );
  } else {
    lines.push("", "Use --verbose to show read-only fields like id and type.");
    lines.push("Use --json or --output yaml for the raw API response.");
  }

  return lines.join("\n");
}
