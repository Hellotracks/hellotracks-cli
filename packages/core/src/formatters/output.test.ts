import test from "node:test";
import assert from "node:assert/strict";
import { render } from "./output.js";
import type { CommandContext } from "../types.js";

function capture(fn: () => void): string {
  let output = "";
  const originalWrite = process.stdout.write.bind(process.stdout);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout.write as any) = (chunk: string) => {
    output += chunk;
    return true;
  };
  try {
    fn();
    return output;
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout.write as any) = originalWrite;
  }
}

const tableContext: CommandContext = {
  profile: "test",
  apiUrl: undefined,
  apiKey: undefined,
  output: "table",
  noInput: true,
  quiet: true,
  verbose: false,
  yes: false
};

test("render outputs a simple table", () => {
  const text = capture(() => render(tableContext, [{ id: "a1", name: "Alice" }], "table"));
  assert.match(text, /id/);
  assert.match(text, /Alice/);
});
