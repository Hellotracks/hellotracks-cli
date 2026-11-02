import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { configDir } from "@hellotracks/ht-core/utils.js";

export const DEFAULT_CLI_UPDATE_BASE_URL = "https://cli.hellotracks.org";
export const AUTO_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const AUTO_UPDATE_CHECK_TIMEOUT_MS = 750;

export interface CliUpdateManifest {
  version: string;
  channel?: string;
  createdAt?: string;
}

export interface CliUpdateDeps {
  fetch?: typeof fetch;
  runInstall?: (baseUrl: string) => Promise<void>;
  now?: () => number;
}

export interface CliUpdateCheckResult {
  status: "current" | "available";
  currentVersion: string;
  latestVersion: string;
  baseUrl: string;
  updateAvailable: boolean;
}

export interface CliUpdateResult extends Omit<CliUpdateCheckResult, "status"> {
  status: "current" | "updated";
}

export interface AutoCliUpdateCheckResult extends Omit<CliUpdateCheckResult, "status"> {
  status: "skipped" | "current" | "available" | "error";
  error?: string;
}

interface AutoUpdateCache {
  checkedAt?: number;
  latestVersion?: string;
}

function normalizeBaseUrl(baseUrl?: string): string {
  const normalized = (baseUrl || DEFAULT_CLI_UPDATE_BASE_URL).trim().replace(/\/+$/, "");
  if (!normalized) {
    throw new Error("Update base URL must be non-empty.");
  }
  return normalized;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function tokenizeVersion(version: string): string[] {
  return version.match(/\d+|[a-zA-Z]+|[^a-zA-Z\d]+/g) ?? [version];
}

export function compareCliVersions(left: string, right: string): number {
  const leftParts = tokenizeVersion(left);
  const rightParts = tokenizeVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const a = leftParts[index] ?? "";
    const b = rightParts[index] ?? "";
    if (a === b) {
      continue;
    }
    const aNum = /^\d+$/.test(a) ? Number(a) : undefined;
    const bNum = /^\d+$/.test(b) ? Number(b) : undefined;
    if (aNum !== undefined && bNum !== undefined) {
      return Math.sign(aNum - bNum);
    }
    return a < b ? -1 : 1;
  }
  return 0;
}

export async function fetchCliUpdateManifest(baseUrl?: string, deps: CliUpdateDeps = {}): Promise<CliUpdateManifest> {
  const resolvedBaseUrl = normalizeBaseUrl(baseUrl);
  const response = await (deps.fetch ?? fetch)(`${resolvedBaseUrl}/manifest.json`, {
    headers: {
      accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch update manifest: HTTP ${response.status}`);
  }
  const manifest = await response.json() as Record<string, unknown>;
  const version = stringValue(manifest.version);
  if (!version) {
    throw new Error("Update manifest is missing version.");
  }
  return {
    version,
    ...(stringValue(manifest.channel) ? { channel: String(manifest.channel) } : {}),
    ...(stringValue(manifest.createdAt) ? { createdAt: String(manifest.createdAt) } : {})
  };
}

function updateCheckCachePath(): string {
  return path.join(configDir(), "update-check.json");
}

async function readAutoUpdateCache(cachePath: string): Promise<AutoUpdateCache> {
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as AutoUpdateCache;
    const cache: AutoUpdateCache = {};
    if (typeof parsed.checkedAt === "number") {
      cache.checkedAt = parsed.checkedAt;
    }
    const latestVersion = stringValue(parsed.latestVersion);
    if (latestVersion) {
      cache.latestVersion = latestVersion;
    }
    return cache;
  } catch {
    return {};
  }
}

async function writeAutoUpdateCache(cachePath: string, cache: AutoUpdateCache): Promise<void> {
  await fs.mkdir(path.dirname(cachePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function checkCliUpdate(
  currentVersion: string,
  options: { baseUrl?: string } = {},
  deps: CliUpdateDeps = {}
): Promise<CliUpdateCheckResult> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const manifest = await fetchCliUpdateManifest(baseUrl, deps);
  const updateAvailable = compareCliVersions(manifest.version, currentVersion) > 0;
  return {
    status: updateAvailable ? "available" : "current",
    currentVersion,
    latestVersion: manifest.version,
    baseUrl,
    updateAvailable
  };
}

export async function autoCheckCliUpdate(
  currentVersion: string,
  options: { baseUrl?: string; cachePath?: string; intervalMs?: number; timeoutMs?: number; force?: boolean } = {},
  deps: CliUpdateDeps = {}
): Promise<AutoCliUpdateCheckResult> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const cachePath = options.cachePath ?? updateCheckCachePath();
  const now = deps.now ? deps.now() : Date.now();
  const intervalMs = options.intervalMs ?? AUTO_UPDATE_CHECK_INTERVAL_MS;
  const cached = await readAutoUpdateCache(cachePath);
  if (!options.force && cached.checkedAt && now - cached.checkedAt < intervalMs) {
    const latestVersion = cached.latestVersion ?? currentVersion;
    const updateAvailable = compareCliVersions(latestVersion, currentVersion) > 0;
    return {
      status: "skipped",
      currentVersion,
      latestVersion,
      baseUrl,
      updateAvailable
    };
  }

  const timeoutMs = options.timeoutMs ?? AUTO_UPDATE_CHECK_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs).unref();
  try {
    const check = await checkCliUpdate(currentVersion, { baseUrl }, {
      ...deps,
      fetch: async (input, init) => (deps.fetch ?? fetch)(input, {
        ...init,
        signal: controller.signal
      })
    });
    await writeAutoUpdateCache(cachePath, {
      checkedAt: now,
      latestVersion: check.latestVersion
    }).catch(() => {});
    return check;
  } catch (error) {
    return {
      status: "error",
      currentVersion,
      latestVersion: currentVersion,
      baseUrl,
      updateAvailable: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function runHostedInstaller(baseUrl: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const command = `curl -fsSL ${shellQuote(`${baseUrl}/install.sh`)} | bash -s -- --base-url ${shellQuote(baseUrl)}`;
    const child = spawn(command, {
      shell: true,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("close", (exitCode, signal) => {
      if (exitCode === 0) {
        resolve();
        return;
      }
      reject(new Error(signal
        ? `Installer exited from signal ${signal}.`
        : `Installer exited with code ${exitCode ?? 1}.`));
    });
  });
}

export async function updateCli(
  currentVersion: string,
  options: { baseUrl?: string; force?: boolean } = {},
  deps: CliUpdateDeps = {}
): Promise<CliUpdateResult> {
  const check = await checkCliUpdate(currentVersion, options.baseUrl ? { baseUrl: options.baseUrl } : {}, deps);
  if (!options.force && !check.updateAvailable) {
    return {
      ...check,
      status: "current"
    };
  }
  await (deps.runInstall ?? runHostedInstaller)(check.baseUrl);
  return {
    ...check,
    status: "updated"
  };
}
