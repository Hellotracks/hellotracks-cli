import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCommandContext } from "../utils.js";
import { privateCredentialPath } from "./keychain.js";
import { clearProfile, persistProfile, resolveProfile } from "./store.js";

test("private-file credential storage persists API keys with 0600 permissions", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "ht-private-credentials-"));
  const previousHome = process.env.HOME;
  const previousStore = process.env.HT_CLI_CREDENTIAL_STORE;
  process.env.HOME = home;
  process.env.HT_CLI_CREDENTIAL_STORE = "private-file";
  try {
    const storage = await persistProfile("demo", "https://qa.example.test/v1", "secret-api-key");
    assert.equal(storage, "private-file");

    const credentialPath = privateCredentialPath("demo");
    const stat = await fs.stat(credentialPath);
    assert.equal(stat.mode & 0o777, 0o600);

    const resolved = await resolveProfile(createCommandContext({ profile: "demo" }));
    assert.equal(resolved.apiUrl, "https://qa.example.test/v1");
    assert.equal(resolved.apiKey, "secret-api-key");

    await clearProfile("demo");
    await assert.rejects(fs.stat(credentialPath));
  } finally {
    process.env.HOME = previousHome;
    if (previousStore === undefined) {
      delete process.env.HT_CLI_CREDENTIAL_STORE;
    } else {
      process.env.HT_CLI_CREDENTIAL_STORE = previousStore;
    }
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("resolveProfile uses the current profile when --profile is omitted", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "ht-current-profile-"));
  const previousHome = process.env.HOME;
  const previousStore = process.env.HT_CLI_CREDENTIAL_STORE;
  const previousApiUrl = process.env.HELLOTRACKS_API_URL;
  process.env.HOME = home;
  process.env.HT_CLI_CREDENTIAL_STORE = "private-file";
  delete process.env.HELLOTRACKS_API_URL;
  try {
    await persistProfile("qa", "https://qa.example.test/v1", "secret-api-key");

    const resolved = await resolveProfile(createCommandContext({}));
    assert.equal(resolved.profileName, "qa");
    assert.equal(resolved.apiUrl, "https://qa.example.test/v1");
    assert.equal(resolved.apiKey, "secret-api-key");

    await assert.rejects(
      () => resolveProfile(createCommandContext({ confirmProfile: "production" })),
      /Profile confirmation failed/
    );
  } finally {
    process.env.HOME = previousHome;
    if (previousStore === undefined) {
      delete process.env.HT_CLI_CREDENTIAL_STORE;
    } else {
      process.env.HT_CLI_CREDENTIAL_STORE = previousStore;
    }
    if (previousApiUrl === undefined) {
      delete process.env.HELLOTRACKS_API_URL;
    } else {
      process.env.HELLOTRACKS_API_URL = previousApiUrl;
    }
    await fs.rm(home, { recursive: true, force: true });
  }
});
