/** Settings, all from the environment. */
export interface Config {
  /** Public URL of the MCP endpoint, as users paste it, e.g. https://mcp.hellotracks.com/mcp. */
  mcpUrl: URL;
  /** Public origin of this server; also the OAuth issuer. */
  issuer: URL;
  /** The Hellotracks public API, e.g. https://api.hellotracks.com/v1. */
  apiUrl: string;
  port: number;
  dbPath: string;
  /** 32+ characters; encrypts the stored API keys. */
  secret: string;
  /** Browser origins allowed to call /mcp; requests without an Origin header are always allowed. */
  allowedOrigins: string[];
  docsUrl: string;
  /** Shared with the runtime (MCP_SERVICE_TOKEN), so it trusts the client IP we pass on for its sign-in limits. */
  serviceToken: string;
}

const DEFAULT_ORIGINS = [
  "https://claude.ai",
  "https://claude.com",
  "https://chatgpt.com",
  "https://chat.openai.com"
];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const issuer = new URL(env.MCP_PUBLIC_URL ?? "http://localhost:8790");
  const secret = env.MCP_SECRET ?? "";
  if (secret.length < 32) {
    throw new Error("MCP_SECRET must be set to at least 32 characters");
  }
  const extraOrigins = (env.MCP_ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
  return {
    issuer,
    mcpUrl: new URL("/mcp", issuer),
    apiUrl: (env.HELLOTRACKS_API_URL ?? "https://api.hellotracks.com/v1").replace(/\/$/, ""),
    port: Number(env.PORT ?? 8790),
    dbPath: env.MCP_DB_PATH ?? "mcp.db",
    secret,
    allowedOrigins: [...DEFAULT_ORIGINS, ...extraOrigins],
    docsUrl: env.MCP_DOCS_URL ?? "https://api-docs.hellotracks.com/mcp",
    serviceToken: env.MCP_SERVICE_TOKEN ?? ""
  };
}
