import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { checkWorkingHours, finishSignupAction, getJobAction, getMemberAction, getPlaceAction, issuePasswordKeyAction, listMembersAction, routeStartTimeValue } from "./index.js";
import { serviceContext } from "../service.js";
import { ApiError } from "../client/api-client.js";
import type { CommandContext } from "../types.js";

const context: CommandContext = {
  profile: "test",
  apiUrl: undefined,
  apiKey: undefined,
  output: "json",
  noInput: true,
  quiet: true,
  verbose: false,
  yes: false
};

test("listMembersAction resolves api credentials from context and shapes query", async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.headers["api-key"], "secret");
    assert.match(req.url ?? "", /uids=a1%2Ca2/);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      data: { items: [{ id: "a1", name: "Alice" }] },
      error: null,
      meta: {}
    }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const result = await listMembersAction(
    {
      ...context,
      apiUrl: `http://127.0.0.1:${address.port}`,
      apiKey: "secret"
    },
    { uids: "a1,a2" }
  );

  assert.deepEqual(result.items, [{ id: "a1", name: "Alice" }]);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("routeStartTimeValue turns HH:mm into the number the API reads", () => {
  assert.equal(routeStartTimeValue("08:00"), 800);
  assert.equal(routeStartTimeValue("7:30"), 730);
  assert.equal(routeStartTimeValue("1745"), 1745);
  assert.equal(routeStartTimeValue("team"), -1);
  assert.equal(routeStartTimeValue(900), 900);
  assert.throws(() => routeStartTimeValue("25:00"));
  assert.throws(() => routeStartTimeValue("morning"));
});

test("single gets report an unknown id as not found", async () => {
  const server = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: { items: [] }, error: null, meta: {} }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const apiContext = { ...context, apiUrl: `http://127.0.0.1:${address.port}`, apiKey: "secret" };
  try {
    for (const get of [getMemberAction, getPlaceAction, getJobAction]) {
      await assert.rejects(get(apiContext, "missing-1"), (error: unknown) => error instanceof ApiError && error.statusCode === 404);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("checkWorkingHours asks for all seven days", () => {
  const week = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => [day, { start: 800, end: 1800 }]));
  assert.doesNotThrow(() => checkWorkingHours(week));
  assert.doesNotThrow(() => checkWorkingHours({ source: "team" }));
  assert.throws(() => checkWorkingHours({ monday: { start: 800, end: 1800 } }), /missing: tuesday/);
});

test("a service context sends its own key, user agent and headers, and reads no profile", async () => {
  const seen: http.IncomingHttpHeaders[] = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers);
    res.setHeader("Content-Type", "application/json");
    const issued = { apiKey: "k1.secret", apiKeyExpiresAt: 1, accountId: "a1", username: "pat@example.com", companyId: "c1", companyName: "Pat Co" };
    res.end(JSON.stringify({ data: req.url?.startsWith("/v1/auth/password") ? issued : { items: [] }, error: null, meta: {} }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const apiUrl = `http://127.0.0.1:${address.port}/v1`;
  const saved = { key: process.env.HELLOTRACKS_API_KEY, file: process.env.HELLOTRACKS_API_KEY_FILE };
  process.env.HELLOTRACKS_API_KEY = "from-the-environment";
  process.env.HELLOTRACKS_API_KEY_FILE = "/nonexistent/key";
  try {
    const signedIn = serviceContext({ apiUrl, apiKey: "person-key", userAgent: "hellotracks-mcp/test", headers: { "X-Test": "1" } });
    await listMembersAction(signedIn);
    assert.equal(seen[0]?.["api-key"], "person-key");
    assert.equal(seen[0]?.["user-agent"], "hellotracks-mcp/test");
    assert.equal(seen[0]?.["x-test"], "1");

    const anonymous = serviceContext({ apiUrl, userAgent: "hellotracks-mcp/test" });
    const issued = await issuePasswordKeyAction(anonymous, { email: "pat@example.com", password: "pw" });
    assert.equal(issued.apiKey, "k1.secret");
    assert.equal(seen[1]?.["api-key"], undefined);
    await assert.rejects(listMembersAction(anonymous), (error: unknown) => error instanceof ApiError && error.statusCode === 401);
    await assert.rejects(finishSignupAction(anonymous, { email: "pat@example.com", code: "123456", company: { name: "Pat Co" } }), /keeps the key itself/);
  } finally {
    for (const [name, value] of [["HELLOTRACKS_API_KEY", saved.key], ["HELLOTRACKS_API_KEY_FILE", saved.file]] as const) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
