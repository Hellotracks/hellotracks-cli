import { serviceContext } from "@hellotracks/ht-core/service.js";
import type { CommandContext } from "@hellotracks/ht-core/types.js";
import type { Config } from "./config.js";

/** The runtime counts calls with this user agent under the source "mcp". */
export const USER_AGENT = "hellotracks-mcp/0.2";

/** The core's actions, run with one connected person's key. */
export function personContext(config: Config, apiKey: string): CommandContext {
  return serviceContext({ apiUrl: config.apiUrl, apiKey, userAgent: USER_AGENT, timeoutMs: 60_000 });
}

/** Sign-up and sign-in calls carry the person's IP, so the runtime limits each person rather than this server. */
export function signInContext(config: Config, clientIp: string | undefined): CommandContext {
  const headers = config.serviceToken.length >= 32
    ? { "X-Hellotracks-Service-Token": config.serviceToken, "X-Hellotracks-Client-IP": clientIp ?? "" }
    : undefined;
  return serviceContext({ apiUrl: config.apiUrl, userAgent: USER_AGENT, headers, timeoutMs: 30_000 });
}
