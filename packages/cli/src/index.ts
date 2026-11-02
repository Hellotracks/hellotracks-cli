#!/usr/bin/env node

import { runCli } from "./cli.js";

// `ht ... | head` closes stdout early; that is not an error.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") {
    process.exit(process.exitCode ?? 0);
  }
  throw error;
});

runCli().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
