import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProgram, parseInvocation } from "./cli.js";
import { HELLOTRACKS_SKILL } from "./skill.js";

function cliEntrypoint(): string {
  return fileURLToPath(new URL("./index.js", import.meta.url));
}

async function runCli(args: string[], env?: NodeJS.ProcessEnv, input?: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntrypoint(), ...args], {
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...env
      }
    });
    let stdout = "";
    let stderr = "";
    assert.ok(child.stdout);
    assert.ok(child.stderr);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    if (input !== undefined && child.stdin) {
      child.stdin.end(input);
    }
    child.on("close", (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stdout,
        stderr
      });
    });
  });
}

async function createCompanyServer(): Promise<{ apiUrl: string; close: () => Promise<void> }> {
  const company = {
    id: "company-1",
    type: "company",
    username: "admin@example.com",
    name: "Acme Field Ops",
    email: "ops@example.com",
    settings: {
      apiEnabled: true,
      workersCreateJobs: false
    },
    teamsConfig: [
      {
        id: 1,
        name: "North",
        route: {
          start_lat: 37.7955203,
          start_lng: -122.3937451
        },
        working_hours: {
          monday: { start: 800, end: 1800 },
          tuesday: { start: 800, end: 1800 },
          wednesday: { start: 800, end: 1800 },
          thursday: { start: 800, end: 1800 },
          friday: { start: 800, end: 1800 },
          saturday: { start: 0, end: 0 },
          sunday: { start: 0, end: 0 }
        }
      }
    ]
  };
  const server = http.createServer((req, res) => {
    if (req.headers["api-key"] !== "secret") {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: null, error: { code: "invalid_api_key", message: "Invalid API key" }, meta: {} }));
      return;
    }
    if (req.url === "/company" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { company }, error: null, meta: {} }));
      return;
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: null, error: { code: "not_found", message: "Not found" }, meta: {} }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    apiUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function createAuthServer(): Promise<{ apiUrl: string; close: () => Promise<void> }> {
  const whoami = {
    account: {
      id: "account-1",
      type: "person",
      username: "admin@example.com",
      name: "Demo Admin",
      email: "admin@example.com",
      role: "admin",
      teams: [1],
      locale: { timezone: "Europe/Vienna" }
    },
    company: {
      id: "company-1",
      type: "company",
      username: "company@example.com",
      name: "Demo Company",
      email: "ops@example.com",
      settings: {
        apiEnabled: true,
        workersCreateJobs: false
      },
      teamsConfig: [
        { id: 1, name: "North" }
      ]
    },
    apiKey: {
      id: "key-1",
      legacy: false
    }
  };
  const server = http.createServer((req, res) => {
    if (req.headers["api-key"] !== "secret") {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: null, error: { code: "invalid_api_key", message: "Invalid API key" }, meta: {} }));
      return;
    }
    if (req.url === "/auth/whoami" && req.method === "GET") {
      assert.equal(req.headers["ht-integration-source"], "ht_cli");
      assert.match(String(req.headers["user-agent"] ?? ""), /^hellotracks-ht-cli\/\d+\.\d+\.\d+/);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: whoami, error: null, meta: {} }));
      return;
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: null, error: { code: "not_found", message: "Not found" }, meta: {} }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    apiUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function createMemberServer(): Promise<{ apiUrl: string; close: () => Promise<void> }> {
  const member = {
    id: "member-1",
    type: "worker",
    companyId: "company-1",
    username: "alice@example.com",
    name: "Alice Field",
    email: "alice@example.com",
    role: "worker",
    activeStatus: "online",
    teams: [1],
    locale: {
      timezone: "Europe/Vienna",
      language: "en"
    },
    units: {
      distance: "km",
      time: "24h",
      date: "yyyy-mm-dd"
    },
    location: {
      lat: 37.7955203,
      lng: -122.3937451,
      ts: 1770000000000,
      speed: 12,
      accuracy: 8,
      alt: 432,
      head: 87,
      sensor: 1
    },
    states: {
      tracking: true
    }
  };
  const server = http.createServer(async (req, res) => {
    if (req.headers["api-key"] !== "secret") {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: null, error: { code: "invalid_api_key", message: "Invalid API key" }, meta: {} }));
      return;
    }
    const bodyChunks: Buffer[] = [];
    for await (const chunk of req) {
      bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    const body = bodyChunks.length > 0 ? JSON.parse(Buffer.concat(bodyChunks).toString("utf8")) as Record<string, unknown> : {};
    if (req.url === "/members/member-1" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { items: [member] }, error: null, meta: {} }));
      return;
    }
    if (req.url === "/members/member-1" && req.method === "PATCH") {
      Object.assign(member, body);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { member }, error: null, meta: {} }));
      return;
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: null, error: { code: "not_found", message: "Not found" }, meta: {} }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    apiUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function createPlaceServer(): Promise<{ apiUrl: string; close: () => Promise<void> }> {
  const place = {
    id: "place-1",
    type: "place",
    name: "Acme HQ",
    address: "Main Street 1",
    city: "Rankweil",
    countryCode: "AT",
    radius: 100,
    location: {
      lat: 37.7955203,
      lng: -122.3937451
    },
    teams: [1],
    extendedData: {
      customerId: "CUST-1001"
    }
  };
  const server = http.createServer(async (req, res) => {
    if (req.headers["api-key"] !== "secret") {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: null, error: { code: "invalid_api_key", message: "Invalid API key" }, meta: {} }));
      return;
    }
    const bodyChunks: Buffer[] = [];
    for await (const chunk of req) {
      bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    const body = bodyChunks.length > 0 ? JSON.parse(Buffer.concat(bodyChunks).toString("utf8")) as Record<string, unknown> : {};
    if (req.url === "/places/place-1" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { items: [place] }, error: null, meta: {} }));
      return;
    }
    if (req.url === "/places/place-1" && req.method === "PATCH") {
      Object.assign(place, body);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { place }, error: null, meta: {} }));
      return;
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: null, error: { code: "not_found", message: "Not found" }, meta: {} }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    apiUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function createReportsServer(): Promise<{ apiUrl: string; close: () => Promise<void> }> {
  const descriptors = [
    {
      type: "jobs",
      label: "Jobs",
      filename: "jobs-report",
      canSelectMembers: true,
      canSelectPlaces: true,
      allowMultipleDates: true,
      allowMultipleAccounts: true,
      maxDays: 10000,
      defaultFormat: "csv",
      supportsRecurring: true,
      requiresFormTemplate: false,
      availableFormats: ["xlsx", "csv", "geojson", "pdf"],
      columns: [
        { key: "title", label: "Title" },
        { key: "status", label: "Status" }
      ],
      options: []
    }
  ];
  const members = [
    { id: "member-1", name: "Alice Field", username: "alice@example.com", email: "alice@example.com" }
  ];
  const recurring = {
    id: "recurring-1",
    name: "Weekly jobs",
    type: "jobs",
    frame: "week",
    format: "csv",
    statusText: "active",
    startDate: "2026-05-28"
  };
  const server = http.createServer(async (req, res) => {
    if (req.headers["api-key"] !== "secret") {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: null, error: { code: "invalid_api_key", message: "Invalid API key" }, meta: {} }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> : {};
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/reports/types" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { items: descriptors }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/members" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { items: members }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/reports/generate" && req.method === "POST") {
      assert.equal(body.type, "jobs");
      assert.deepEqual(body.memberIds, ["member-1"]);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=\"jobs-report.csv\"");
      res.setHeader("X-HT-Report-ID", "report-1");
      res.setHeader("X-HT-Report-Link", "/file/reports/report-1");
      res.setHeader("X-HT-Report-Type", "jobs");
      res.setHeader("X-HT-Report-Format", "csv");
      res.end("id,title\n1,Install\n");
      return;
    }
    if (url.pathname === "/reports/uploads" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        data: {
          items: [
            { id: "report-1", name: "Jobs", reportType: "jobs", source: "api", bytes: 19, timestamp: 1770000000000, link: "/file/reports/report-1" }
          ]
        },
        error: null,
        meta: {}
      }));
      return;
    }
    if (url.pathname === "/reports/recurring" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { items: [recurring] }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/reports/recurring" && req.method === "POST") {
      assert.equal(body.name, "Weekly jobs");
      assert.equal(body.type, "jobs");
      assert.deepEqual(body.memberIds, ["member-1"]);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { recurringReport: recurring, items: [recurring] }, error: null, meta: {} }));
      return;
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: null, error: { code: "not_found", message: "Not found" }, meta: {} }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    apiUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function createTimesheetsServer(): Promise<{ apiUrl: string; close: () => Promise<void> }> {
  const members = [
    { id: "member-1", name: "Alice Field", username: "alice@example.com", email: "alice@example.com" }
  ];
  const entry = {
    id: "clock-in-1_clock-out-1",
    member: members[0],
    date: "2026-05-28",
    clockIn: { id: "clock-in-1", timestamp: 1779957000000, time: "08:30", type: 2, isClockIn: true },
    clockOut: { id: "clock-out-1", timestamp: 1779988500000, time: "17:15", type: -2, isClockIn: false },
    durationSeconds: 31500,
    open: false
  };
  const response = {
    items: [entry],
    summary: {
      totalSeconds: 31500,
      entryCount: 1,
      openEntryCount: 0,
      memberCount: 1
    }
  };
  const server = http.createServer(async (req, res) => {
    if (req.headers["api-key"] !== "secret") {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: null, error: { code: "invalid_api_key", message: "Invalid API key" }, meta: {} }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> : {};
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/members" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { items: members }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/timesheets" && req.method === "GET") {
      assert.equal(url.searchParams.get("date"), "2026-05-28");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: response, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/timesheets/entries" && req.method === "POST") {
      assert.equal(body.memberId, "member-1");
      assert.equal(body.date, "2026-05-28");
      assert.equal(body.clockIn, "08:30");
      assert.equal(body.clockOut, "17:15");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { entry }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/timesheets/entries/clock-in-1_clock-out-1" && req.method === "PATCH") {
      assert.equal(body.clockIn, "08:45");
      assert.equal(body.clockOut, "17:00");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { entry: { ...entry, clockIn: { ...entry.clockIn, time: "08:45" }, clockOut: { ...entry.clockOut, time: "17:00" } } }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/timesheets/entries/clock-in-1_clock-out-1" && req.method === "DELETE") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { id: "clock-in-1_clock-out-1", deleted: true }, error: null, meta: {} }));
      return;
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: null, error: { code: "not_found", message: "Not found" }, meta: {} }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    apiUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function createFormsServer(): Promise<{ apiUrl: string; close: () => Promise<void> }> {
  const template = {
    id: "template-1",
    title: "Safety check",
    description: "Daily safety checklist",
    status: 1,
    updatedAt: "2026-05-28T08:00:00Z",
    content: [
      { type: "section", name: "Vehicle" },
      { type: "text", name: "vehicle_id", label: "Vehicle ID", required: true },
      { type: "radio", name: "condition", label: "Condition", required: true, options: ["ok", "needs_service"] },
      { type: "signature", name: "signature", label: "Signature" }
    ]
  };
  const member = { id: "member-1", name: "Alice Field", username: "alice@example.com", email: "alice@example.com" };
  const place = { id: "place-1", name: "Acme HQ", address: "Main Street 1" };
  const job = { id: "job-1", externalId: "WO-1001", title: "Install" };
  const submission = {
    id: "submission-1",
    templateId: "template-1",
    title: "Safety check",
    createdAt: "2026-05-28T09:00:00Z",
    submittedBy: member,
    jobId: "job-1",
    placeId: "place-1",
    content: template.content,
    answers: {
      vehicle_id: "VAN-9",
      condition: "ok"
    },
    completion: { answered: 2, fields: 3 }
  };
  const server = http.createServer(async (req, res) => {
    if (req.headers["api-key"] !== "secret") {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: null, error: { code: "invalid_api_key", message: "Invalid API key" }, meta: {} }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    const rawBody = Buffer.concat(chunks);
    const contentType = String(req.headers["content-type"] ?? "");
    const body = rawBody.length > 0 && contentType.includes("application/json")
      ? JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>
      : {};
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/forms/templates" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { items: [template] }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/forms/templates/template-1" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { template }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/forms/templates" && req.method === "POST") {
      assert.equal(body.title, "Safety check");
      assert.ok(Array.isArray(body.content));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { template: { ...body, id: "template-created", updatedAt: "2026-05-28T10:00:00Z" } }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/forms/templates/template-1" && req.method === "PATCH") {
      assert.equal(body.title, "Safety check");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { template: { ...template, ...body, id: "template-1" } }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/forms/templates/template-1" && req.method === "DELETE") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { id: "template-1", deleted: true }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/forms/submissions" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { items: [submission] }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/forms/submissions/submission-1" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { submission }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/forms/submissions" && req.method === "POST") {
      assert.equal(body.templateId, "template-1");
      assert.equal(body.memberId, "member-1");
      assert.equal(body.jobId, "job-1");
      if (body.content !== undefined) {
        const content = body.content as { content?: unknown };
        assert.ok(content && typeof content === "object" && !Array.isArray(content));
        assert.ok(Array.isArray(content.content));
      } else {
        assert.deepEqual(body.values, { vehicle_id: "VAN-10", condition: "ok" });
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { submission: { ...submission, id: "submission-created", answers: body.values } }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/forms/attachments" && req.method === "POST") {
      assert.match(contentType, /^multipart\/form-data; boundary=/);
      assert.match(rawBody.toString("utf8"), /filename="proof.txt"/);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { field: "signature", filename: "proof.txt", path: "/uploads/proof.txt", url: "https://files.example/proof.txt", value: "[{\"url\":\"https://files.example/proof.txt\",\"name\":\"proof.txt\"}]" }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/forms/links" && req.method === "GET") {
      assert.equal(url.searchParams.get("targetType"), "job");
      assert.equal(url.searchParams.get("targetId"), "job-1");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { targetType: "job", targetId: "job-1", linkedForms: [{ id: "template-1", title: "Safety check" }] }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/forms/links" && req.method === "POST") {
      assert.equal(body.targetType, "job");
      assert.equal(body.targetId, "job-1");
      assert.equal(body.templateId, "template-1");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { targetType: "job", targetId: "job-1", linkedForms: [{ id: "template-1", title: "Safety check" }] }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/forms/links" && req.method === "DELETE") {
      assert.equal(url.searchParams.get("targetType"), "job");
      assert.equal(url.searchParams.get("targetId"), "job-1");
      assert.equal(url.searchParams.get("templateId"), "template-1");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { targetType: "job", targetId: "job-1", linkedForms: [] }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/members" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { items: [member] }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/places" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { items: [place] }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/jobs/job-1" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { items: [job] }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/jobs" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { items: [job] }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/reports/generate" && req.method === "POST") {
      assert.equal(body.type, "formsubmissions");
      assert.equal(body.formTemplateId, "template-1");
      assert.ok(Array.isArray(body.memberIds) && body.memberIds.length > 0);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=\"form-submissions.csv\"");
      res.setHeader("X-HT-Report-ID", "report-forms-1");
      res.setHeader("X-HT-Report-Type", "formsubmissions");
      res.setHeader("X-HT-Report-Format", "csv");
      res.end("id,vehicle_id\nsubmission-1,VAN-9\n");
      return;
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: null, error: { code: "not_found", message: `Not found: ${req.method} ${url.pathname}` }, meta: {} }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    apiUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function createAlertsServer(): Promise<{ apiUrl: string; close: () => Promise<void> }> {
  const member = { id: "member-1", name: "Alice Field", username: "alice@example.com", email: "alice@example.com" };
  const place = { id: "place-1", name: "Acme HQ", address: "Main Street 1" };
  const zone = { id: "zone-1", name: "Restricted", title: "Restricted", color: "#dd3333", pointCount: 4 };
  const config = {
    id: "alert-1",
    title: "Missing check-out",
    description: "",
    action: "no_check_out",
    actionCode: 5,
    memberIds: ["member-1"],
    teamIds: [],
    placeIds: ["place-1"],
    andPlaceIds: [],
    zoneIds: [],
    zones: [],
    emails: ["ops@example.com"],
    phone: "",
    slackChannelId: "",
    weekdays: 31,
    weekdayNames: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    timeStart: "08:00",
    timeEnd: "18:00",
    status: 0,
    statusText: "active",
    duration: "",
    intervalMs: 0
  };
  const instance = {
    id: "instance-1",
    message: "Alice Field did not check out",
    createdAt: 1779988500000,
    tsCreated: 1779988500000,
    configId: "alert-1",
    config: "alert-1",
    configTitle: "Missing check-out",
    status: 0,
    statusText: "new"
  };
  const server = http.createServer(async (req, res) => {
    if (req.headers["api-key"] !== "secret") {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: null, error: { code: "invalid_api_key", message: "Invalid API key" }, meta: {} }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> : {};
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/alerts/actions" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        data: {
          items: [
            { name: "no_check_out", code: 5, label: "Does not check out", requiresPlace: true, requiresDuration: false, requiresZone: false, supportsAndCondition: false },
            { name: "enters_zone", code: 8, label: "Enters zone", requiresPlace: false, requiresDuration: false, requiresZone: true, supportsAndCondition: false }
          ]
        },
        error: null,
        meta: {}
      }));
      return;
    }
    if (url.pathname === "/zones" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { items: [zone] }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/members" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { items: [member] }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/places" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { items: [place] }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/company" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { company: { id: "company-1", name: "Acme", teamsConfig: [{ id: 1, name: "North" }] } }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/alerts/configs" && req.method === "GET") {
      assert.equal(url.searchParams.get("status") ?? "active", "active");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { items: [config] }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/alerts/configs/alert-1" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { config }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/alerts/configs" && req.method === "POST") {
      assert.equal(body.title, "Zone entry");
      assert.equal(body.action, "enters_zone");
      assert.deepEqual(body.memberIds, ["member-1"]);
      assert.deepEqual(body.zoneIds, ["zone-1"]);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { config: { ...config, ...body, id: "alert-created", statusText: "active" } }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/alerts/configs/alert-1" && req.method === "PATCH") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { config: { ...config, ...body, id: "alert-1", statusText: body.status === "paused" ? "paused" : "active" } }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/alerts/configs/alert-1" && req.method === "DELETE") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { id: "alert-1", deleted: true }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/alerts/instances" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { items: [instance] }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/alerts/instances/instance-1" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { instance }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/alerts/instances/instance-1" && req.method === "PATCH") {
      assert.ok(["acknowledged", "archived"].includes(String(body.status)));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { instance: { ...instance, statusText: String(body.status) } }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/alerts/instances/instance-1" && req.method === "DELETE") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { id: "instance-1", deleted: true }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/reports/generate" && req.method === "POST") {
      assert.equal(body.type, "alerts");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=\"alerts-report.csv\"");
      res.setHeader("X-HT-Report-ID", "report-alerts-1");
      res.setHeader("X-HT-Report-Type", "alerts");
      res.setHeader("X-HT-Report-Format", "csv");
      res.end("id,message\ninstance-1,Alice Field did not check out\n");
      return;
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: null, error: { code: "not_found", message: `Not found: ${req.method} ${url.pathname}` }, meta: {} }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    apiUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function createMapsServer(): Promise<{ apiUrl: string; close: () => Promise<void> }> {
  const member = { id: "member-1", name: "Alice Field", username: "alice@example.com", email: "alice@example.com" };
  const place = { id: "place-1", name: "Acme HQ", address: "Main Street 1" };
  const geojson = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[9.6, 47.2], [9.7, 47.3]] },
        properties: { kind: "track", color: "#2563eb", width: 4 }
      }
    ],
    count: 1
  };
  const multiGeojson = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [9.6, 47.2] },
        properties: { kind: "member", htLayerId: "members", htLayerKind: "members", htLayerTitle: "Members" }
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [9.61, 47.21] },
        properties: { kind: "place", htLayerId: "places", htLayerKind: "places", htLayerTitle: "Places" }
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [9.62, 47.22] },
        properties: { kind: "job", htLayerId: "jobs", htLayerKind: "jobs", htLayerTitle: "Jobs" }
      }
    ],
    count: 3
  };
  const multiLayers = [
    { id: "members", kind: "members", title: "Members", featureCount: 1 },
    { id: "places", kind: "places", title: "Places", featureCount: 1 },
    { id: "jobs", kind: "jobs", title: "Jobs", featureCount: 1 }
  ];
  const share = {
    id: "map_abc123",
    token: "map_abc123",
    url: "https://live.hellotracks.com/share/maps/map_abc123",
    apiUrl: "https://api.hellotracks.com/api/share/maps/map_abc123",
    title: "Alice trips",
    kind: "trips",
    companyName: "Acme",
    createdAt: 1779988500000,
    expiresAt: 1780074900000,
    revokedAt: 0,
    featureCount: 1,
    hasMore: false,
    aborted: false
  };
  const server = http.createServer(async (req, res) => {
    if (req.headers["api-key"] !== "secret") {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: null, error: { code: "invalid_api_key", message: "Invalid API key" }, meta: {} }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> : {};
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/maps/layers" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        data: {
          items: [
            { kind: "members", label: "Members", requiresMember: false, supportsDateRange: false, supportsPlaces: false },
            { kind: "places", label: "Places", requiresMember: false, supportsDateRange: false, supportsPlaces: true },
            { kind: "jobs", label: "Jobs", requiresMember: false, supportsDateRange: false, supportsPlaces: false },
            { kind: "trips", label: "Trips", requiresMember: true, supportsDateRange: true, supportsPlaces: false },
            { kind: "heatmap", label: "Heatmap", requiresMember: false, supportsDateRange: true, supportsPlaces: false }
          ]
        },
        error: null,
        meta: {}
      }));
      return;
    }
    if (url.pathname === "/members" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { items: [member] }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/places" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { items: [place] }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/maps/render" && req.method === "POST") {
      const isMulti = Array.isArray(body.layers);
      if (isMulti) {
        assert.deepEqual((body.layers as Array<{ kind: string }>).map((layer) => layer.kind), ["members", "places", "jobs"]);
        assert.equal(body.title, undefined);
      } else {
        assert.equal(body.kind, "trips");
        assert.equal(body.memberId, "member-1");
        assert.equal(body.date, "2026-05-28");
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        data: {
          map: {
            kind: isMulti ? "multi" : "trips",
            generatedAt: 1779988500000,
            spec: body,
            summary: {
              featureCount: isMulti ? 3 : 1,
              count: isMulti ? 3 : 1,
              hasMore: false,
              aborted: false,
              bounds: { minLng: 9.6, minLat: 47.2, maxLng: 9.7, maxLat: 47.3 },
              ...(isMulti ? { layers: multiLayers } : {})
            },
            layers: isMulti ? multiLayers : undefined,
            geojson: isMulti ? multiGeojson : geojson
          }
        },
        error: null,
        meta: {}
      }));
      return;
    }
    if (url.pathname === "/maps/shares" && req.method === "POST") {
      const isMulti = Array.isArray(body.layers);
      if (isMulti) {
        assert.deepEqual((body.layers as Array<{ kind: string }>).map((layer) => layer.kind), ["members", "places", "jobs"]);
      } else if (body.kind === "members") {
        assert.equal(body.memberId, undefined);
      } else {
        assert.equal(body.kind, "trips");
        assert.equal(body.memberId, "member-1");
      }
      assert.ok(["24h", "7d"].includes(String(body.expires)));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { share: { ...share, kind: isMulti ? "multi" : body.kind, title: body.title || share.title, featureCount: isMulti ? 3 : 1, layers: isMulti ? multiLayers : undefined } }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/maps/shares" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { items: [share] }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/maps/shares/map_abc123" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { share }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/maps/shares/map_abc123" && req.method === "DELETE") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { id: "map_abc123", revoked: true }, error: null, meta: {} }));
      return;
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: null, error: { code: "not_found", message: `Not found: ${req.method} ${url.pathname}` }, meta: {} }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    apiUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function createEtaServer(): Promise<{ apiUrl: string; close: () => Promise<void> }> {
  const session = {
    id: "eta_123",
    token: "7k4q9m2pq8rw",
    jobId: "job-123",
    recipientName: "Sam",
    recipientPhone: "+15551234567",
    recipientEmail: "sam@example.com",
    title: "Service visit",
    status: "assigned",
    recipientStatus: "viewed",
    etaWindowStart: 1780657200000,
    etaWindowEnd: 1780660800000,
    etaConfidence: "scheduled",
    showWorkerName: false,
    showMap: false,
    publicUrl: "https://eta.page/7K4Q-9M2P-Q8RW",
    apiUrl: "https://api.hellotracks.com/api/eta/7k4q9m2pq8rw",
    viewedAt: 1780650000000,
    readyConfirmedAt: 0,
    accessNotes: "",
    rescheduleRequestedAt: 0,
    createdAt: 1780640000000,
    expiresAt: 1783232000000,
    revokedAt: 0
  };
  const server = http.createServer(async (req, res) => {
    if (req.headers["api-key"] !== "secret") {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: null, error: { code: "invalid_api_key", message: "Invalid API key" }, meta: {} }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> : {};
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/eta/sessions" && req.method === "POST") {
      assert.equal(body.jobId, "job-123");
      if (body.title === "Hidden visibility") {
        assert.equal(body.showWorkerName, false);
        assert.equal(body.showMap, false);
      } else {
        assert.equal(Object.prototype.hasOwnProperty.call(body, "showWorkerName"), false);
        assert.equal(Object.prototype.hasOwnProperty.call(body, "showMap"), false);
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { session }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/eta/sessions" && req.method === "GET") {
      assert.equal(url.searchParams.get("date"), "today");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { items: [session] }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/eta/sessions/eta_123" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { session }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/eta/sessions/eta_123" && req.method === "PATCH") {
      assert.equal(body.showWorkerName, true);
      assert.equal(body.showMap, true);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { session: { ...session, showWorkerName: true, showMap: true } }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/eta/sessions/eta_123/refresh" && req.method === "POST") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { session: { ...session, etaConfidence: "live" } }, error: null, meta: {} }));
      return;
    }
    if (url.pathname === "/eta/sessions/eta_123/events" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        data: {
          items: [
            { id: "evt-1", sessionId: "eta_123", type: "viewed", actor: "recipient", createdAt: 1780650000000, detail: {} }
          ]
        },
        error: null,
        meta: {}
      }));
      return;
    }
    if (url.pathname === "/eta/sessions/eta_123" && req.method === "DELETE") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { id: "eta_123", token: "7k4q9m2pq8rw", revoked: true }, error: null, meta: {} }));
      return;
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: null, error: { code: "not_found", message: `Not found: ${req.method} ${url.pathname}` }, meta: {} }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    apiUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

test("parseInvocation extracts global options and positionals", () => {
  const parsed = parseInvocation(["--profile", "qa", "--api-url=https://staging.example.com/v1", "--no-update-check", "members", "list"]);
  assert.equal(parsed.globalOptions.profile, "qa");
  assert.equal(parsed.globalOptions.apiUrl, "https://staging.example.com/v1");
  assert.equal(parsed.globalOptions.updateCheck, false);
  assert.deepEqual(parsed.positionalArgs, ["members", "list"]);
});

test("version uses -v as the short flag", async () => {
  const result = await runCli(["-v"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /^\d+\.\d+\.\d+/);

  const help = await runCli(["--help"]);
  assert.equal(help.exitCode, 0);
  assert.match(help.stdout, /-v, --version/);
  assert.doesNotMatch(help.stdout, /-V, --version/);
});

test("default invocation prints help instead of launching an interactive surface", async () => {
  const result = await runCli([]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Hellotracks CLI/);
  assert.doesNotMatch(result.stdout, /\btui\b/);
  assert.doesNotMatch(result.stdout, /\bshell\b/);
  assert.doesNotMatch(result.stdout, /^  agent\s/m);
});

test("update command is available", async () => {
  const result = await runCli(["update", "--help"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Check for and install a newer ht-cli release/);
  assert.match(result.stdout, /--check/);
  assert.match(result.stdout, /--force/);
});

test("maps commands expose map snapshot workflows", async () => {
  const result = await runCli(["maps", "--help"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Inspect, export, open, and share/);
  assert.match(result.stdout, /layers/);
  assert.match(result.stdout, /export/);
  assert.match(result.stdout, /share/);
  assert.match(result.stdout, /viewer/);
  assert.match(result.stdout, /shares/);
});

test("maps layers, export, share, open no-open, and revoke work", async () => {
  const server = await createMapsServer();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ht-maps-"));
  const geojsonFile = path.join(tempDir, "trips.geojson");
  const snapshotFile = path.join(tempDir, "snapshot.geojson");
  try {
    const layers = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "maps", "layers"]);
    assert.equal(layers.exitCode, 0);
    assert.match(layers.stdout, /members/);
    assert.match(layers.stdout, /jobs/);
    assert.match(layers.stdout, /trips/);
    assert.match(layers.stdout, /Heatmap/);

    const exported = await runCli([
      "--api-url", server.apiUrl,
      "--api-key", "secret",
      "maps", "export", "trips",
      "--member", "alice@example.com",
      "--date", "2026-05-28",
      "--file", geojsonFile
    ]);
    assert.equal(exported.exitCode, 0);
    assert.match(exported.stdout, /trips.geojson/);
    const filePayload = JSON.parse(await fs.readFile(geojsonFile, "utf8")) as { type: string; features: unknown[] };
    assert.equal(filePayload.type, "FeatureCollection");
    assert.equal(filePayload.features.length, 1);

    const exportedMulti = await runCli([
      "--api-url", server.apiUrl,
      "--api-key", "secret",
      "maps", "export", "members", "places", "jobs",
      "--file", snapshotFile
    ]);
    assert.equal(exportedMulti.exitCode, 0);
    assert.match(exportedMulti.stdout, /Saved/);
    assert.match(exportedMulti.stdout, /ht maps viewer/);
    const multiPayload = JSON.parse(await fs.readFile(snapshotFile, "utf8")) as { type: string; features: Array<{ properties?: Record<string, unknown> }> };
    assert.equal(multiPayload.type, "FeatureCollection");
    assert.equal(multiPayload.features.length, 3);
    assert.deepEqual(multiPayload.features.map((feature) => feature.properties?.htLayerKind), ["members", "places", "jobs"]);

    const share = await runCli([
      "--api-url", server.apiUrl,
      "--api-key", "secret",
      "maps", "share", "trips",
      "--member", "alice@example.com",
      "--date", "2026-05-28",
      "--title", "Alice trips",
      "--expires", "7d"
    ]);
    assert.equal(share.exitCode, 0);
    assert.match(share.stdout, /https:\/\/live\.hellotracks\.com\/share\/maps\/map_abc123/);
    assert.match(share.stdout, /Anyone with the URL/);

    const membersShare = await runCli([
      "--api-url", server.apiUrl,
      "--api-key", "secret",
      "maps", "share", "members",
      "--title", "Current team locations"
    ]);
    assert.equal(membersShare.exitCode, 0);
    assert.match(membersShare.stdout, /kind: members/);
    assert.match(membersShare.stdout, /Current team locations/);

    const multiShare = await runCli([
      "--api-url", server.apiUrl,
      "--api-key", "secret",
      "maps", "share", "members", "places", "jobs",
      "--title", "Snapshot June 6"
    ]);
    assert.equal(multiShare.exitCode, 0);
    assert.match(multiShare.stdout, /kind: multi/);
    assert.match(multiShare.stdout, /Snapshot June 6/);
    assert.match(multiShare.stdout, /Members/);
    assert.match(multiShare.stdout, /Jobs/);

    const opened = await runCli([
      "--api-url", server.apiUrl,
      "--api-key", "secret",
      "--no-input",
      "maps", "open", "trips",
      "--member", "alice@example.com",
      "--date", "2026-05-28",
      "--no-open"
    ]);
    assert.equal(opened.exitCode, 0);
    assert.match(opened.stdout, /map_abc123/);

    const viewer = await runCli(["--no-input", "maps", "viewer", "--no-open"]);
    assert.equal(viewer.exitCode, 0);
    assert.match(viewer.stdout, /https:\/\/live\.hellotracks\.com\/share\/maps\/viewer/);

    const shares = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "maps", "shares", "list"]);
    assert.equal(shares.exitCode, 0);
    assert.match(shares.stdout, /map_abc123/);

    const denied = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "--no-input", "maps", "shares", "revoke", "map_abc123"]);
    assert.equal(denied.exitCode, 1);
    assert.match(denied.stderr, /Re-run with --yes/);

    const revoked = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "--yes", "maps", "shares", "revoke", "map_abc123"]);
    assert.equal(revoked.exitCode, 0);
    assert.match(revoked.stdout, /revoked/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    await server.close();
  }
});

test("eta commands create, list, update, refresh, show events, snippets, and revoke", async () => {
  const server = await createEtaServer();
  try {
    const help = await runCli(["eta", "--help"]);
    assert.equal(help.exitCode, 0);
    assert.match(help.stdout, /Create and manage ETA pages/);
    assert.match(help.stdout, /snippet/);
    assert.match(help.stdout, /revoke/);

    const created = await runCli([
      "--api-url", server.apiUrl,
      "--api-key", "secret",
      "eta", "create",
      "--job", "job-123",
      "--recipient-name", "Sam",
      "--title", "Service visit"
    ]);
    assert.equal(created.exitCode, 0);
    assert.match(created.stdout, /https:\/\/eta\.page\/7K4Q-9M2P-Q8RW/);
    assert.match(created.stdout, /showWorkerName: false/);
    assert.match(created.stdout, /showMap: false/);

    const hidden = await runCli([
      "--api-url", server.apiUrl,
      "--api-key", "secret",
      "eta", "create",
      "--job", "job-123",
      "--title", "Hidden visibility",
      "--hide-worker-name",
      "--hide-map"
    ]);
    assert.equal(hidden.exitCode, 0);

    const list = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "eta", "list", "--date", "today"]);
    assert.equal(list.exitCode, 0);
    assert.match(list.stdout, /eta_123/);
    assert.match(list.stdout, /Sam/);

    const updated = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "eta", "update", "eta_123", "--show-worker-name", "--show-map"]);
    assert.equal(updated.exitCode, 0);
    assert.match(updated.stdout, /showWorkerName: true/);
    assert.match(updated.stdout, /showMap: true/);

    const refreshed = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "eta", "refresh", "eta_123"]);
    assert.equal(refreshed.exitCode, 0);
    assert.match(refreshed.stdout, /eta_123/);

    const events = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "eta", "events", "eta_123"]);
    assert.equal(events.exitCode, 0);
    assert.match(events.stdout, /viewed/);

    const snippet = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "eta", "snippet", "eta_123", "--format", "email"]);
    assert.equal(snippet.exitCode, 0);
    assert.match(snippet.stdout, /Subject: Arrival details/);
    assert.match(snippet.stdout, /https:\/\/eta\.page\/7K4Q-9M2P-Q8RW/);

    const denied = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "--no-input", "eta", "revoke", "eta_123"]);
    assert.equal(denied.exitCode, 1);
    assert.match(denied.stderr, /Re-run with --yes/);

    const revoked = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "--yes", "eta", "revoke", "eta_123"]);
    assert.equal(revoked.exitCode, 0);
    assert.match(revoked.stdout, /revoked/);
  } finally {
    await server.close();
  }
});

test("jobs list and routing optimize send today as a calendar date", async () => {
  const seen: Array<{ url: string; body: string }> = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk);
    });
    req.on("end", () => {
      seen.push({ url: req.url ?? "", body });
      res.setHeader("Content-Type", "application/json");
      const data = req.url?.startsWith("/routing/") ? { result: {} } : { items: [] };
      res.end(JSON.stringify({ data, error: null, meta: {} }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const apiUrl = `http://127.0.0.1:${address.port}`;
  try {
    const list = await runCli(["--api-url", apiUrl, "--api-key", "secret", "--json", "jobs", "list", "--date", "today"]);
    assert.equal(list.exitCode, 0, list.stderr);
    const optimize = await runCli(["--api-url", apiUrl, "--api-key", "secret", "--json", "--no-input", "routing", "optimize", "--account", "alice", "--date", "yesterday"]);
    assert.equal(optimize.exitCode, 0, optimize.stderr);
    const listDate = new URL(seen[0]?.url ?? "", apiUrl).searchParams.get("date");
    assert.match(listDate ?? "", /^\d{4}-\d{2}-\d{2}$/);
    assert.match(String(JSON.parse(seen[1]?.body ?? "{}").date), /^\d{4}-\d{2}-\d{2}$/);

    const unassigned = await runCli(["--api-url", apiUrl, "--api-key", "secret", "--json", "jobs", "list", "--unassigned"]);
    assert.equal(unassigned.exitCode, 0, unassigned.stderr);
    assert.equal(new URL(seen[2]?.url ?? "", apiUrl).searchParams.get("assigneeUsername"), "");
    const assigned = await runCli(["--api-url", apiUrl, "--api-key", "secret", "--json", "jobs", "list", "--assigned"]);
    assert.equal(assigned.exitCode, 0, assigned.stderr);
    assert.equal(new URL(seen[3]?.url ?? "", apiUrl).searchParams.get("assigneeUsername"), "+");

    const since = await runCli(["--api-url", apiUrl, "--api-key", "secret", "--json", "jobs", "list", "--updated-since", "2026-05-20T00:00:00Z"]);
    assert.equal(since.exitCode, 0, since.stderr);
    assert.equal(new URL(seen[4]?.url ?? "", apiUrl).searchParams.get("updatedSince"), String(Date.parse("2026-05-20T00:00:00Z")));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("webhooks set checks the event name and keeps saved headers unless --header is given", async () => {
  const bodies: unknown[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk);
    });
    req.on("end", () => {
      if (body) {
        bodies.push(JSON.parse(body));
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { webhooks: {} }, error: null, meta: {} }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const apiUrl = `http://127.0.0.1:${address.port}`;
  try {
    const unknown = await runCli(["--api-url", apiUrl, "--api-key", "secret", "webhooks", "set", "--event", "job.finished", "--url", "https://example.com/hook"]);
    assert.notEqual(unknown.exitCode, 0);
    assert.match(unknown.stderr, /Unknown webhook event/);
    assert.equal(bodies.length, 0);

    const dotted = await runCli(["--api-url", apiUrl, "--api-key", "secret", "webhooks", "set", "--event", "job.updated", "--url", "https://example.com/hook"]);
    assert.equal(dotted.exitCode, 0, dotted.stderr);
    assert.deepEqual(bodies[0], { webhooks: { job_updated: { url: "https://example.com/hook" } } });

    const disabled = await runCli(["--api-url", apiUrl, "--api-key", "secret", "webhooks", "set", "--event", "alert_triggered", "--disable"]);
    assert.equal(disabled.exitCode, 0, disabled.stderr);
    assert.deepEqual(bodies[1], { webhooks: { alert_triggered: { url: "", headers: {} } } });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("reports run waits for the background run and downloads its file; saved reports pause with every field kept", async () => {
  const requests: Array<{ method: string; url: string; body: Record<string, unknown> }> = [];
  let polls = 0;
  const savedReport = {
    id: "saved-1",
    classic: false,
    name: "Weekly hours",
    report: "timesheet",
    request: { report: "timesheet", period: "lastWeek" },
    formats: ["xlsx"],
    schedule: { frequency: "week", weekdays: [], weekday: 1, monthDay: 1, hour: 7, minute: 0 },
    recipients: { memberUids: ["member-1"], emails: [] },
    delivery: "attach",
    status: "active"
  };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk);
    });
    req.on("end", () => {
      const url = req.url ?? "";
      requests.push({ method: req.method ?? "", url, body: raw ? JSON.parse(raw) as Record<string, unknown> : {} });
      const address = server.address();
      const base = address && typeof address === "object" ? `http://127.0.0.1:${address.port}` : "";
      const send = (status: number, data: unknown) => {
        res.statusCode = status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ data, error: null, meta: {} }));
      };
      if (url === "/files/timesheet.csv") {
        res.setHeader("Content-Type", "text/csv");
        res.end("member,hours\nAlice,38\n");
        return;
      }
      if (url === "/reports/catalog") {
        send(200, { reports: [{ id: "timesheet", title: "Timesheet", formats: ["xlsx", "csv"], defaultPeriod: "lastWeek", maxDays: 120, views: [{ id: "perPerson" }] }] });
        return;
      }
      if (url === "/reports/run" && req.method === "POST") {
        send(202, { run: { id: "run-1", status: "queued", files: [] } });
        return;
      }
      if (url === "/reports/run/run-1") {
        polls += 1;
        send(200, { run: { id: "run-1", status: polls > 1 ? "done" : "running", files: polls > 1 ? [{ id: "file-1", name: "timesheet.csv", format: "csv", bytes: 22, url: `${base}/files/timesheet.csv` }] : [] } });
        return;
      }
      if (url === "/reports/saved" && req.method === "GET") {
        send(200, { saved: [savedReport], classic: [] });
        return;
      }
      if (url === "/reports/saved/saved-1" && req.method === "PATCH") {
        send(200, { saved: { ...savedReport, status: "paused" } });
        return;
      }
      send(404, null);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const apiUrl = `http://127.0.0.1:${address.port}`;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ht-reports-run-"));
  try {
    const catalog = await runCli(["--api-url", apiUrl, "--api-key", "secret", "reports", "catalog"]);
    assert.equal(catalog.exitCode, 0, catalog.stderr);
    assert.match(catalog.stdout, /timesheet/);
    assert.match(catalog.stdout, /perPerson/);

    const run = await runCli(["--api-url", apiUrl, "--api-key", "secret", "reports", "run", "timesheet", "--from", "2026-10-01", "--until", "2026-10-31", "--format", "csv", "--dir", tempDir]);
    assert.equal(run.exitCode, 0, run.stderr);
    assert.equal(await fs.readFile(path.join(tempDir, "timesheet.csv"), "utf8"), "member,hours\nAlice,38\n");
    const start = requests.find((entry) => entry.url === "/reports/run");
    assert.deepEqual(start?.body, { request: { report: "timesheet", fromDay: 20261001, untilDay: 20261031 }, formats: ["csv"] });

    const pause = await runCli(["--api-url", apiUrl, "--api-key", "secret", "--json", "reports", "saved", "pause", "saved-1"]);
    assert.equal(pause.exitCode, 0, pause.stderr);
    const patch = requests.find((entry) => entry.method === "PATCH");
    assert.equal(patch?.body.status, "paused");
    assert.deepEqual(patch?.body.recipients, savedReport.recipients);
    assert.deepEqual(patch?.body.schedule, savedReport.schedule);
    assert.deepEqual(patch?.body.request, savedReport.request);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("members create sends the fields create does not save as an update, and update refuses a username change", async () => {
  const requests: Array<{ method: string; url: string; body: Record<string, unknown> }> = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk);
    });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      requests.push({ method: req.method ?? "", url: req.url ?? "", body });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { member: { id: "member-9", ...body } }, error: null, meta: {} }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const apiUrl = `http://127.0.0.1:${address.port}`;
  try {
    const create = await runCli(["--api-url", apiUrl, "--api-key", "secret", "--json", "--no-input", "members", "create", "--username", "bob@example.com", "--name", "Bob", "--timezone", "Europe/Vienna", "--route-start-time", "07:30"]);
    assert.equal(create.exitCode, 0, create.stderr);
    assert.equal(requests[0]?.method, "POST");
    assert.equal(requests[1]?.method, "PATCH");
    assert.equal(requests[1]?.url, "/members/member-9");
    assert.deepEqual(requests[1]?.body, { timezone: "Europe/Vienna", routeStartTime: 730 });

    const password = await runCli(["--api-url", apiUrl, "--api-key", "secret", "members", "update", "member-9", "--password", "secret-1"]);
    assert.notEqual(password.exitCode, 0);
    assert.match(password.stderr, /cannot change a member's password/);
    assert.equal(requests.length, 2);

    const rename = await runCli(["--api-url", apiUrl, "--api-key", "secret", "--json", "members", "update", "member-9", "--username", "robert@example.com"]);
    assert.equal(rename.exitCode, 0, rename.stderr);
    assert.deepEqual(requests[2]?.body, { username: "robert@example.com" });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("signup and auth login --email work without a key, store the issued key, and never print it", async () => {
  const issuedKey = "k1234567.0123456789abcdef";
  const requests: Array<{ method: string; url: string; apiKey: string | undefined; body: Record<string, unknown> }> = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk);
    });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      const apiKey = req.headers["api-key"] as string | undefined;
      requests.push({ method: req.method ?? "", url: req.url ?? "", apiKey, body });
      res.setHeader("Content-Type", "application/json");
      const issued = { apiKey: issuedKey, apiKeyExpiresAt: Date.UTC(2027, 0, 31), accountId: "p1", username: "sam@acme.com", companyId: "c1", companyName: "Acme Plumbing" };
      if (req.url === "/signup" || req.url === "/auth/email-code") {
        res.statusCode = 202;
        res.end(JSON.stringify({ data: { email: body.email, codeExpiresInSeconds: 1800 }, error: null, meta: {} }));
      } else if ((req.url === "/signup/verify" || req.url === "/auth/email-code/verify") && body.code === "482913") {
        res.end(JSON.stringify({ data: issued, error: null, meta: {} }));
      } else if (req.url === "/signup/verify" || req.url === "/auth/email-code/verify") {
        res.statusCode = 400;
        res.end(JSON.stringify({ data: null, error: { code: "invalid_request", message: "The code is wrong or expired. Attempts left: 4." }, meta: {} }));
      } else if (req.url === "/auth/whoami" && apiKey === issuedKey) {
        res.end(JSON.stringify({ data: { account: { id: "p1", username: "sam@acme.com" }, company: { id: "c1", name: "Acme Plumbing" } }, error: null, meta: {} }));
      } else {
        res.statusCode = 401;
        res.end(JSON.stringify({ data: null, error: { code: "invalid_api_key", message: "Invalid API key" }, meta: {} }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const apiUrl = `http://127.0.0.1:${address.port}`;
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "ht-signup-"));
  const env = { HOME: home, HT_CLI_CREDENTIAL_STORE: "private-file", HELLOTRACKS_API_KEY: "", HELLOTRACKS_API_KEY_FILE: "", HT_CLI_AUTO_UPDATE_CHECK: "0" };
  try {
    const noTerms = await runCli(["--api-url", apiUrl, "--no-input", "signup", "--email", "sam@acme.com", "--name", "Sam Lee", "--company", "Acme Plumbing", "--address", "1 Ferry Building, San Francisco"], env);
    assert.notEqual(noTerms.exitCode, 0);
    assert.match(noTerms.stderr, /terms-of-service/);
    assert.equal(requests.length, 0);

    const start = await runCli(["--api-url", apiUrl, "--no-input", "--json", "signup", "--email", "sam@acme.com", "--name", "Sam Lee", "--company", "Acme Plumbing", "--address", "1 Ferry Building, San Francisco", "--timezone", "America/Los_Angeles", "--accept-terms"], env);
    assert.equal(start.exitCode, 0, start.stderr);
    assert.equal(JSON.parse(start.stdout).next, "ht signup --code <code>");
    assert.equal(requests[0]?.url, "/signup");
    assert.equal(requests[0]?.apiKey, undefined);
    assert.deepEqual(requests[0]?.body, { email: "sam@acme.com", name: "Sam Lee", timezone: "America/Los_Angeles", acceptTerms: true });

    const wrong = await runCli(["--api-url", apiUrl, "--no-input", "signup", "--code", "111111"], env);
    assert.equal(wrong.exitCode, 3, wrong.stderr);
    assert.match(wrong.stderr, /Attempts left: 4/);

    const finish = await runCli(["--api-url", apiUrl, "--no-input", "signup", "--code", "482913"], env);
    assert.equal(finish.exitCode, 0, finish.stderr);
    const verify = requests.find((entry) => entry.url === "/signup/verify" && entry.body.code === "482913");
    assert.deepEqual(verify?.body.company, { name: "Acme Plumbing", address: "1 Ferry Building, San Francisco" });
    assert.match(finish.stdout + finish.stderr, /Signed in as sam@acme.com for Acme Plumbing/);
    assert.doesNotMatch(finish.stdout + finish.stderr, /0123456789abcdef/);

    const whoami = await runCli(["--api-url", apiUrl, "--json", "auth", "whoami"], env);
    assert.equal(whoami.exitCode, 0, whoami.stderr);
    const again = await runCli(["--api-url", apiUrl, "--no-input", "signup", "--code", "482913"], env);
    assert.notEqual(again.exitCode, 0);
    assert.match(again.stderr, /No sign-up is waiting/);

    const login = await runCli(["--api-url", apiUrl, "--no-input", "auth", "login", "--email", "sam@acme.com"], env);
    assert.equal(login.exitCode, 0, login.stderr);
    assert.match(login.stdout + login.stderr, /auth login --email sam@acme.com --code <code>/);
    const keyFile = path.join(home, "ci", "ht.key");
    const loggedIn = await runCli(["--api-url", apiUrl, "--no-input", "--json", "auth", "login", "--email", "sam@acme.com", "--code", "482913", "--key-file", keyFile], env);
    assert.equal(loggedIn.exitCode, 0, loggedIn.stderr);
    assert.equal(JSON.parse(loggedIn.stdout).companyName, "Acme Plumbing");
    assert.doesNotMatch(loggedIn.stdout, /0123456789abcdef/);
    assert.equal((await fs.readFile(keyFile, "utf8")).trim(), issuedKey);
    assert.equal((await fs.stat(keyFile)).mode & 0o777, 0o600);
    assert.ok(requests.filter((entry) => entry.url !== "/auth/whoami").every((entry) => entry.apiKey === undefined));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("errors are JSON on stderr with --json and keep their exit code", async () => {
  const server = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: { items: [] }, error: null, meta: {} }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const apiUrl = `http://127.0.0.1:${address.port}`;
  try {
    const machine = await runCli(["--api-url", apiUrl, "--api-key", "secret", "--json", "jobs", "get", "missing-1"]);
    assert.equal(machine.exitCode, 4);
    assert.deepEqual(JSON.parse(machine.stderr), { error: { code: "not_found", message: "Job not found: missing-1", status: 404, exitCode: 4 } });

    const human = await runCli(["--api-url", apiUrl, "--api-key", "secret", "jobs", "get", "missing-1"]);
    assert.equal(human.exitCode, 4);
    assert.equal(human.stderr.trim(), "not_found: Job not found: missing-1");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("reports commands expose discovery help", async () => {
  const result = await runCli(["reports", "--help"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Run, save, schedule, and download reports/);
  assert.match(result.stdout, /types/);
  assert.match(result.stdout, /generate/);
  assert.match(result.stdout, /recurring/);
});

test("reports types and columns render discoverable tables", async () => {
  const server = await createReportsServer();
  try {
    const types = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "reports", "types"]);
    assert.equal(types.exitCode, 0);
    assert.match(types.stdout, /jobs/);
    assert.match(types.stdout, /xlsx,csv,geojson,pdf/);

    const columns = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "reports", "columns", "jobs"]);
    assert.equal(columns.exitCode, 0);
    assert.match(columns.stdout, /title/);
    assert.match(columns.stdout, /Status/);
  } finally {
    await server.close();
  }
});

test("reports generate writes the downloaded file and reports metadata", async () => {
  const server = await createReportsServer();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ht-reports-"));
  const filePath = path.join(tempDir, "jobs.csv");
  try {
    const result = await runCli([
      "--api-url", server.apiUrl,
      "--api-key", "secret",
      "reports", "generate", "jobs",
      "--date", "today",
      "--format", "csv",
      "--all-members",
      "--file", filePath
    ]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /reportId: report-1/);
    assert.equal(await fs.readFile(filePath, "utf8"), "id,title\n1,Install\n");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    await server.close();
  }
});

test("reports recurring create resolves members and returns compact data", async () => {
  const server = await createReportsServer();
  try {
    const result = await runCli([
      "--api-url", server.apiUrl,
      "--api-key", "secret",
      "reports", "recurring", "create",
      "--name", "Weekly jobs",
      "--type", "jobs",
      "--frame", "week",
      "--weekday", "monday",
      "--format", "csv",
      "--all-members"
    ]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Weekly jobs/);
    assert.match(result.stdout, /recurring-1/);
  } finally {
    await server.close();
  }
});

test("timesheets commands expose operational help", async () => {
  const result = await runCli(["timesheets", "--help"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Inspect, correct, create, delete, summarize, and export timesheet/);
  assert.match(result.stdout, /list/);
  assert.match(result.stdout, /summary/);
  assert.match(result.stdout, /add/);
  assert.match(result.stdout, /delete/);
  assert.match(result.stdout, /reports generate timesheet/);
});

test("timesheets list and summary render compact human output", async () => {
  const server = await createTimesheetsServer();
  try {
    const list = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "timesheets", "list", "--date", "2026-05-28"]);
    assert.equal(list.exitCode, 0);
    assert.match(list.stdout, /Alice Field/);
    assert.match(list.stdout, /08:30/);
    assert.match(list.stdout, /8h 45m/);
    assert.match(list.stdout, /clock-in-1_clock-out-1/);

    const summary = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "timesheets", "summary", "--date", "2026-05-28"]);
    assert.equal(summary.exitCode, 0);
    assert.match(summary.stdout, /Alice Field/);
    assert.match(summary.stdout, /8h 45m/);
    assert.match(summary.stdout, /entries/);
  } finally {
    await server.close();
  }
});

test("timesheets add resolves member selector and creates an entry", async () => {
  const server = await createTimesheetsServer();
  try {
    const result = await runCli([
      "--api-url", server.apiUrl,
      "--api-key", "secret",
      "timesheets", "add",
      "--member", "alice@example.com",
      "--date", "2026-05-28",
      "--in", "08:30",
      "--out", "17:15"
    ]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Alice Field/);
    assert.match(result.stdout, /clock-in-1_clock-out-1/);
    assert.match(result.stderr, /Creating timesheet entry/);
  } finally {
    await server.close();
  }
});

test("timesheets update and delete call the public entry routes", async () => {
  const server = await createTimesheetsServer();
  try {
    const update = await runCli([
      "--api-url", server.apiUrl,
      "--api-key", "secret",
      "timesheets", "update", "clock-in-1_clock-out-1",
      "--in", "08:45",
      "--out", "17:00"
    ]);
    assert.equal(update.exitCode, 0);
    assert.match(update.stdout, /08:45/);
    assert.match(update.stdout, /17:00/);

    const denied = await runCli([
      "--api-url", server.apiUrl,
      "--api-key", "secret",
      "--no-input",
      "timesheets", "delete", "clock-in-1_clock-out-1"
    ]);
    assert.equal(denied.exitCode, 1);
    assert.match(denied.stderr, /Re-run with --yes/);

    const deleted = await runCli([
      "--api-url", server.apiUrl,
      "--api-key", "secret",
      "--yes",
      "timesheets", "delete", "clock-in-1_clock-out-1"
    ]);
    assert.equal(deleted.exitCode, 0);
    assert.match(deleted.stdout, /deleted/);
  } finally {
    await server.close();
  }
});

test("timesheets json and csv outputs preserve automation data", async () => {
  const server = await createTimesheetsServer();
  try {
    const json = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "--json", "timesheets", "list", "--date", "2026-05-28"]);
    assert.equal(json.exitCode, 0);
    const payload = JSON.parse(json.stdout) as Record<string, unknown>;
    assert.deepEqual(payload.summary, { totalSeconds: 31500, entryCount: 1, openEntryCount: 0, memberCount: 1 });

    const csv = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "--output", "csv", "timesheets", "export", "--date", "2026-05-28"]);
    assert.equal(csv.exitCode, 0);
    assert.match(csv.stdout, /^memberId,member,date,clockIn,clockOut,clockInAt,clockOutAt,durationSeconds,open,entryId/m);
    assert.match(csv.stdout, /member-1,Alice Field,2026-05-28,08:30,17:15/);
  } finally {
    await server.close();
  }
});

test("forms commands expose template, submission, link, attachment, builder, and report workflows", async () => {
  const result = await runCli(["forms", "--help"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Manage form templates/);
  assert.match(result.stdout, /templates/);
  assert.match(result.stdout, /submissions/);
  assert.match(result.stdout, /links/);
  assert.match(result.stdout, /attachments/);
  assert.match(result.stdout, /builder/);
  assert.match(result.stdout, /forms report/);
});

test("forms templates template, validate, create, update, delete, and fields work", async () => {
  const server = await createFormsServer();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ht-forms-"));
  const templateFile = path.join(tempDir, "safety-check.json");
  try {
    await fs.writeFile(templateFile, JSON.stringify({
      title: "Safety check",
      description: "Daily safety checklist",
      content: [
        { type: "text", name: "vehicle_id", label: "Vehicle ID", required: true },
        { type: "radio", name: "condition", label: "Condition", required: true, options: ["ok", "needs_service"] }
      ]
    }));

    const starter = await runCli(["forms", "templates", "template", "--format", "yaml"]);
    assert.equal(starter.exitCode, 0);
    assert.match(starter.stdout, /Safety check/);
    assert.match(starter.stdout, /vehicle_id/);

    const validate = await runCli(["forms", "templates", "validate", "--file", templateFile]);
    assert.equal(validate.exitCode, 0);
    assert.match(validate.stdout, /valid/);

    const list = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "forms", "templates", "list"]);
    assert.equal(list.exitCode, 0);
    assert.match(list.stdout, /template-1/);
    assert.match(list.stdout, /Safety check/);

    const get = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "forms", "templates", "get", "Safety check"]);
    assert.equal(get.exitCode, 0);
    assert.match(get.stdout, /Form Template/);
    assert.match(get.stdout, /vehicle_id/);

    const fields = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "forms", "templates", "fields", "template-1"]);
    assert.equal(fields.exitCode, 0);
    assert.match(fields.stdout, /signature/);

    const create = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "forms", "templates", "create", "--file", templateFile]);
    assert.equal(create.exitCode, 0);
    assert.match(create.stdout, /template-created/);

    const update = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "forms", "templates", "update", "template-1", "--file", templateFile]);
    assert.equal(update.exitCode, 0);
    assert.match(update.stdout, /template-1/);

    const deleted = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "--yes", "forms", "templates", "delete", "template-1"]);
    assert.equal(deleted.exitCode, 0);
    assert.match(deleted.stdout, /deleted/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    await server.close();
  }
});

test("forms submissions template, submit, list, get, and export work", async () => {
  const server = await createFormsServer();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ht-forms-submit-"));
  const valuesFile = path.join(tempDir, "answers.json");
  try {
    await fs.writeFile(valuesFile, JSON.stringify({ values: { vehicle_id: "VAN-10", condition: "ok" } }));

    const starter = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "forms", "submissions", "template", "template-1", "--format", "json"]);
    assert.equal(starter.exitCode, 0);
    assert.match(starter.stdout, /vehicle_id/);

    const submit = await runCli([
      "--api-url", server.apiUrl,
      "--api-key", "secret",
      "forms", "submissions", "submit", "template-1",
      "--values", valuesFile,
      "--member", "alice@example.com",
      "--job", "job-1"
    ]);
    assert.equal(submit.exitCode, 0);
    assert.match(submit.stdout, /submission-created/);
    assert.match(submit.stderr, /Submitting form template-1/);

    const contentFile = path.join(tempDir, "content.json");
    await fs.writeFile(contentFile, JSON.stringify([{ type: "text", name: "vehicle_id", value: "VAN-10" }]));
    const submitContent = await runCli([
      "--api-url", server.apiUrl,
      "--api-key", "secret",
      "forms", "submissions", "submit", "template-1",
      "--content", contentFile,
      "--member", "alice@example.com",
      "--job", "job-1"
    ]);
    assert.equal(submitContent.exitCode, 0, submitContent.stderr);

    const list = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "forms", "submissions", "list", "--template", "template-1"]);
    assert.equal(list.exitCode, 0);
    assert.match(list.stdout, /submission-1/);
    assert.match(list.stdout, /2\/3/);

    const get = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "forms", "submissions", "get", "submission-1"]);
    assert.equal(get.exitCode, 0);
    assert.match(get.stdout, /Answers/);
    assert.match(get.stdout, /vehicle_id: VAN-9/);

    const csv = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "--output", "csv", "forms", "submissions", "export", "--template", "template-1"]);
    assert.equal(csv.exitCode, 0);
    assert.match(csv.stdout, /^id,templateId,title,createdAt,submittedBy,jobId,placeId,vehicle_id,condition/m);
    assert.match(csv.stdout, /submission-1,template-1,Safety check/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    await server.close();
  }
});

test("forms links, attachments, report wrapper, and builder safety work", async () => {
  const server = await createFormsServer();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ht-forms-extra-"));
  const attachmentFile = path.join(tempDir, "proof.txt");
  const reportFile = path.join(tempDir, "forms.csv");
  try {
    await fs.writeFile(attachmentFile, "proof");

    const links = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "forms", "links", "list", "--job", "job-1"]);
    assert.equal(links.exitCode, 0);
    assert.match(links.stdout, /Safety check/);

    const attach = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "forms", "links", "attach", "template-1", "--job", "job-1"]);
    assert.equal(attach.exitCode, 0);
    assert.match(attach.stdout, /template-1/);

    const detach = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "--yes", "forms", "links", "detach", "template-1", "--job", "job-1"]);
    assert.equal(detach.exitCode, 0);
    assert.match(detach.stdout, /No results/);

    const upload = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "forms", "attachments", "upload", "--file", attachmentFile, "--field", "signature", "--filename", "proof.txt"]);
    assert.equal(upload.exitCode, 0);
    assert.match(upload.stdout, /https:\/\/files\.example\/proof\.txt/);
    assert.match(upload.stdout, /value/);

    const report = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "forms", "report", "template-1", "--from", "2026-05-01", "--until", "2026-05-28", "--format", "csv", "--file", reportFile]);
    assert.equal(report.exitCode, 0);
    assert.match(report.stdout, /report-forms-1/);
    assert.equal(await fs.readFile(reportFile, "utf8"), "id,vehicle_id\nsubmission-1,VAN-9\n");

    const builder = await runCli(["--no-input", "forms", "builder"]);
    assert.equal(builder.exitCode, 1);
    assert.match(builder.stderr, /forms builder is interactive/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    await server.close();
  }
});

test("alerts commands expose configs, instances, zones, and report workflows", async () => {
  const result = await runCli(["alerts", "--help"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Manage alert configs/);
  assert.match(result.stdout, /actions/);
  assert.match(result.stdout, /zones/);
  assert.match(result.stdout, /configs/);
  assert.match(result.stdout, /instances/);
  assert.match(result.stdout, /report/);
});

test("alerts actions, zones, template, and validate are discoverable", async () => {
  const server = await createAlertsServer();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ht-alerts-"));
  const file = path.join(tempDir, "alert.json");
  try {
    await fs.writeFile(file, JSON.stringify({
      title: "Zone entry",
      action: "enters_zone",
      memberIds: ["member-1"],
      zoneIds: ["zone-1"],
      weekdays: ["monday"],
      timeStart: "08:00",
      timeEnd: "18:00"
    }));

    const actions = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "alerts", "actions"]);
    assert.equal(actions.exitCode, 0);
    assert.match(actions.stdout, /no_check_out/);
    assert.match(actions.stdout, /enters_zone/);

    const zones = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "alerts", "zones"]);
    assert.equal(zones.exitCode, 0);
    assert.match(zones.stdout, /Restricted/);

    const template = await runCli(["alerts", "configs", "template", "zone-entry", "--format", "yaml"]);
    assert.equal(template.exitCode, 0);
    assert.match(template.stdout, /Entered restricted zone/);
    assert.match(template.stdout, /zoneIds/);

    const validate = await runCli(["alerts", "configs", "validate", "--file", file]);
    assert.equal(validate.exitCode, 0);
    assert.match(validate.stdout, /valid/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    await server.close();
  }
});

test("alerts configs list, get, create, update, pause, resume, and delete work", async () => {
  const server = await createAlertsServer();
  try {
    const list = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "alerts", "configs", "list"]);
    assert.equal(list.exitCode, 0);
    assert.match(list.stdout, /Missing check-out/);
    assert.match(list.stdout, /no_check_out/);

    const get = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "alerts", "configs", "get", "alert-1"]);
    assert.equal(get.exitCode, 0);
    assert.match(get.stdout, /Alert Config/);
    assert.match(get.stdout, /--action/);

    const created = await runCli([
      "--api-url", server.apiUrl,
      "--api-key", "secret",
      "alerts", "configs", "create",
      "--title", "Zone entry",
      "--action", "enters_zone",
      "--member", "alice@example.com",
      "--zone", "Restricted",
      "--email", "ops@example.com",
      "--weekday", "monday",
      "--time-start", "08:00",
      "--time-end", "18:00"
    ]);
    assert.equal(created.exitCode, 0);
    assert.match(created.stdout, /alert-created/);

    const updated = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "alerts", "configs", "update", "alert-1", "--team", "North"]);
    assert.equal(updated.exitCode, 0);
    assert.match(updated.stdout, /teams: 1/);

    const paused = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "alerts", "configs", "pause", "alert-1"]);
    assert.equal(paused.exitCode, 0);
    assert.match(paused.stdout, /status: paused/);

    const resumed = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "alerts", "configs", "resume", "alert-1"]);
    assert.equal(resumed.exitCode, 0);
    assert.match(resumed.stdout, /status: active/);

    const denied = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "--no-input", "alerts", "configs", "delete", "alert-1"]);
    assert.equal(denied.exitCode, 1);
    assert.match(denied.stderr, /Re-run with --yes/);

    const deleted = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "--yes", "alerts", "configs", "delete", "alert-1"]);
    assert.equal(deleted.exitCode, 0);
    assert.match(deleted.stdout, /deleted/);
  } finally {
    await server.close();
  }
});

test("alerts recent, instances lifecycle, export, json, and report work", async () => {
  const server = await createAlertsServer();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ht-alerts-report-"));
  const reportFile = path.join(tempDir, "alerts.csv");
  try {
    const recent = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "alerts", "recent", "--limit", "20"]);
    assert.equal(recent.exitCode, 0);
    assert.match(recent.stdout, /Alice Field did not check out/);
    assert.match(recent.stdout, /instance-1/);

    const get = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "alerts", "instances", "get", "instance-1"]);
    assert.equal(get.exitCode, 0);
    assert.match(get.stdout, /Alice Field did not check out/);

    const ack = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "--yes", "alerts", "instances", "ack", "instance-1"]);
    assert.equal(ack.exitCode, 0);
    assert.match(ack.stdout, /acknowledged/);

    const csv = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "--output", "csv", "alerts", "instances", "export"]);
    assert.equal(csv.exitCode, 0);
    assert.match(csv.stdout, /^time,config,status,message,id/m);

    const json = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "--json", "alerts", "configs", "list"]);
    assert.equal(json.exitCode, 0);
    const payload = JSON.parse(json.stdout) as { items: Array<Record<string, unknown>> };
    assert.equal(payload.items[0]?.id, "alert-1");

    const report = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "alerts", "report", "--from", "2026-05-01", "--until", "2026-05-28", "--format", "csv", "--file", reportFile]);
    assert.equal(report.exitCode, 0);
    assert.match(report.stdout, /report-alerts-1/);
    assert.equal(await fs.readFile(reportFile, "utf8"), "id,message\ninstance-1,Alice Field did not check out\n");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    await server.close();
  }
});

test("auto update check can be disabled from help-visible global option", async () => {
  const result = await runCli(["--help"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /--no-update-check/);
});

test("skills install command is available", async () => {
  const result = await runCli(["skills", "install", "--help"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Install the Hellotracks SKILL\.md/);
  assert.match(result.stdout, /--agent <agent>/);
  assert.match(result.stdout, /Codex:/);
  assert.match(result.stdout, /Claude Code:/);
  assert.match(result.stdout, /ht skill install/);
});

test("skills install writes the hellotracks skill for Codex and Claude Code", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ht-skill-test-"));
  const codexHome = path.join(tempDir, "codex");
  const claudeHome = path.join(tempDir, "claude");
  try {
    const result = await runCli(["skills", "install"], {
      CODEX_HOME: codexHome,
      CLAUDE_HOME: claudeHome
    });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /"skill": "hellotracks"/);
    assert.match(result.stdout, /"agent": "codex"/);
    assert.match(result.stdout, /"agent": "claude"/);

    const codexSkill = await fs.readFile(path.join(codexHome, "skills", "hellotracks", "SKILL.md"), "utf8");
    const claudeSkill = await fs.readFile(path.join(claudeHome, "skills", "hellotracks", "SKILL.md"), "utf8");
    assert.match(codexSkill, /^name: hellotracks$/m);
    assert.equal(claudeSkill, codexSkill);
    assert.doesNotMatch(codexSkill, /\/Users\/|wrangler|R2 bucket|packages\/core/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("skills install dry-run does not write files", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ht-skill-dry-run-"));
  const codexHome = path.join(tempDir, "codex");
  try {
    const result = await runCli(["skills", "install", "--agent", "codex", "--dry-run"], {
      CODEX_HOME: codexHome
    });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /"status": "would-install"/);
    await assert.rejects(
      fs.access(path.join(codexHome, "skills", "hellotracks", "SKILL.md")),
      /ENOENT/
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("profiles create honors api-url", async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "ht-cli-profile-"));
  try {
    const create = await runCli(["profiles", "create", "default", "--api-url", "https://api.hellotracks.com/v1"], { HOME: tempHome });
    assert.equal(create.exitCode, 0);
    const list = await runCli(["profiles", "list"], { HOME: tempHome });
    assert.equal(list.exitCode, 0);
    assert.match(list.stdout, /https:\/\/api\.hellotracks\.com\/v1/);
    assert.doesNotMatch(list.stdout, /https:\/\/qa\.hellotracks\.com\/v1/);
  } finally {
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});

test("auth whoami uses the current profile api-url when --profile is omitted", async () => {
  const server = await createAuthServer();
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "ht-cli-current-profile-"));
  try {
    const create = await runCli(["profiles", "create", "qa", "--api-url", server.apiUrl], { HOME: tempHome });
    assert.equal(create.exitCode, 0);
    const use = await runCli(["profiles", "use", "qa"], { HOME: tempHome });
    assert.equal(use.exitCode, 0);

    const result = await runCli(["auth", "whoami"], {
      HOME: tempHome,
      HELLOTRACKS_API_KEY: "secret"
    });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /profile: qa/);
    assert.match(result.stdout, new RegExp(`apiUrl: ${server.apiUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  } finally {
    await fs.rm(tempHome, { recursive: true, force: true });
    await server.close();
  }
});

test("auth whoami renders compact human output by default", async () => {
  const server = await createAuthServer();
  try {
    const result = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "auth", "whoami"]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Authenticated/);
    assert.match(result.stdout, /Demo Admin/);
    assert.match(result.stdout, /Demo Company/);
    assert.match(result.stdout, /apiEnabled: true/);
    assert.match(result.stdout, /key-1/);
    assert.doesNotMatch(result.stdout, /"account"/);
    assert.doesNotMatch(result.stdout, /legacy: false/);
    assert.doesNotMatch(result.stdout, /workersCreateJobs/);
  } finally {
    await server.close();
  }
});

test("auth whoami verbose includes read-only identity details", async () => {
  const server = await createAuthServer();
  try {
    const result = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "--verbose", "auth", "whoami"]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Account Details \[read-only\]/);
    assert.match(result.stdout, /id: account-1  \[read-only\]/);
    assert.match(result.stdout, /Company Details \[read-only\]/);
    assert.match(result.stdout, /settings\.workersCreateJobs: false  \[read-only\]/);
  } finally {
    await server.close();
  }
});

test("auth whoami json returns the raw response", async () => {
  const server = await createAuthServer();
  try {
    const result = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "--json", "auth", "whoami"]);
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout) as Record<string, Record<string, unknown>>;
    assert.equal(payload.account?.id, "account-1");
    assert.equal(payload.company?.id, "company-1");
    assert.deepEqual(payload.company?.teamsConfig, [{ id: 1, name: "North" }]);
  } finally {
    await server.close();
  }
});

test("company show renders compact human output by default", async () => {
  const server = await createCompanyServer();
  try {
    const result = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "company", "show"]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Writable Settings/);
    assert.match(result.stdout, /apiEnabled: true  \(--api-enabled\)/);
    assert.match(result.stdout, /teamsConfig: 1 team \[read-only\]/);
    assert.doesNotMatch(result.stdout, /working_hours/);
    assert.doesNotMatch(result.stdout, /admin@example.com/);
  } finally {
    await server.close();
  }
});

test("company show verbose includes read-only company details", async () => {
  const server = await createCompanyServer();
  try {
    const result = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "--verbose", "company", "show"]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Read-only Fields/);
    assert.match(result.stdout, /username: admin@example.com  \[read-only\]/);
    assert.match(result.stdout, /Teams \[read-only\]/);
    assert.match(result.stdout, /North/);
  } finally {
    await server.close();
  }
});

test("company show json returns the raw company object", async () => {
  const server = await createCompanyServer();
  try {
    const result = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "--json", "company", "show"]);
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(payload.name, "Acme Field Ops");
    assert.deepEqual(payload.teamsConfig, [
      {
        id: 1,
        name: "North",
        route: {
          start_lat: 37.7955203,
          start_lng: -122.3937451
        },
        working_hours: {
          monday: { start: 800, end: 1800 },
          tuesday: { start: 800, end: 1800 },
          wednesday: { start: 800, end: 1800 },
          thursday: { start: 800, end: 1800 },
          friday: { start: 800, end: 1800 },
          saturday: { start: 0, end: 0 },
          sunday: { start: 0, end: 0 }
        }
      }
    ]);
  } finally {
    await server.close();
  }
});

test("company update help explains examples and read-only teamsConfig", async () => {
  const result = await runCli(["company", "update", "--help"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Boolean values accept true, false, 1, 0, yes, no, on, and off/);
  assert.match(result.stdout, /ht company update --api-enabled true/);
  assert.match(result.stdout, /teamsConfig is currently read-only/);
});

test("members update renders compact human output by default", async () => {
  const server = await createMemberServer();
  try {
    const result = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "members", "update", "member-1", "--name", "Alicia Field"]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Member/);
    assert.match(result.stdout, /name: Alicia Field  \(--name\)/);
    assert.match(result.stdout, /timezone: Europe\/Vienna  \(--timezone\)/);
    assert.match(result.stdout, /Writable Routing Defaults/);
    assert.doesNotMatch(result.stdout, /member-1/);
    assert.doesNotMatch(result.stdout, /tracking/);
  } finally {
    await server.close();
  }
});

test("members get verbose includes read-only member details", async () => {
  const server = await createMemberServer();
  try {
    const result = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "--verbose", "members", "get", "member-1"]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Read-only Fields/);
    assert.match(result.stdout, /id: member-1  \[read-only\]/);
    assert.match(result.stdout, /activeStatus: online  \[read-only\]/);
    assert.match(result.stdout, /location: 37\.79552, -122\.39375  \[read-only\]/);
  } finally {
    await server.close();
  }
});

test("members locate renders latest known member location", async () => {
  const server = await createMemberServer();
  try {
    const result = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "members", "locate", "member-1"]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /member-1/);
    assert.match(result.stdout, /Alice Field/);
    assert.match(result.stdout, /37\.79552/);
    assert.match(result.stdout, /-122\.39375/);
    assert.match(result.stdout, /2026-/);
    assert.match(result.stdout, /tracking/);
    assert.doesNotMatch(result.stdout, /altitude/);

    const full = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "members", "locate", "member-1", "--full"]);
    assert.equal(full.exitCode, 0);
    assert.match(full.stdout, /altitude/);
    assert.match(full.stdout, /heading/);
    assert.match(full.stdout, /sensor/);
  } finally {
    await server.close();
  }
});

test("members locate json returns full location payloads", async () => {
  const server = await createMemberServer();
  try {
    const result = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "--json", "members", "locate", "member-1"]);
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout) as { items: Array<{ id: string; location: Record<string, unknown>; gps: Record<string, unknown>; states: Record<string, unknown> }> };
    assert.equal(payload.items[0]?.id, "member-1");
    assert.equal(payload.items[0]?.location.lat, 37.7955203);
    assert.equal(payload.items[0]?.location.lng, -122.3937451);
    assert.equal(payload.items[0]?.gps.altitude, 432);
    assert.deepEqual(payload.items[0]?.states, { tracking: true });
  } finally {
    await server.close();
  }
});

test("members update json returns the raw member object", async () => {
  const server = await createMemberServer();
  try {
    const result = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "--json", "members", "update", "member-1", "--name", "Alicia Field"]);
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(payload.id, "member-1");
    assert.equal(payload.name, "Alicia Field");
    assert.deepEqual(payload.states, { tracking: true });
  } finally {
    await server.close();
  }
});

test("members update help explains examples and raw output", async () => {
  const result = await runCli(["members", "update", "--help"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Only provided fields are changed/);
  assert.match(result.stdout, /ht members update member-123 --team 1 --team 2/);
  assert.match(result.stdout, /--working-hours-json/);
});

test("places update renders compact human output by default", async () => {
  const server = await createPlaceServer();
  try {
    const result = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "places", "update", "place-1", "--name", "Acme Depot"]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Place/);
    assert.match(result.stdout, /name: Acme Depot  \(--name\)/);
    assert.match(result.stdout, /location: 37\.79552, -122\.39375  \(--lat, --lng\)/);
    assert.match(result.stdout, /extendedData: \{"customerId":"CUST-1001"\}  \(--extended-data-json\)/);
    assert.doesNotMatch(result.stdout, /place-1/);
  } finally {
    await server.close();
  }
});

test("places get verbose includes read-only place details", async () => {
  const server = await createPlaceServer();
  try {
    const result = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "--verbose", "places", "get", "place-1"]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Read-only Fields/);
    assert.match(result.stdout, /id: place-1  \[read-only\]/);
    assert.match(result.stdout, /type: place  \[read-only\]/);
  } finally {
    await server.close();
  }
});

test("places update json returns the raw place object", async () => {
  const server = await createPlaceServer();
  try {
    const result = await runCli(["--api-url", server.apiUrl, "--api-key", "secret", "--json", "places", "update", "place-1", "--name", "Acme Depot"]);
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(payload.id, "place-1");
    assert.equal(payload.name, "Acme Depot");
    assert.deepEqual(payload.extendedData, { customerId: "CUST-1001" });
  } finally {
    await server.close();
  }
});

test("places update help explains examples and raw output", async () => {
  const result = await runCli(["places", "update", "--help"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Only provided fields are changed/);
  assert.match(result.stdout, /ht places update place-123 --team 1 --team 2/);
  assert.match(result.stdout, /--extended-data-json/);
});

test("docs only show commands and flags that exist", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const files = ["README.md", "docs/COMMANDS.md", "docs/AUTOMATION-RECIPES.md", "packages/cli/README.md", "AGENTS.md"];
  const texts: Array<[string, string]> = [["skill.ts", HELLOTRACKS_SKILL]];
  for (const file of files) {
    texts.push([file, await fs.readFile(path.join(root, file), "utf8")]);
  }
  const program = buildProgram();
  const globalFlags = new Set(program.options.flatMap((option) => [option.long, option.short]).filter(Boolean));
  const problems: string[] = [];
  for (const [file, text] of texts) {
    // Command lines in code blocks, and `ht ...` spans inside sentences.
    const candidates = text.split("\n").flatMap((line) => [line, ...[...line.matchAll(/`(ht [^`]+)`/g)].map((span) => span[1] ?? "")]);
    for (const line of candidates) {
      const match = /^\s*(?:[A-Z_]+=\S+\s+)?ht\s+(.*)$/.exec(line.replace(/\s+#.*$/, "").replace(/\s*(\||&&|>).*$/, ""));
      if (!match?.[1]) {
        continue;
      }
      const tokens = match[1].split(/\s+/).filter(Boolean);
      const takesValue = new Set(program.options.filter((option) => option.required || option.optional).map((option) => option.long));
      let command = program;
      for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index] ?? "";
        if (token.startsWith("-")) {
          if (takesValue.has(token)) {
            index += 1;
          }
          continue;
        }
        if (token.startsWith("<")) {
          continue;
        }
        const next = command.commands.find((entry) => entry.name() === token || entry.aliases().includes(token));
        if (!next) {
          break;
        }
        command = next;
      }
      const flags = new Set(command.options.flatMap((option) => [option.long, option.short, option.negate ? option.long : undefined]).filter(Boolean));
      for (const token of tokens.filter((entry) => /^--?[a-z]/.test(entry))) {
        const flag = token.split("=")[0] ?? token;
        if (!flags.has(flag) && !globalFlags.has(flag)) {
          problems.push(`${file}: ${flag} is not an option of "${command.name()}" in: ${line.trim()}`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("every command and option has a help description", () => {
  const missing: string[] = [];
  const visit = (command: ReturnType<typeof buildProgram>, prefix: string): void => {
    for (const child of command.commands) {
      const name = `${prefix} ${child.name()}`;
      if (!child.description()) missing.push(name);
      for (const option of child.options) {
        if (!option.hidden && !option.description) missing.push(`${name} ${option.long ?? option.flags}`);
      }
      visit(child, name);
    }
  };
  const program = buildProgram();
  for (const option of program.options) {
    if (!option.hidden && !option.description) missing.push(`ht ${option.long ?? option.flags}`);
  }
  visit(program, "ht");
  assert.deepEqual(missing, []);
});

test("commands lists every command, and with --json each option", async () => {
  const text = await runCli(["commands"]);
  assert.equal(text.exitCode, 0, text.stderr);
  assert.match(text.stdout, /^ht jobs list\s+List jobs/m);
  assert.match(text.stdout, /^ht reports saved create\s+/m);

  const json = await runCli(["--json", "commands"]);
  assert.equal(json.exitCode, 0, json.stderr);
  const data = JSON.parse(json.stdout) as { globalOptions: unknown[]; commands: Array<{ command: string; options: Array<{ flags: string; description: string }> }> };
  const create = data.commands.find((entry) => entry.command === "ht jobs create");
  assert.ok(create?.options.some((option) => option.flags.startsWith("--external-id") && option.description.length > 0));
  assert.ok(data.commands.every((entry) => entry.options.every((option) => option.description.length > 0)));
});

test("reports generate --background waits for the report job and downloads its file", async () => {
  let polls = 0;
  let generateBody: Record<string, unknown> = {};
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk);
    });
    req.on("end", () => {
      const send = (status: number, data: unknown) => {
        res.statusCode = status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ data, error: null, meta: {} }));
      };
      if (req.url === "/reports/generate") {
        generateBody = JSON.parse(raw) as Record<string, unknown>;
        send(202, { job: { id: "job-1", status: "queued", type: "places", format: "csv" } });
      } else if (req.url === "/reports/jobs/job-1") {
        polls += 1;
        send(200, { job: polls > 1
          ? { id: "job-1", status: "completed", type: "places", format: "csv", result: { link: "/img/reports/places.csv", filename: "places.csv" } }
          : { id: "job-1", status: "processing", type: "places", format: "csv", result: null } });
      } else if (req.url === "/img/reports/places.csv") {
        res.setHeader("Content-Type", "text/csv");
        res.end("name\nDepot\n");
      } else {
        send(404, null);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ht-report-job-"));
  try {
    const file = path.join(tempDir, "places.csv");
    const result = await runCli(["--api-url", `http://127.0.0.1:${address.port}`, "--api-key", "secret", "reports", "generate", "places", "--format", "csv", "--background", "--file", file]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(generateBody.async, true);
    assert.equal(await fs.readFile(file, "utf8"), "name\nDepot\n");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("jobs list --all reads every page, and places delete calls the delete route", async () => {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    const url = new URL(req.url ?? "", "http://localhost");
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/jobs") {
      const skip = Number(url.searchParams.get("skip") ?? 0);
      const items = skip === 0 ? Array.from({ length: 500 }, (_, index) => ({ id: `job-${index}` })) : [{ id: "job-500" }];
      res.end(JSON.stringify({ data: { items, totalCount: 501, hasMore: skip === 0 }, error: null, meta: {} }));
      return;
    }
    res.end(JSON.stringify({ data: { id: "place-1", deleted: true }, error: null, meta: {} }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const apiUrl = `http://127.0.0.1:${address.port}`;
  try {
    const all = await runCli(["--api-url", apiUrl, "--api-key", "secret", "--json", "jobs", "list", "--all-dates", "--all"]);
    assert.equal(all.exitCode, 0, all.stderr);
    assert.equal((JSON.parse(all.stdout) as unknown[]).length, 501);

    const removed = await runCli(["--api-url", apiUrl, "--api-key", "secret", "--yes", "places", "delete", "place-1"]);
    assert.equal(removed.exitCode, 0, removed.stderr);
    assert.ok(seen.includes("DELETE /places/place-1"));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("jobs import writes jobs in batches and retries a refused batch one by one", async () => {
  const posts: unknown[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk);
    });
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.method === "POST" && req.url === "/jobs") {
        const body = JSON.parse(raw) as { jobs?: Array<{ title: string }>; title?: string };
        posts.push(body);
        const titles = body.jobs ? body.jobs.map((job) => job.title) : [body.title];
        if (titles.includes("bad")) {
          res.statusCode = 400;
          res.end(JSON.stringify({ data: null, error: { code: "invalid_request", message: "bad job" }, meta: {} }));
          return;
        }
        res.end(JSON.stringify({ data: { items: titles.map((title) => ({ id: `id-${title}`, title })) }, error: null, meta: {} }));
        return;
      }
      res.end(JSON.stringify({ data: { items: [] }, error: null, meta: {} }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ht-jobs-batch-"));
  try {
    const file = path.join(tempDir, "jobs.json");
    await fs.writeFile(file, JSON.stringify([{ title: "a" }, { title: "b" }, { title: "bad" }, { title: "c" }]));
    const result = await runCli(["--api-url", `http://127.0.0.1:${address.port}`, "--api-key", "secret", "--json", "jobs", "import", "--file", file, "--batch-size", "2", "--continue-on-error"]);
    // One record failed, so the run exits 7 even though the others were written.
    assert.equal(result.exitCode, 7, result.stderr);
    const report = JSON.parse(result.stdout) as { summary: { created: number; failed: number }; errors: Array<{ index: number }> };
    assert.equal(report.summary.created, 3);
    assert.equal(report.summary.failed, 1);
    assert.equal(report.errors[0]?.index, 2);
    assert.deepEqual(posts[0], { jobs: [{ title: "a" }, { title: "b" }] });
    assert.equal(posts.length, 4);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
