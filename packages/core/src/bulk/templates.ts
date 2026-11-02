import type { BulkResource } from "./index.js";

export interface BulkColumn {
  field: string;
  type: string;
  requiredForCreate: boolean;
  upsertKey: boolean;
  description: string;
}

export interface BulkTemplate {
  resource: BulkResource;
  defaultUpsertBy: string;
  columns: BulkColumn[];
  sample: Record<string, string>;
}

const JOBS_COLUMNS: BulkColumn[] = [
  { field: "externalId", type: "string", requiredForCreate: false, upsertKey: true, description: "Stable external work-order id." },
  { field: "title", type: "string", requiredForCreate: true, upsertKey: false, description: "Job title shown to dispatch and workers." },
  { field: "address", type: "string", requiredForCreate: false, upsertKey: false, description: "Destination address." },
  { field: "assigneeUsername", type: "string", requiredForCreate: false, upsertKey: false, description: "Worker username; do not combine with assigneeId." },
  { field: "assigneeId", type: "string", requiredForCreate: false, upsertKey: false, description: "Worker id; do not combine with assigneeUsername." },
  { field: "date", type: "YYYY-MM-DD", requiredForCreate: false, upsertKey: false, description: "Scheduled date." },
  { field: "timeWindow.start", type: "HH:mm", requiredForCreate: false, upsertKey: false, description: "Start of the time window." },
  { field: "timeWindow.end", type: "HH:mm", requiredForCreate: false, upsertKey: false, description: "End of the time window." },
  { field: "onSiteDurationSeconds", type: "integer", requiredForCreate: false, upsertKey: false, description: "Expected on-site duration in seconds." },
  { field: "priority", type: "integer 0-10", requiredForCreate: false, upsertKey: false, description: "Priority value accepted by the public API." },
  { field: "placeId", type: "string", requiredForCreate: false, upsertKey: false, description: "Existing Hellotracks place id." },
  { field: "notes", type: "string", requiredForCreate: false, upsertKey: false, description: "Dispatcher notes." },
  { field: "contact.name", type: "string", requiredForCreate: false, upsertKey: false, description: "Customer contact name." },
  { field: "contact.phone", type: "string", requiredForCreate: false, upsertKey: false, description: "Customer contact phone." },
  { field: "contact.email", type: "string", requiredForCreate: false, upsertKey: false, description: "Customer contact email." },
  { field: "location.lat", type: "number", requiredForCreate: false, upsertKey: false, description: "Destination latitude." },
  { field: "location.lng", type: "number", requiredForCreate: false, upsertKey: false, description: "Destination longitude." }
];

const PLACES_COLUMNS: BulkColumn[] = [
  { field: "name", type: "string", requiredForCreate: true, upsertKey: true, description: "Place/customer/site name." },
  { field: "address", type: "string", requiredForCreate: false, upsertKey: false, description: "Street address." },
  { field: "email", type: "string", requiredForCreate: false, upsertKey: false, description: "Contact email." },
  { field: "phone", type: "string", requiredForCreate: false, upsertKey: false, description: "Contact phone." },
  { field: "city", type: "string", requiredForCreate: false, upsertKey: false, description: "City." },
  { field: "postalCode", type: "string", requiredForCreate: false, upsertKey: false, description: "Postal code." },
  { field: "state", type: "string", requiredForCreate: false, upsertKey: false, description: "State or region." },
  { field: "countryCode", type: "string", requiredForCreate: false, upsertKey: false, description: "ISO country code." },
  { field: "color", type: "string", requiredForCreate: false, upsertKey: false, description: "Display color." },
  { field: "radius", type: "integer", requiredForCreate: false, upsertKey: false, description: "Place radius in meters." },
  { field: "location.lat", type: "number", requiredForCreate: false, upsertKey: false, description: "Place latitude." },
  { field: "location.lng", type: "number", requiredForCreate: false, upsertKey: false, description: "Place longitude." },
  { field: "extendedData.customerId", type: "string", requiredForCreate: false, upsertKey: false, description: "Example custom field under extendedData." }
];

const MEMBERS_COLUMNS: BulkColumn[] = [
  { field: "username", type: "string", requiredForCreate: true, upsertKey: true, description: "Stable login/worker username." },
  { field: "name", type: "string", requiredForCreate: true, upsertKey: false, description: "Member display name." },
  { field: "email", type: "string", requiredForCreate: false, upsertKey: false, description: "Email address." },
  { field: "phone", type: "string", requiredForCreate: false, upsertKey: false, description: "Phone number." },
  { field: "role", type: "worker|operator|dispatcher|admin", requiredForCreate: false, upsertKey: false, description: "Hellotracks role." },
  { field: "color", type: "string", requiredForCreate: false, upsertKey: false, description: "Display color." },
  { field: "timezone", type: "string", requiredForCreate: false, upsertKey: false, description: "IANA timezone." },
  { field: "language", type: "string", requiredForCreate: false, upsertKey: false, description: "Language code." },
  { field: "unitDistance", type: "string", requiredForCreate: false, upsertKey: false, description: "Distance unit preference." },
  { field: "unitTime", type: "string", requiredForCreate: false, upsertKey: false, description: "Time unit preference." },
  { field: "unitDate", type: "string", requiredForCreate: false, upsertKey: false, description: "Date format preference." },
  { field: "statusLabel", type: "string", requiredForCreate: false, upsertKey: false, description: "Status label." },
  { field: "routeStartLat", type: "number", requiredForCreate: false, upsertKey: false, description: "Route start latitude." },
  { field: "routeStartLng", type: "number", requiredForCreate: false, upsertKey: false, description: "Route start longitude." },
  { field: "routeEndLat", type: "number", requiredForCreate: false, upsertKey: false, description: "Route end latitude." },
  { field: "routeEndLng", type: "number", requiredForCreate: false, upsertKey: false, description: "Route end longitude." },
  { field: "travelMode", type: "string", requiredForCreate: false, upsertKey: false, description: "Routing travel mode." },
  { field: "vehicleCapacity", type: "integer", requiredForCreate: false, upsertKey: false, description: "Vehicle capacity." },
  { field: "routeStartTime", type: "HH:mm", requiredForCreate: false, upsertKey: false, description: "Default route start time, or team to use the team's start time." }
];

const TEMPLATES: Record<BulkResource, BulkTemplate> = {
  jobs: {
    resource: "jobs",
    defaultUpsertBy: "externalId",
    columns: JOBS_COLUMNS,
    sample: {
      externalId: "WO-1001",
      title: "Repair AC unit",
      address: "123 Main St, Austin, TX",
      assigneeUsername: "alice",
      date: "2026-05-20",
      "timeWindow.start": "09:00",
      "timeWindow.end": "11:00",
      onSiteDurationSeconds: "1800",
      priority: "5",
      notes: "Bring ladder",
      "contact.name": "Jane Doe",
      "contact.phone": "+15551234567",
      "contact.email": "jane@example.com",
      "location.lat": "30.2672",
      "location.lng": "-97.7431"
    }
  },
  places: {
    resource: "places",
    defaultUpsertBy: "name",
    columns: PLACES_COLUMNS,
    sample: {
      name: "Austin Warehouse",
      address: "500 Industrial Blvd, Austin, TX",
      email: "ops@example.com",
      phone: "+15557654321",
      city: "Austin",
      postalCode: "78701",
      state: "TX",
      countryCode: "US",
      radius: "100",
      "location.lat": "30.2672",
      "location.lng": "-97.7431",
      "extendedData.customerId": "CUST-1001"
    }
  },
  members: {
    resource: "members",
    defaultUpsertBy: "username",
    columns: MEMBERS_COLUMNS,
    sample: {
      username: "alice",
      name: "Alice Rivera",
      email: "alice@example.com",
      phone: "+15550101010",
      role: "worker",
      timezone: "America/Chicago",
      language: "en",
      routeStartLat: "30.2672",
      routeStartLng: "-97.7431",
      routeEndLat: "30.2672",
      routeEndLng: "-97.7431",
      travelMode: "car",
      vehicleCapacity: "20",
      routeStartTime: "08:00"
    }
  }
};

function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function getBulkTemplate(resource: BulkResource): BulkTemplate {
  return TEMPLATES[resource];
}

export function bulkColumnRows(resource: BulkResource): Array<Record<string, unknown>> {
  const template = getBulkTemplate(resource);
  return template.columns.map((column) => ({
    field: column.field,
    type: column.type,
    required: column.requiredForCreate,
    upsertKey: column.upsertKey,
    description: column.description
  }));
}

export function renderBulkCsvTemplate(resource: BulkResource): string {
  const template = getBulkTemplate(resource);
  const headers = Object.keys(template.sample);
  return [
    headers.map(csvEscape).join(","),
    headers.map((header) => csvEscape(template.sample[header] ?? "")).join(",")
  ].join("\n");
}
