import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readBulkRecords, typeCsvNumbers } from "./index.js";

async function tempFile(name: string, contents: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ht-bulk-"));
  const file = path.join(dir, name);
  await fs.writeFile(file, contents, "utf8");
  return file;
}

test("readBulkRecords parses CSV input", async () => {
  const file = await tempFile("jobs.csv", "externalId,title,address\nwo-1,Fix pump,1 Main St\n");
  const records = await readBulkRecords(file);
  assert.deepEqual(records, [{ externalId: "wo-1", title: "Fix pump", address: "1 Main St" }]);
});

test("readBulkRecords expands dotted CSV headers into nested objects", async () => {
  const file = await tempFile("jobs.csv", "externalId,title,contact.name,location.lat,location.lng\nwo-1,Fix pump,Jane,30.2672,-97.7431\n");
  const records = await readBulkRecords(file);
  assert.deepEqual(records, [{
    externalId: "wo-1",
    title: "Fix pump",
    contact: { name: "Jane" },
    location: { lat: "30.2672", lng: "-97.7431" }
  }]);
});

test("readBulkRecords parses NDJSON input", async () => {
  const file = await tempFile("places.ndjson", "{\"name\":\"HQ\"}\n{\"name\":\"Depot\"}\n");
  const records = await readBulkRecords(file);
  assert.deepEqual(records, [{ name: "HQ" }, { name: "Depot" }]);
});

test("readBulkRecords accepts JSON objects with items arrays", async () => {
  const file = await tempFile("members.json", "{\"items\":[{\"username\":\"alice\"}]}");
  const records = await readBulkRecords(file);
  assert.deepEqual(records, [{ username: "alice" }]);
});

test("typeCsvNumbers sends numeric template columns as numbers and leaves text alone", async () => {
  const file = await tempFile("places.csv", "name,radius,location.lat,location.lng,address\nDepot,100,37.7955203,-122.3937451,1 Ferry Building\n");
  const records = typeCsvNumbers("places", await readBulkRecords(file));
  assert.deepEqual(records, [{ name: "Depot", radius: 100, location: { lat: 37.7955203, lng: -122.3937451 }, address: "1 Ferry Building" }]);
});
