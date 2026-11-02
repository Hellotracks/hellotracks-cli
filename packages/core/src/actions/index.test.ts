import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { checkWorkingHours, getJobAction, getMemberAction, getPlaceAction, listMembersAction, routeStartTimeValue } from "./index.js";
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
