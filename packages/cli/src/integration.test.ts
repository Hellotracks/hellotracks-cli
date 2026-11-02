import test from "node:test";
import assert from "node:assert/strict";
import { ApiClient } from "@hellotracks/ht-core/client/api-client.js";
import type { CommandContext } from "@hellotracks/ht-core/types.js";

// Runs only when a test company is given: HT_TEST_API_URL and HT_TEST_API_KEY.
const apiUrl = process.env.HT_TEST_API_URL;
const apiKey = process.env.HT_TEST_API_KEY;

const context: CommandContext = {
  profile: "integration",
  apiUrl: apiUrl,
  apiKey: apiKey,
  output: "json",
  noInput: true,
  quiet: true,
  verbose: false,
  yes: false
};

test("whoami against a test company", { skip: !(apiUrl && apiKey) }, async () => {
  const client = new ApiClient(apiUrl!, apiKey!, context);
  const result = await client.get<Record<string, unknown>>("/auth/whoami");
  assert.ok(result);
});
