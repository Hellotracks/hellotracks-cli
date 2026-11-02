export type OutputMode = "pretty" | "table" | "json" | "yaml" | "csv" | "ndjson";

export interface GlobalOptions {
  profile?: string;
  apiUrl?: string;
  apiKey?: string;
  apiKeyStdin?: boolean;
  json?: boolean;
  output?: OutputMode;
  noInput?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  yes?: boolean;
  updateCheck?: boolean;
  fields?: string | undefined;
  sort?: string | undefined;
  requestId?: string | undefined;
  confirmProfile?: string | undefined;
  integrationSource?: string | undefined;
  clientUserAgent?: string | undefined;
}

export interface CommandContext {
  profile: string;
  profileExplicit?: boolean;
  apiUrl: string | undefined;
  apiKey: string | undefined;
  apiKeyStdin?: boolean;
  output: OutputMode;
  noInput: boolean;
  quiet: boolean;
  verbose: boolean;
  yes: boolean;
  updateCheck?: boolean;
  fields?: string | undefined;
  sort?: string | undefined;
  requestId?: string | undefined;
  confirmProfile?: string | undefined;
  integrationSource?: string | undefined;
  clientUserAgent?: string | undefined;
}

export interface ApiEnvelope<T> {
  data: T | null;
  error: {
    code: string;
    message: string;
  } | null;
  meta?: Record<string, unknown>;
}

export interface ProfileRecord {
  apiUrl?: string;
}

export interface ConfigFile {
  currentProfile: string;
  profiles: Record<string, ProfileRecord>;
}

export interface AuthWhoAmIResponse {
  account: Record<string, unknown>;
  company: Record<string, unknown>;
  apiKey?: {
    id: string;
    legacy: boolean;
  };
}

export interface ListResponse<T> {
  items: T[];
  totalCount?: number;
  hasMore?: boolean;
}
