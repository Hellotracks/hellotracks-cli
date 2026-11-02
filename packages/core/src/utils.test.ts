import test from "node:test";
import assert from "node:assert/strict";
import { exitCodeForStatus, parseBoolean, resolveDateWord, splitCsv } from "./utils.js";

test("parseBoolean supports common true/false values", () => {
  assert.equal(parseBoolean("true"), true);
  assert.equal(parseBoolean("No"), false);
});

test("splitCsv expands comma separated arrays", () => {
  assert.deepEqual(splitCsv(["a,b", "c"]), ["a", "b", "c"]);
});

test("exitCodeForStatus maps common HTTP classes", () => {
  assert.equal(exitCodeForStatus(401), 2);
  assert.equal(exitCodeForStatus(404), 4);
  assert.equal(exitCodeForStatus(503), 10);
});

test("resolveDateWord turns today, yesterday and tomorrow into the local date", () => {
  const lateEvening = new Date(2026, 4, 31, 23, 30);
  assert.equal(resolveDateWord("today", lateEvening), "2026-05-31");
  assert.equal(resolveDateWord(" Yesterday ", lateEvening), "2026-05-30");
  assert.equal(resolveDateWord("tomorrow", lateEvening), "2026-06-01");
  assert.equal(resolveDateWord("2026-05-01", lateEvening), "2026-05-01");
  assert.equal(resolveDateWord(undefined, lateEvening), undefined);
});
