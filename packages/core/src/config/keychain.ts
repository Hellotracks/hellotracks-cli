import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { configDir } from "../utils.js";

const execFileAsync = promisify(execFile);
const SERVICE = "hellotracks-cli";
const CREDENTIALS_DIRNAME = "credentials";

export type CredentialStorage = "keychain" | "private-file";

function isMacOs(): boolean {
  return process.platform === "darwin";
}

function usePrivateFileStore(): boolean {
  return process.env.HT_CLI_CREDENTIAL_STORE === "private-file"
    || (!isMacOs() && process.platform !== "win32");
}

function credentialsDir(): string {
  return path.join(configDir(), CREDENTIALS_DIRNAME);
}

function credentialFileName(profile: string): string {
  return `${encodeURIComponent(profile || "default")}.api-key`;
}

export function privateCredentialPath(profile: string): string {
  return path.join(credentialsDir(), credentialFileName(profile));
}

async function chmodIfSupported(target: string, mode: number): Promise<void> {
  if (process.platform === "win32") {
    return;
  }
  await fs.chmod(target, mode).catch(() => {});
}

async function readPrivateCredential(profile: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(privateCredentialPath(profile), "utf8");
    return raw.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function writePrivateCredential(profile: string, apiKey: string): Promise<void> {
  mkdirSync(credentialsDir(), { recursive: true, mode: 0o700 });
  await chmodIfSupported(credentialsDir(), 0o700);
  const target = privateCredentialPath(profile);
  await fs.writeFile(target, `${apiKey.trim()}\n`, { encoding: "utf8", mode: 0o600 });
  await chmodIfSupported(target, 0o600);
}

async function deletePrivateCredential(profile: string): Promise<void> {
  await fs.rm(privateCredentialPath(profile), { force: true });
}

export async function readKeychain(profile: string): Promise<string | undefined> {
  if (usePrivateFileStore()) {
    return readPrivateCredential(profile);
  }
  if (!isMacOs()) {
    return undefined;
  }
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-s",
      SERVICE,
      "-a",
      profile,
      "-w"
    ]);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function writeKeychain(profile: string, apiKey: string): Promise<CredentialStorage | undefined> {
  if (usePrivateFileStore()) {
    await writePrivateCredential(profile, apiKey);
    return "private-file";
  }
  if (!isMacOs()) {
    return undefined;
  }
  try {
    await execFileAsync("security", [
      "add-generic-password",
      "-U",
      "-s",
      SERVICE,
      "-a",
      profile,
      "-w",
      apiKey
    ]);
    return "keychain";
  } catch {
    return undefined;
  }
}

export async function deleteKeychain(profile: string): Promise<void> {
  if (usePrivateFileStore()) {
    await deletePrivateCredential(profile);
    return;
  }
  if (!isMacOs()) {
    return;
  }
  try {
    await execFileAsync("security", [
      "delete-generic-password",
      "-s",
      SERVICE,
      "-a",
      profile
    ]);
  } catch {
  }
}
