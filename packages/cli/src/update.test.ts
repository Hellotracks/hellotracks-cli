import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { autoCheckCliUpdate, checkCliUpdate, compareCliVersions, updateCli } from "./update.js";

function manifestFetch(version: string): typeof fetch {
  return async () => new Response(JSON.stringify({ version }), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

test("compareCliVersions handles semantic CLI versions", () => {
  assert.equal(compareCliVersions("0.1.2", "0.1.1"), 1);
  assert.equal(compareCliVersions("0.1.2", "0.1.2"), 0);
  assert.equal(compareCliVersions("0.1.1", "0.1.2"), -1);
  assert.equal(compareCliVersions("0.10.0", "0.2.0"), 1);
});

test("checkCliUpdate reports available updates without installing", async () => {
  const result = await checkCliUpdate("0.1.1", {
    baseUrl: "https://cli.example.test/"
  }, {
    fetch: manifestFetch("0.1.2")
  });

  assert.equal(result.status, "available");
  assert.equal(result.currentVersion, "0.1.1");
  assert.equal(result.latestVersion, "0.1.2");
  assert.equal(result.baseUrl, "https://cli.example.test");
  assert.equal(result.updateAvailable, true);
});

test("updateCli skips install when current", async () => {
  let installed = false;
  const result = await updateCli("0.1.2", {}, {
    fetch: manifestFetch("0.1.2"),
    runInstall: async () => {
      installed = true;
    }
  });

  assert.equal(result.status, "current");
  assert.equal(installed, false);
});

test("updateCli runs installer for forced updates", async () => {
  const installs: string[] = [];
  const result = await updateCli("0.1.2", {
    baseUrl: "https://cli.example.test",
    force: true
  }, {
    fetch: manifestFetch("0.1.2"),
    runInstall: async (baseUrl) => {
      installs.push(baseUrl);
    }
  });

  assert.equal(result.status, "updated");
  assert.deepEqual(installs, ["https://cli.example.test"]);
});

test("autoCheckCliUpdate caches update availability", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ht-cli-update-cache-"));
  const cachePath = path.join(tempDir, "update-check.json");
  let calls = 0;
  try {
    const first = await autoCheckCliUpdate("0.1.1", {
      baseUrl: "https://cli.example.test",
      cachePath,
      intervalMs: 1000,
      timeoutMs: 1000
    }, {
      fetch: async () => {
        calls += 1;
        return new Response(JSON.stringify({ version: "0.1.2" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      },
      now: () => 1000
    });

    const second = await autoCheckCliUpdate("0.1.1", {
      baseUrl: "https://cli.example.test",
      cachePath,
      intervalMs: 1000
    }, {
      fetch: async () => {
        calls += 1;
        throw new Error("should not fetch while cache is fresh");
      },
      now: () => 1500
    });

    assert.equal(first.status, "available");
    assert.equal(second.status, "skipped");
    assert.equal(second.latestVersion, "0.1.2");
    assert.equal(second.updateAvailable, true);
    assert.equal(calls, 1);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
