import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FALLBACK_VERSION = "0.0.0-unknown";

export function packageVersion(): string {
  try {
    const packageJsonPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
    return typeof packageJson.version === "string" && packageJson.version ? packageJson.version : FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}
