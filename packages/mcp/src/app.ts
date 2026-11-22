import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { authorizationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/authorize.js";
import { clientRegistrationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/register.js";
import { metadataHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/metadata.js";
import { revocationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/revoke.js";
import { tokenHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/token.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import type { Config } from "./config.js";
import { HellotracksOAuthProvider, type ClientsStore, type Connection } from "./provider.js";
import { page, signInRouter } from "./signin.js";
import type { Store } from "./store.js";
import { createServer } from "./tools/index.js";

export const SCOPES = ["read", "write"];

export function authServerMetadata(config: Config) {
  const at = (path: string) => new URL(path, config.issuer).href;
  return {
    issuer: config.issuer.href,
    authorization_endpoint: at("/authorize"),
    token_endpoint: at("/token"),
    registration_endpoint: at("/register"),
    revocation_endpoint: at("/revoke"),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    scopes_supported: SCOPES,
    client_id_metadata_document_supported: true,
    service_documentation: config.docsUrl
  };
}

export function protectedResourceMetadata(config: Config) {
  return {
    resource: config.mcpUrl.href,
    authorization_servers: [config.issuer.href],
    scopes_supported: SCOPES,
    resource_name: "Hellotracks",
    resource_documentation: config.docsUrl
  };
}

export function createApp(config: Config, store: Store, clients?: ClientsStore): Express {
  const provider = new HellotracksOAuthProvider(config, store, clients);
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // The MCP endpoint is /mcp, and the bare origin works too, because people paste https://mcp.hellotracks.com. Each
  // address has its own resource metadata: clients check that the resource it names covers the address they use.
  const servesRoot = config.mcpUrl.pathname !== "/";
  const resourceMetadataPath = `/.well-known/oauth-protected-resource${config.mcpUrl.pathname}`;
  const rootMetadataPath = "/.well-known/oauth-protected-resource";
  app.use(resourceMetadataPath, metadataHandler(protectedResourceMetadata(config)));
  app.use(rootMetadataPath, metadataHandler({ ...protectedResourceMetadata(config), resource: new URL("/", config.issuer).href }));
  app.use("/.well-known/oauth-authorization-server", metadataHandler(authServerMetadata(config) as never));
  app.use("/authorize", authorizationHandler({ provider }));
  app.use("/token", tokenHandler({ provider }));
  app.use("/register", clientRegistrationHandler({ clientsStore: provider.clientsStore, clientSecretExpirySeconds: 0 }));
  app.use("/revoke", revocationHandler({ provider }));
  app.use(signInRouter(config, store, provider));

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  // OpenAI's app review proves we run this domain by reading its token here, as plain text.
  app.get("/.well-known/openai-apps-challenge", (_req, res) => {
    if (!config.openaiChallenge) {
      res.status(404).type("text/plain").send("Not found");
      return;
    }
    res.type("text/plain").send(config.openaiChallenge);
  });

  app.get("/", (req, res, next) => {
    // An MCP client asking for an event stream gets the endpoint's answer (405), not the page for people.
    if (servesRoot && String(req.headers.accept ?? "").includes("text/event-stream")) {
      next();
      return;
    }
    res.type("html").send(page("Hellotracks for AI apps", `
      <p class="lead">Connect Claude, ChatGPT or another AI app to Hellotracks to dispatch your field team in plain words:
      see who is where, create and assign jobs, and plan routes.</p>
      <p>Add this URL as a connector in your AI app:</p>
      <p><code>${config.mcpUrl.href}</code></p>
      <p class="muted small"><a href="${config.docsUrl}">How it works</a></p>`));
  });

  const originAllowed = (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (!origin || config.allowedOrigins.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      next();
      return;
    }
    res.status(403).json({ jsonrpc: "2.0", error: { code: -32000, message: "Origin not allowed" }, id: null });
  };

  const bearer = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: new URL(resourceMetadataPath, config.issuer).href
  });
  const rootBearer = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: new URL(rootMetadataPath, config.issuer).href
  });

  const handleMcp = async (req: Request, res: Response) => {
    const connection = req.auth?.extra?.connection as Connection | undefined;
    if (!connection) {
      res.status(401).end();
      return;
    }
    const server = createServer(connection, config);
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: (error as Error).message }, id: null });
      }
    }
  };
  const notAllowed = (_req: Request, res: Response) => {
    res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
  };

  app.post(config.mcpUrl.pathname, originAllowed, express.json({ limit: "1mb" }), bearer, handleMcp);
  app.all(config.mcpUrl.pathname, originAllowed, bearer, notAllowed);
  if (servesRoot) {
    app.post("/", originAllowed, express.json({ limit: "1mb" }), rootBearer, handleMcp);
    app.all("/", originAllowed, rootBearer, notAllowed);
  }

  return app;
}
