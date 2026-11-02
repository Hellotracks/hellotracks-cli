export type PublicJson = string | number | boolean | null | PublicJson[] | { [key: string]: PublicJson };
export type PublicJsonRecord = Record<string, PublicJson | undefined>;

export interface PublicListResponse<T extends PublicJsonRecord = PublicJsonRecord> {
  items: T[];
  totalCount?: number;
  hasMore?: boolean;
}

export interface PublicAuthWhoAmIResponse {
  account: PublicJsonRecord;
  company: PublicJsonRecord;
  apiKey?: {
    id: string;
    legacy: boolean;
  };
}

export type PublicCompanyMutation = Partial<Record<
  "name" |
  "apiEnabled" |
  "workersCreateJobs" |
  "workersEditJob" |
  "workersCreatePlaces" |
  "workersViewPlaces" |
  "workersOptimizeRoute" |
  "workersViewJobCalendar" |
  "assistantEnabled" |
  "tripsEnabled" |
  "jobGroupsEnabled" |
  "snoozeNotifications" |
  "routeCalcIncludeCompany",
  PublicJson
>>;

export type PublicMemberMutation = Partial<Record<
  "username" |
  "name" |
  "email" |
  "phone" |
  "password" |
  "role" |
  "color" |
  "language" |
  "timezone" |
  "unitDistance" |
  "unitTime" |
  "unitDate" |
  "statusLabel" |
  "routeStartLat" |
  "routeStartLng" |
  "routeEndLat" |
  "routeEndLng" |
  "travelMode" |
  "vehicleCapacity" |
  "routeStartTime" |
  "teams" |
  "workingHours" |
  "workingHoursOverrides",
  PublicJson
>>;

export type PublicPlaceMutation = Partial<Record<
  "name" |
  "address" |
  "email" |
  "phone" |
  "city" |
  "postalCode" |
  "state" |
  "countryCode" |
  "color" |
  "teams" |
  "radius" |
  "location" |
  "extendedData",
  PublicJson
>>;

export type PublicJobMutation = Partial<Record<
  "id" |
  "title" |
  "externalId" |
  "address" |
  "location" |
  "placeId" |
  "assigneeId" |
  "assigneeUsername" |
  "date" |
  "timeWindow" |
  "onSiteDurationSeconds" |
  "priority" |
  "notes" |
  "contact" |
  "customFields",
  PublicJson
>>;

export interface PublicApiKeyCreateRequest {
  expiresAt?: number;
  label?: string;
  source?: string;
}

export interface PublicRoutingOptimizeRequest extends PublicJsonRecord {
  accountId?: string;
  account?: string;
  date?: string;
  solve?: boolean;
  index?: number;
  count?: number;
  constraints?: Record<string, PublicJson>;
}
