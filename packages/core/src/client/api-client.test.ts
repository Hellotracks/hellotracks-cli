import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { ApiClient, ApiError } from "./api-client.js";
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

test("ApiClient sends API-Key and returns data", async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.headers["api-key"], "secret");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: { ok: true }, error: null, meta: {} }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const client = new ApiClient(`http://127.0.0.1:${address.port}`, "secret", context);
  const result = await client.get<{ ok: boolean }>("/auth/whoami");
  assert.deepEqual(result, { ok: true });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("ApiClient sends ht-cli attribution headers when configured", async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.headers["ht-integration-source"], "ht_cli");
    assert.equal(req.headers["user-agent"], "hellotracks-ht-cli/0.1.5");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: { ok: true }, error: null, meta: {} }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const client = new ApiClient(`http://127.0.0.1:${address.port}`, "secret", {
    ...context,
    integrationSource: "ht_cli",
    clientUserAgent: "hellotracks-ht-cli/0.1.5"
  });
  const result = await client.get<{ ok: boolean }>("/auth/whoami");
  assert.deepEqual(result, { ok: true });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("ApiClient throws ApiError on envelope error", async () => {
  const server = http.createServer((_, res) => {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      data: null,
      error: { code: "invalid_api_key", message: "Invalid API key" },
      meta: {}
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const client = new ApiClient(`http://127.0.0.1:${address.port}`, "secret", context);
  await assert.rejects(
    () => client.get("/auth/whoami"),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "invalid_api_key");
      assert.equal(error.statusCode, 401);
      return true;
    }
  );
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("ApiClient reports non-JSON API responses with response context", async () => {
  const server = http.createServer((_, res) => {
    res.statusCode = 502;
    res.statusMessage = "Bad Gateway";
    res.setHeader("Content-Type", "text/html");
    res.end("<html><head><title>Bad Gateway</title></head><body>upstream route service failed</body></html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const client = new ApiClient(`http://127.0.0.1:${address.port}`, "secret", context);
  await assert.rejects(
    () => client.post("/routes/calculate", { workerUid: "worker-1" }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "request_failed");
      assert.equal(error.statusCode, 502);
      assert.match(error.message, /Expected JSON response/);
      assert.match(error.message, /\/routes\/calculate/);
      assert.match(error.message, /text\/html/);
      assert.match(error.message, /upstream route service failed/);
      return true;
    }
  );
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("ApiClient does not immediately retry throttled GET responses without Retry-After", async () => {
  let requests = 0;
  const server = http.createServer((_, res) => {
    requests += 1;
    res.statusCode = 429;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      data: null,
      error: { code: "throttled", message: "Throttled" },
      meta: {}
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const client = new ApiClient(`http://127.0.0.1:${address.port}`, "secret", context);
  await assert.rejects(
    () => client.get("/sessions/queued"),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "throttled");
      assert.equal(error.statusCode, 429);
      return true;
    }
  );
  assert.equal(requests, 1);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("ApiClient downloads binary responses with filename metadata", async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/reports/generate");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=\"jobs.csv\"");
    res.setHeader("X-HT-Report-ID", "report-1");
    res.end("id,title\n1,Job\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const client = new ApiClient(`http://127.0.0.1:${address.port}`, "secret", context);
  const result = await client.download("POST", "/reports/generate", { type: "jobs" });
  assert.equal(result.contentType, "text/csv");
  assert.equal(result.filename, "jobs.csv");
  assert.equal(result.body.toString("utf8"), "id,title\n1,Job\n");
  assert.equal(result.headers.get("x-ht-report-id"), "report-1");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("ApiClient uploads multipart files with auth and attribution headers", async () => {
  const server = http.createServer(async (req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/forms/attachments");
    assert.equal(req.headers["api-key"], "secret");
    assert.equal(req.headers["ht-integration-source"], "ht_cli");
    assert.equal(req.headers["user-agent"], "hellotracks-ht-cli/0.1.5");
    assert.match(String(req.headers["content-type"] ?? ""), /^multipart\/form-data; boundary=/);
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    const body = Buffer.concat(chunks).toString("utf8");
    assert.match(body, /name="field"/);
    assert.match(body, /photo/);
    assert.match(body, /filename="proof.txt"/);
    assert.match(body, /hello attachment/);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: { path: "/uploads/proof.txt", value: "[]" }, error: null, meta: {} }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const client = new ApiClient(`http://127.0.0.1:${address.port}`, "secret", {
    ...context,
    integrationSource: "ht_cli",
    clientUserAgent: "hellotracks-ht-cli/0.1.5"
  });
  const result = await client.upload<{ path: string; value: string }>("/forms/attachments", {
    filename: "proof.txt",
    body: Buffer.from("hello attachment"),
    contentType: "text/plain"
  }, {
    field: "photo"
  });
  assert.deepEqual(result, { path: "/uploads/proof.txt", value: "[]" });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("ApiClient converts request timeouts into ApiError", async () => {
  const server = http.createServer((_, res) => {
    setTimeout(() => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { ok: true }, error: null, meta: {} }));
    }, 100);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const client = new ApiClient(`http://127.0.0.1:${address.port}`, "secret", context);
  await assert.rejects(
    () => client.get("/auth/whoami", undefined, { timeoutMs: 10 }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "request_timeout");
      assert.equal(error.statusCode, 408);
      return true;
    }
  );
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
