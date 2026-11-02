import fs from "node:fs/promises";
import path from "node:path";
import { configDir } from "../utils.js";

// What `ht signup` asked for, kept until `ht signup --code` finishes it. No secrets: the code arrives by email.
export interface PendingSignup {
  email: string;
  name: string;
  company: string;
  address?: string | undefined;
  lat?: number | undefined;
  lng?: number | undefined;
  apiUrl: string;
  createdAt: number;
}

export function pendingSignupPath(profile: string): string {
  return path.join(configDir(), `signup-${profile.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
}

export async function savePendingSignup(profile: string, pending: PendingSignup): Promise<void> {
  await fs.mkdir(configDir(), { recursive: true, mode: 0o700 });
  await fs.writeFile(pendingSignupPath(profile), `${JSON.stringify(pending, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function readPendingSignup(profile: string): Promise<PendingSignup | undefined> {
  try {
    return JSON.parse(await fs.readFile(pendingSignupPath(profile), "utf8")) as PendingSignup;
  } catch {
    return undefined;
  }
}

export async function clearPendingSignup(profile: string): Promise<void> {
  await fs.rm(pendingSignupPath(profile), { force: true });
}

// For CI: the key goes to a file only the current user can read, never to stdout.
export async function writeKeyFile(file: string, apiKey: string): Promise<void> {
  await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await fs.writeFile(file, `${apiKey}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(file, 0o600).catch(() => {});
}
