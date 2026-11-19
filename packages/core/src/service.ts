import type { CommandContext } from "./types.js";

export interface ServiceContextInput {
  apiUrl: string;
  /** Leave out for the sign-up and sign-in calls, which have no key yet. */
  apiKey?: string | undefined;
  /** Who is calling, e.g. "hellotracks-mcp/0.2"; the API counts usage by it. */
  userAgent: string;
  headers?: Record<string, string> | undefined;
  timeoutMs?: number | undefined;
}

// The context for a program that runs the actions for someone else, like the MCP server: it brings the key, so
// nothing is read from or written to this machine's profiles, keychain or environment, and nothing is printed.
export function serviceContext(input: ServiceContextInput): CommandContext {
  return {
    profile: "",
    apiUrl: input.apiUrl,
    apiKey: undefined,
    output: "json",
    noInput: true,
    quiet: true,
    verbose: false,
    yes: false,
    credentials: { apiUrl: input.apiUrl, apiKey: input.apiKey },
    clientUserAgent: input.userAgent,
    headers: input.headers,
    requestTimeoutMs: input.timeoutMs
  };
}
