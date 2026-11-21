import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { createApp } from "./app.js";
import type { Config } from "./config.js";
import { ClientsStore } from "./provider.js";
import { Store } from "./store.js";
import { weekHours } from "./tools/kit.js";

const API_KEY = "kid123.secretpart";
const calls: Array<{ method: string; path: string; body: unknown; key: string | undefined; headers: IncomingMessage["headers"] }> = [];
let api: Server;
let mcp: Server;
let base = "";

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let text = "";
    req.on("data", (chunk) => (text += chunk));
    req.on("end", () => resolve(text ? JSON.parse(text) : undefined));
  });
}

/** A fake Hellotracks /v1 API with one company, two members and three jobs. */
function fakeApi(req: IncomingMessage, body: unknown): { status: number; data: unknown } {
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname.replace(/^\/v1/, "");
  const key = req.headers["api-key"];
  if (path === "/auth/email-code") {
    return { status: 200, data: { sent: true } };
  }
  if (path === "/auth/email-code/verify") {
    const { code } = body as { code: string };
    return code === "123456"
      ? { status: 200, data: { apiKey: API_KEY, apiKeyExpiresAt: Date.now() + 90 * 86_400_000, accountId: "u1", username: "ann@example.com", companyId: "c1", companyName: "Acme Field" } }
      : { status: 400, data: { error: "That code is not right." } };
  }
  if (path === "/auth/password") {
    const { password } = body as { password: string };
    return password === "pw-right"
      ? { status: 200, data: { apiKey: API_KEY, apiKeyExpiresAt: Date.now() + 90 * 86_400_000, accountId: "u1", username: "ann@example.com", companyId: "c1", companyName: "Acme Field" } }
      : { status: 400, data: { error: "That email and password don't match a company admin" } };
  }
  if (path === "/signup") {
    const { email } = body as { email: string };
    return email === "ann@example.com"
      ? { status: 409, data: { error: "An account with this email exists." } }
      : { status: 202, data: { sent: true } };
  }
  if (path === "/signup/verify") {
    const { code, company } = body as { code: string; company: { name: string; address: string } };
    if (code !== "654321") {
      return { status: 400, data: { error: "That code is not right." } };
    }
    if (company.address === "Nowhere") {
      return { status: 400, data: { error: "company.address could not be found on the map; give a fuller address or company.location" } };
    }
    return { status: 200, data: { apiKey: API_KEY, apiKeyExpiresAt: Date.now() + 90 * 86_400_000, accountId: "u5", username: "dee@newco.com", companyId: "c5", companyName: company.name } };
  }
  if (key !== API_KEY) {
    return { status: 401, data: { error: "bad key" } };
  }
  if (path === "/auth/whoami") {
    return { status: 200, data: { account: { locale: { timezone: "Europe/Berlin" } }, company: { id: "c1", name: "Acme Field" } } };
  }
  if (path === "/company") {
    return { status: 200, data: { company: { name: "Acme Field", teamsConfig: [{ id: 1, name: "North" }, { id: 2, name: "South" }], settings: { autoCheckins: true, workersAllowedTrackingOff: false } } } };
  }
  if (path === "/members" && req.method === "POST") {
    const { username } = body as { username: string };
    return username === "taken@newco.com"
      ? { status: 409, data: { error: "This username is taken." } }
      : { status: 201, data: { member: { id: `m-${username}`, ...(body as object) } } };
  }
  if (path.startsWith("/members/") && req.method === "PATCH") {
    return { status: 200, data: { member: { id: path.slice("/members/".length), ...(body as object) } } };
  }
  if (path === "/members") {
    return { status: 200, data: { items: [
      { id: "m1", name: "Bo", type: "person", role: "worker", teams: [1], location: { lat: 48.1, lng: 11.5, ts: Date.now() - 5 * 60_000 }, states: { moving: "ontheway", tracking_status: true } },
      { id: "m2", name: "Cy", type: "person", role: "worker", teams: [2] },
      { id: "c1", name: "Acme Field", type: "company" }
    ] } };
  }
  if (path === "/jobs" && req.method === "GET") {
    return { status: 200, data: { items: [
      { id: "j1", title: "Fix pump", progress: "scheduled", assignee: { id: "m1", name: "Bo" }, timeWindow: { start: "09:00", end: "12:00" }, onSiteDurationSeconds: 1800 },
      { id: "j2", title: "Check meter", progress: "success", assignee: { id: "m1", name: "Bo" }, timeWindow: { start: "00:00", end: "24:00" } },
      { id: "j3", title: "Quote", progress: "unassigned", assignee: {}, timeWindow: { start: "00:00", end: "24:00" } }
    ] } };
  }
  if (path === "/jobs" && req.method === "POST") {
    return { status: 201, data: { items: [{ id: "j9", ...(body as object), progress: "unassigned" }] } };
  }
  if (path === "/jobs" && req.method === "PATCH") {
    const jobs = (body as { jobs: Record<string, object> }).jobs;
    // Like the API: ids it doesn't know are left out of the answer, without an error.
    return { status: 200, data: { items: Object.entries(jobs).filter(([id]) => !id.startsWith("missing")).map(([id, fields]) => ({ id, ...fields })) } };
  }
  if (path === "/reports/run" && req.method === "POST") {
    return { status: 200, data: { run: { id: "r1", status: "queued" } } };
  }
  if (path === "/reports/run/r1") {
    return { status: 200, data: { run: { id: "r1", status: "done", files: [{ name: "timesheet.xlsx", format: "xlsx", bytes: 9, url: "https://files.example/r1" }] } } };
  }
  if (path.startsWith("/apikeys/")) {
    return { status: 200, data: [] };
  }
  return { status: 404, data: { error: "no route" } };
}

before(async () => {
  api = createHttpServer(async (req, res) => {
    const body = await readBody(req);
    calls.push({ method: req.method ?? "", path: req.url ?? "", body, key: req.headers["api-key"] as string | undefined, headers: req.headers });
    const { status, data } = fakeApi(req, body);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(status < 400 ? { data, error: null } : { data: null, error: { code: "x", message: (data as { error: string }).error } }));
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const apiPort = (api.address() as AddressInfo).port;

  mcp = createHttpServer();
  await new Promise<void>((resolve) => mcp.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}`;
  const config: Config = {
    issuer: new URL(base),
    mcpUrl: new URL("/mcp", base),
    apiUrl: `http://127.0.0.1:${apiPort}/v1`,
    port: 0,
    dbPath: ":memory:",
    secret: "s".repeat(40),
    allowedOrigins: ["https://claude.ai"],
    docsUrl: "https://example.com/docs",
    serviceToken: "z".repeat(40)
  };
  const store = new Store(":memory:");
  const clients = new ClientsStore(store, async (url) => ({
    client_id: url.href,
    client_name: "Claude Code",
    redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"]
  }));
  mcp.on("request", createApp(config, store, clients));
});

after(() => {
  api.close();
  mcp.close();
});

const form = (fields: Record<string, string>) => ({
  method: "POST",
  redirect: "manual" as const,
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString()
});

function hiddenFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const match of html.matchAll(/<input type="hidden" name="(\w+)" value="([^"]*)">/g)) {
    fields[match[1] as string] = (match[2] as string).replace(/&amp;/g, "&");
  }
  return fields;
}

/** Runs the whole sign-in like a client would and returns the tokens. */
async function connect(clientId: string, redirectUri: string, options: { readOnly?: boolean; password?: string } = {}) {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = new URL("/authorize", base);
  authorize.search = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge,
    code_challenge_method: "S256", state: "st8", resource: `${base}/mcp`
  }).toString();
  const start = await fetch(authorize, { redirect: "manual" });
  assert.equal(start.status, 302);
  const signin = await fetch(new URL(start.headers.get("location") ?? "", base));
  const signinHtml = await signin.text();
  assert.match(signinHtml, /wants to work with your Hellotracks company/);
  const emailFields = { ...hiddenFields(signinHtml), email: "ann@example.com", ...(options.readOnly ? { readOnly: "1" } : {}) };
  let done: Response;
  if (options.password) {
    const wrong = await fetch(`${base}/signin/email`, form({ ...emailFields, password: "pw-wrong" }));
    assert.match(await wrong.text(), /don&#39;t match/);
    done = await fetch(`${base}/signin/email`, form({ ...emailFields, password: options.password }));
  } else {
    const codeHtml = await (await fetch(`${base}/signin/email`, form(emailFields))).text();
    assert.match(codeHtml, /6-digit code/);
    const wrong = await fetch(`${base}/signin/code`, form({ ...hiddenFields(codeHtml), code: "000000" }));
    assert.match(await wrong.text(), /not right/);
    done = await fetch(`${base}/signin/code`, form({ ...hiddenFields(codeHtml), code: "123 456" }));
  }
  assert.equal(done.status, 302);
  const back = new URL(done.headers.get("location") ?? "");
  assert.equal(back.searchParams.get("state"), "st8");
  const token = await fetch(`${base}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code") ?? "", code_verifier: verifier,
      redirect_uri: redirectUri, client_id: clientId, resource: `${base}/mcp` }).toString()
  });
  assert.equal(token.status, 200);
  return (await token.json()) as { access_token: string; refresh_token: string; scope: string };
}

async function rpc(token: string, method: string, params: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  return { status: response.status, body: response.status === 200 ? await response.json() as { result: any } : undefined, response };
}

const INIT = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } };

test("an unauthenticated call answers 401 pointing at the resource metadata", async () => {
  const response = await fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate") ?? "", /resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource\/mcp"/);
  const resource = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json() as { resource: string; authorization_servers: string[] };
  assert.equal(resource.resource, `${base}/mcp`);
  const server = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json() as Record<string, unknown>;
  assert.equal(server.client_id_metadata_document_supported, true);
  assert.deepEqual(server.code_challenge_methods_supported, ["S256"]);
  assert.ok((server.token_endpoint_auth_methods_supported as string[]).includes("none"));
});

test("a registered client signs in by email code and uses the tools", async () => {
  const registered = await (await fetch(`${base}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], token_endpoint_auth_method: "none" })
  })).json() as { client_id: string };
  const tokens = await connect(registered.client_id, "https://claude.ai/api/mcp/auth_callback");
  assert.equal(tokens.scope, "read write");
  const verify = calls.find((call) => call.path.endsWith("/auth/email-code/verify"));
  assert.equal((verify?.body as { keyLabel: string }).keyLabel, "Claude (AI connector)");

  const init = await rpc(tokens.access_token, "initialize", INIT);
  assert.equal(init.body?.result.serverInfo.name, "hellotracks");
  const list = await rpc(tokens.access_token, "tools/list", {});
  const tools = list.body?.result.tools as Array<{ name: string; title?: string; annotations: Record<string, unknown> }>;
  assert.ok(tools.length >= 35, `${tools.length} tools`);
  assert.equal(new Set(tools.map((tool) => tool.name)).size, tools.length);
  for (const tool of tools) {
    assert.ok(tool.title, `${tool.name} has a title`);
    assert.equal(typeof tool.annotations.readOnlyHint, "boolean", `${tool.name} readOnlyHint`);
    assert.equal(typeof tool.annotations.destructiveHint, "boolean", `${tool.name} destructiveHint`);
    assert.equal(typeof tool.annotations.openWorldHint, "boolean", `${tool.name} openWorldHint`);
  }

  const status = await rpc(tokens.access_token, "tools/call", { name: "get_team_status", arguments: { date: "2026-11-12" } });
  const team = JSON.parse(status.body?.result.content[0].text);
  assert.equal(team.people.length, 2);
  assert.deepEqual(team.people[0].teams, ["North"]);
  assert.deepEqual(team.people[0].jobs, { scheduled: 1, success: 1 });
  assert.equal(team.people[0].lastSeen, "5 min ago");
  assert.deepEqual(team.people[0].position, { lat: 48.1, lng: 11.5 });
  assert.equal(team.people[1].lastSeen, "never");
  assert.equal(team.unassignedJobs, 1);
  assert.equal(calls.at(-1)?.key, API_KEY);

  const created = await rpc(tokens.access_token, "tools/call", { name: "create_jobs", arguments: { jobs: [
    { title: "New visit", address: "Main St 1", date: "2026-11-13", timeWindowStart: "08:00", timeWindowEnd: "10:00", onSiteMinutes: 45 }
  ] } });
  const createdBody = JSON.parse(created.body?.result.content[0].text);
  assert.equal(createdBody.created[0].id, "j9");
  const post = calls.find((call) => call.method === "POST" && call.path === "/v1/jobs");
  assert.deepEqual(post?.body, { title: "New visit", address: "Main St 1", date: "2026-11-13", timeWindow: { start: "08:00", end: "10:00" }, onSiteDurationSeconds: 2700 });

  // Refresh tokens rotate: the first use works, the second is refused.
  const refresh = (token: string) => fetch(`${base}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token, client_id: registered.client_id }).toString()
  });
  assert.equal((await refresh(tokens.refresh_token)).status, 200);
  assert.equal((await refresh(tokens.refresh_token)).status, 400);

  // Disconnecting revokes the Hellotracks key and the token stops working.
  const revoke = await fetch(`${base}/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: tokens.access_token, client_id: registered.client_id }).toString()
  });
  assert.equal(revoke.status, 200);
  assert.ok(calls.some((call) => call.path === "/v1/apikeys/kid123/revoke"));
  assert.equal((await rpc(tokens.access_token, "tools/list", {})).status, 401);
});

test("a metadata-document client with a loopback redirect connects read only", async () => {
  const clientId = "https://claude.ai/oauth/claude-code-client-metadata";
  const tokens = await connect(clientId, "http://localhost:53123/callback", { readOnly: true });
  assert.equal(tokens.scope, "read");
  // Only the reading tools are offered, so the AI app never shows a change it can't make.
  const listed = (await rpc(tokens.access_token, "tools/list", {})).body?.result.tools as Array<{ name: string; annotations: { readOnlyHint: boolean } }>;
  assert.equal(listed.length, 16);
  assert.ok(listed.every((tool) => tool.annotations.readOnlyHint), "only read tools");
  const result = await rpc(tokens.access_token, "tools/call", { name: "create_jobs", arguments: { jobs: [{ title: "Nope" }] } });
  assert.equal(result.body?.result.isError, true);
  assert.match(result.body?.result.content[0].text, /not found/);
  const read = await rpc(tokens.access_token, "tools/call", { name: "find_jobs", arguments: { date: "2026-11-12" } });
  assert.equal(JSON.parse(read.body?.result.content[0].text).jobs.length, 3);
});

test("a reviewer signs in with a password, and sign-ins pass on the person's IP", async () => {
  const registered = await (await fetch(`${base}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "ChatGPT", redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"], token_endpoint_auth_method: "none" })
  })).json() as { client_id: string };
  const tokens = await connect(registered.client_id, "https://chatgpt.com/connector_platform_oauth_redirect", { password: "pw-right" });
  assert.equal(tokens.scope, "read write");
  const signIn = calls.filter((call) => call.path === "/v1/auth/password").at(-1);
  assert.equal(signIn?.headers["x-hellotracks-service-token"], "z".repeat(40));
  assert.equal(signIn?.headers["x-hellotracks-client-ip"], "127.0.0.1");
  assert.equal((signIn?.body as { keyLabel: string }).keyLabel, "ChatGPT (AI connector)");
});

test("someone new creates a company while connecting, then invites the team", async () => {
  const registered = await (await fetch(`${base}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], token_endpoint_auth_method: "none" })
  })).json() as { client_id: string };
  const redirectUri = "https://claude.ai/api/mcp/auth_callback";
  const verifier = randomBytes(32).toString("base64url");
  const authorize = new URL("/authorize", base);
  authorize.search = new URLSearchParams({
    response_type: "code", client_id: registered.client_id, redirect_uri: redirectUri,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state: "new1"
  }).toString();
  const start = await fetch(authorize, { redirect: "manual" });
  const signinHtml = await (await fetch(new URL(start.headers.get("location") ?? "", base))).text();
  const link = /href="(\/signin\/new\?s=[^"]+)"/.exec(signinHtml)?.[1] ?? "";
  assert.ok(link, "the sign-in page links to creating a company");
  const newPage = await fetch(new URL(link.replace(/&amp;/g, "&"), base));
  const newHtml = await newPage.text();
  assert.match(newHtml, /Create your Hellotracks company/);
  assert.match(newPage.headers.get("content-security-policy") ?? "", /script-src 'sha256-/);
  const fields = hiddenFields(newHtml);
  const details = { name: "Dee Ray", email: "Dee@NewCo.com", company: "NewCo Service", address: "1 Main St, Austin, TX", timezone: "America/Chicago" };

  const noTerms = await fetch(`${base}/signin/new`, form({ ...fields, ...details }));
  assert.equal(noTerms.status, 400);
  assert.match(await noTerms.text(), /Accept the terms/);

  const existing = await fetch(`${base}/signin/new`, form({ ...fields, ...details, email: "ann@example.com", terms: "1" }));
  assert.equal(existing.status, 409);
  const existingHtml = await existing.text();
  assert.match(existingHtml, /Sign in instead/);
  assert.match(existingHtml, /value="ann@example.com"/);

  const codeHtml = await (await fetch(`${base}/signin/new`, form({ ...fields, ...details, terms: "1" }))).text();
  assert.match(codeHtml, /6-digit code/);
  const signup = calls.filter((call) => call.path === "/v1/signup").at(-1);
  assert.deepEqual(signup?.body, { email: "dee@newco.com", name: "Dee Ray", acceptTerms: true, timezone: "America/Chicago", language: "en" });
  assert.equal(signup?.headers["x-hellotracks-client-ip"], "127.0.0.1");

  const codeFields = hiddenFields(codeHtml);
  assert.equal(codeFields.company, "NewCo Service");
  const badAddress = await fetch(`${base}/signin/new/code`, form({ ...codeFields, code: "654321", address: "Nowhere" }));
  assert.match(await badAddress.text(), /couldn&#39;t find that address/);
  const done = await fetch(`${base}/signin/new/code`, form({ ...codeFields, code: "654 321", address: "1 Main St, Austin, TX" }));
  assert.equal(done.status, 302);
  const verify = calls.filter((call) => call.path === "/v1/signup/verify").at(-1);
  assert.deepEqual(verify?.body, { email: "dee@newco.com", code: "654321", company: { name: "NewCo Service", address: "1 Main St, Austin, TX" }, keyLabel: "Claude (AI connector)" });

  const back = new URL(done.headers.get("location") ?? "");
  assert.equal(back.searchParams.get("state"), "new1");
  const token = await (await fetch(`${base}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code") ?? "", code_verifier: verifier,
      redirect_uri: redirectUri, client_id: registered.client_id }).toString()
  })).json() as { access_token: string; scope: string };
  assert.equal(token.scope, "read write");

  const invited = await rpc(token.access_token, "tools/call", { name: "invite_members", arguments: { people: [
    { name: "Eli", email: "Eli@NewCo.com", phone: "+1 512 555 0100", workDays: ["monday", "tuesday"], start: "08:00", end: "16:30" },
    { name: "Fay", email: "taken@newco.com" },
    { name: "Gus" }
  ] } });
  const result = JSON.parse(invited.body?.result.content[0].text);
  assert.deepEqual(result.invited, [{ id: "m-eli@newco.com", name: "Eli", login: "eli@newco.com", role: "worker" }]);
  assert.deepEqual(result.failed.map((entry: { name: string }) => entry.name), ["Fay", "Gus"]);
  const memberPost = calls.find((call) => call.method === "POST" && call.path === "/v1/members");
  assert.equal((memberPost?.body as { phone: string }).phone, "+1 512 555 0100");
  assert.equal(memberPost?.headers["user-agent"], "hellotracks-mcp/0.2");
  const memberPatch = calls.find((call) => call.method === "PATCH" && call.path === "/v1/members/m-eli@newco.com");
  assert.deepEqual((memberPatch?.body as { workingHours: unknown }).workingHours, weekHours(["monday", "tuesday"], "08:00", "16:30"));
});

test("working hours fill all seven days", () => {
  const hours = weekHours(undefined, "07:30", "16:00") as Record<string, { start: number; end: number }>;
  assert.deepEqual(hours.monday, { start: 730, end: 1600 });
  assert.deepEqual(hours.friday, { start: 730, end: 1600 });
  assert.deepEqual(hours.sunday, { start: 0, end: 0 });
  assert.equal(weekHours(["monday"], undefined, "16:00"), undefined);
});

test("a browser origin that is not allowed is refused", async () => {
  const result = await rpc("anything", "tools/list", {}, { Origin: "https://evil.example" });
  assert.equal(result.status, 403);
});

test("tools write what the API expects and stop on a read-only connection", async () => {
  const tokens = await connect("https://claude.ai/oauth/claude-code-client-metadata", "http://localhost:53124/callback");
  const call = async (name: string, args: unknown) => {
    const result = await rpc(tokens.access_token, "tools/call", { name, arguments: args });
    return { error: result.body?.result.isError === true, data: result.body?.result.isError ? result.body?.result.content[0].text : JSON.parse(result.body?.result.content[0].text) };
  };

  // Several jobs change in one call, keyed by id.
  const updated = await call("update_jobs", { jobs: [{ id: "j1", assigneeId: "m2" }, { id: "j3", date: "tomorrow", onSiteMinutes: 30 }] });
  assert.deepEqual(updated.data.updated.map((job: { id: string }) => job.id), ["j1", "j3"]);
  const patch = calls.filter((entry) => entry.method === "PATCH" && entry.path === "/v1/jobs").at(-1);
  const sent = (patch?.body as { jobs: Record<string, Record<string, unknown>> }).jobs;
  assert.deepEqual(sent.j1, { assigneeId: "m2" });
  assert.match(String(sent.j3?.date), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(sent.j3?.onSiteDurationSeconds, 1800);
  assert.equal(updated.data.failed, undefined);

  // The company's settings sit in its settings object; teams come from teamsConfig.
  const company = await call("get_company", {});
  assert.deepEqual(company.data.settings, { autoCheckins: true, workersAllowedTrackingOff: false });
  assert.deepEqual(company.data.teams, [{ id: 1, name: "North" }, { id: 2, name: "South" }]);

  // The time zone is asked once per connection, not on every call: the API throttles identical requests.
  const whoamiBefore = calls.filter((entry) => entry.path === "/v1/auth/whoami").length;
  assert.ok(whoamiBefore > 0);
  await call("find_jobs", { date: "today" });
  await call("find_jobs", { date: "tomorrow" });
  assert.equal(calls.filter((entry) => entry.path === "/v1/auth/whoami").length, whoamiBefore);

  // A job id the company doesn't have comes back as failed, not as a quiet success.
  const partly = await call("update_jobs", { jobs: [{ id: "j1", priority: 2 }, { id: "missing-1", priority: 2 }] });
  assert.deepEqual(partly.data.updated.map((job: { id: string }) => job.id), ["j1"]);
  assert.deepEqual(partly.data.failed.map((entry: { id: string }) => entry.id), ["missing-1"]);

  // Team names become the team numbers the API stores.
  await call("update_members", { members: [{ id: "m2", teams: ["north", "South"] }] });
  const memberPatch = calls.filter((entry) => entry.method === "PATCH" && entry.path === "/v1/members/m2").at(-1);
  assert.deepEqual((memberPatch?.body as { teams: number[] }).teams, [1, 2]);
  const unknownTeam = await call("update_members", { members: [{ id: "m2", teams: ["East"] }] });
  assert.match(JSON.stringify(unknownTeam.data.failed), /No team named \\"East\\"/);

  // A report run waits for its files.
  const report = await call("run_report", { report: "timesheet", period: "lastWeek", formats: ["xlsx"] });
  assert.deepEqual(report.data, { runId: "r1", files: [{ name: "timesheet.xlsx", format: "xlsx", bytes: 9, url: "https://files.example/r1" }] });
  const runPost = calls.filter((entry) => entry.path === "/v1/reports/run").at(-1);
  assert.deepEqual(runPost?.body, { request: { report: "timesheet", period: "lastWeek" }, formats: ["xlsx"] });

  // A bad date is refused before any call.
  const badDate = await call("find_jobs", { date: "next week" });
  assert.equal(badDate.error, true);
  assert.match(badDate.data, /not a date/);

  const readOnly = await connect("https://claude.ai/oauth/claude-code-client-metadata", "http://localhost:53125/callback", { readOnly: true });
  for (const name of ["delete_jobs", "remove_members", "update_company"]) {
    const result = await rpc(readOnly.access_token, "tools/call", { name, arguments: name === "update_company" ? { name: "X" } : { ids: ["j1"] } });
    assert.equal(result.body?.result.isError, true, name);
    assert.match(result.body?.result.content[0].text, /not found/);
  }
});

test("every tool says honestly what it does to data", async () => {
  const tokens = await connect("https://claude.ai/oauth/claude-code-client-metadata", "http://localhost:53126/callback");
  const tools = (await rpc(tokens.access_token, "tools/list", {})).body?.result.tools as Array<{ name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }>;
  for (const tool of tools) {
    const reads = /^(get|find|list|preview|run)_/.test(tool.name);
    assert.equal(tool.annotations.readOnlyHint, reads, tool.name);
    if (/^(delete|remove|revoke)_/.test(tool.name)) {
      assert.equal(tool.annotations.destructiveHint, true, tool.name);
    }
  }
});
