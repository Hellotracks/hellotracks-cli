import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidGrantError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Config } from "./config.js";
import { decrypt, randomToken, sha256 } from "./crypto.js";
import { revokeApiKeyAction } from "@hellotracks/ht-core/actions/index.js";
import { personContext } from "./api.js";
import type { Grant, Store } from "./store.js";

export const ACCESS_TOKEN_TTL_MS = 60 * 60_000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;
export const CODE_TTL_MS = 5 * 60_000;
const CIMD_CACHE_MS = 60 * 60_000;

/** What a verified access token carries to the tools. */
export interface Connection {
  grant: Grant;
  apiKey: string;
}

/**
 * Clients register themselves (RFC 7591), or name a Client ID Metadata Document by URL, which we fetch.
 */
export class ClientsStore implements OAuthRegisteredClientsStore {
  constructor(
    private readonly store: Store,
    private readonly fetchDocument: (url: URL) => Promise<unknown> = fetchClientMetadataDocument
  ) {}

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const saved = this.store.getClient(clientId);
    const isDocument = clientId.startsWith("https://");
    if (saved && (!isDocument || Date.now() - saved.createdAt < CIMD_CACHE_MS)) {
      return JSON.parse(saved.json) as OAuthClientInformationFull;
    }
    if (!isDocument) {
      return undefined;
    }
    let document: unknown;
    try {
      document = await this.fetchDocument(new URL(clientId));
    } catch {
      return undefined;
    }
    const client = clientFromDocument(clientId, document);
    if (client) {
      this.store.putClient(clientId, JSON.stringify(client));
    }
    return client;
  }

  registerClient(client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">): OAuthClientInformationFull {
    const full: OAuthClientInformationFull = {
      ...client,
      client_id: `htc_${randomToken(18)}`,
      client_id_issued_at: Math.floor(Date.now() / 1000)
    };
    this.store.putClient(full.client_id, JSON.stringify(full));
    return full;
  }
}

/** A metadata document must name itself as client_id and list its redirect URIs. */
export function clientFromDocument(clientId: string, document: unknown): OAuthClientInformationFull | undefined {
  if (!document || typeof document !== "object") {
    return undefined;
  }
  const record = document as Record<string, unknown>;
  const redirectUris = Array.isArray(record.redirect_uris) ? record.redirect_uris.filter((uri) => typeof uri === "string") : [];
  if (record.client_id !== clientId || redirectUris.length === 0) {
    return undefined;
  }
  return {
    client_id: clientId,
    redirect_uris: redirectUris as string[],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    ...(typeof record.client_name === "string" ? { client_name: record.client_name.slice(0, 100) } : {}),
    ...(typeof record.client_uri === "string" ? { client_uri: record.client_uri } : {}),
    ...(typeof record.logo_uri === "string" ? { logo_uri: record.logo_uri } : {})
  };
}

/** Fetches a public HTTPS JSON document of at most 64 KB, never from a private address. */
export async function fetchClientMetadataDocument(url: URL): Promise<unknown> {
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("client metadata must be served over https without credentials");
  }
  const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("client metadata host resolves to a private address");
  }
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5_000), headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`client metadata answered ${response.status}`);
  }
  const text = await response.text();
  if (text.length > 64_000) {
    throw new Error("client metadata is too large");
  }
  return JSON.parse(text);
}

export function isPrivateAddress(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80")) {
    return true;
  }
  const v4 = lower.startsWith("::ffff:") ? lower.slice(7) : lower;
  const parts = v4.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export class HellotracksOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: ClientsStore;

  constructor(private readonly config: Config, private readonly store: Store, clientsStore?: ClientsStore) {
    this.clientsStore = clientsStore ?? new ClientsStore(store);
  }

  /** Sends the person to our sign-in pages, which finish with completeSignIn. */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const id = randomToken(18);
    this.store.putPending({
      id,
      clientId: client.client_id,
      params: JSON.stringify({ ...params, resource: params.resource?.href }),
      csrf: randomToken(18),
      email: "",
      createdAt: Date.now()
    });
    res.redirect(302, `/signin?s=${encodeURIComponent(id)}`);
  }

  /** Stores the connection and returns where to send the browser: back to the client with a code. */
  completeSignIn(pendingId: string, grant: Omit<Grant, "id" | "clientId" | "createdAt">): string {
    const pending = this.store.getPending(pendingId);
    if (!pending) {
      throw new Error("This sign-in has expired. Start connecting again from your AI app.");
    }
    const params = JSON.parse(pending.params) as { state?: string; codeChallenge: string; redirectUri: string; resource?: string };
    const grantId = randomToken(18);
    this.store.putGrant({ ...grant, id: grantId, clientId: pending.clientId, createdAt: Date.now() });
    const code = randomToken(32);
    this.store.putCode(sha256(code), {
      grantId,
      clientId: pending.clientId,
      challenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      resource: params.resource ?? "",
      expiresAt: Date.now() + CODE_TTL_MS
    });
    this.store.deletePending(pendingId);
    const target = new URL(params.redirectUri);
    target.searchParams.set("code", code);
    if (params.state !== undefined) {
      target.searchParams.set("state", params.state);
    }
    return target.href;
  }

  /** Where the browser goes when the person says no. */
  denySignIn(pendingId: string): string | undefined {
    const pending = this.store.getPending(pendingId);
    if (!pending) {
      return undefined;
    }
    this.store.deletePending(pendingId);
    const params = JSON.parse(pending.params) as { state?: string; redirectUri: string };
    const target = new URL(params.redirectUri);
    target.searchParams.set("error", "access_denied");
    if (params.state !== undefined) {
      target.searchParams.set("state", params.state);
    }
    return target.href;
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const code = this.liveCode(client, authorizationCode);
    return code.challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string
  ): Promise<OAuthTokens> {
    const code = this.liveCode(client, authorizationCode);
    if (redirectUri !== undefined && redirectUri !== code.redirectUri) {
      throw new InvalidGrantError("redirect_uri does not match the authorization request");
    }
    if (!this.store.takeCode(sha256(authorizationCode))) {
      throw new InvalidGrantError("authorization code was already used");
    }
    return this.issueTokens(code.grantId);
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string): Promise<OAuthTokens> {
    const hash = sha256(refreshToken);
    const token = this.store.getToken(hash);
    const grant = token ? this.store.getGrant(token.grantId) : undefined;
    if (!token || token.kind !== "refresh" || token.expiresAt < Date.now() || !grant || grant.clientId !== client.client_id) {
      throw new InvalidGrantError("refresh token is not valid");
    }
    if (!this.store.takeToken(hash)) {
      throw new InvalidGrantError("refresh token was already used");
    }
    return this.issueTokens(grant.id);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const record = this.store.getToken(sha256(token));
    const grant = record ? this.store.getGrant(record.grantId) : undefined;
    if (!record || record.kind !== "access" || record.expiresAt < Date.now() || !grant) {
      throw new InvalidTokenError("access token is not valid");
    }
    this.store.touchGrant(grant.id);
    const connection: Connection = { grant, apiKey: decrypt(this.config.secret, grant.keySealed) };
    return {
      token,
      clientId: grant.clientId,
      scopes: grant.readOnly ? ["read"] : ["read", "write"],
      expiresAt: Math.floor(record.expiresAt / 1000),
      resource: this.config.mcpUrl,
      extra: { connection }
    };
  }

  /** Disconnecting ends the connection and revokes its Hellotracks API key. */
  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const record = this.store.getToken(sha256(request.token));
    const grant = record ? this.store.getGrant(record.grantId) : undefined;
    if (!grant || grant.clientId !== client.client_id) {
      return;
    }
    this.store.deleteGrant(grant.id);
    try {
      const apiKey = decrypt(this.config.secret, grant.keySealed);
      await revokeApiKeyAction(personContext(this.config, apiKey), encodeURIComponent(grant.keyId));
    } catch {
      // The key still runs out on its own after 90 days.
    }
  }

  private liveCode(client: OAuthClientInformationFull, authorizationCode: string) {
    const code = this.store.getCode(sha256(authorizationCode));
    if (!code || code.expiresAt < Date.now() || code.clientId !== client.client_id) {
      throw new InvalidGrantError("authorization code is not valid");
    }
    return code;
  }

  private issueTokens(grantId: string): OAuthTokens {
    const grant = this.store.getGrant(grantId);
    if (!grant) {
      throw new InvalidGrantError("connection no longer exists");
    }
    const now = Date.now();
    const accessToken = `hta_${randomToken(32)}`;
    const refreshToken = `htr_${randomToken(32)}`;
    const accessExpires = Math.min(now + ACCESS_TOKEN_TTL_MS, grant.keyExpiresAt);
    this.store.putToken(sha256(accessToken), { grantId, kind: "access", expiresAt: accessExpires });
    this.store.putToken(sha256(refreshToken), { grantId, kind: "refresh", expiresAt: Math.min(now + REFRESH_TOKEN_TTL_MS, grant.keyExpiresAt) });
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: Math.max(1, Math.floor((accessExpires - now) / 1000)),
      refresh_token: refreshToken,
      scope: grant.readOnly ? "read" : "read write"
    };
  }
}
