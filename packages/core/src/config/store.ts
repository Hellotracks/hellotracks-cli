import fs from "node:fs/promises";
import { mkdirSync } from "node:fs";
import type { CommandContext, ConfigFile, ProfileRecord } from "../types.js";
import { configDir, configPath, DEFAULT_API_URL, DEFAULT_PROFILE, toolName } from "../utils.js";
import { deleteKeychain, readKeychain, writeKeychain, type CredentialStorage } from "./keychain.js";

const EMPTY_CONFIG: ConfigFile = {
  currentProfile: DEFAULT_PROFILE,
  profiles: {
    [DEFAULT_PROFILE]: {
      apiUrl: DEFAULT_API_URL
    }
  }
};

let legacyFallbackWarningShown = false;
let stdinApiKeyPromise: Promise<string | undefined> | undefined;
let argvApiKeyWarningShown = false;

function canWarnAboutLegacyFallback(): boolean {
  return Boolean(process.stderr.isTTY);
}

function warnLegacyFallback(): void {
  if (legacyFallbackWarningShown || !canWarnAboutLegacyFallback()) {
    return;
  }
  legacyFallbackWarningShown = true;
  process.stderr.write(`Warning: ignoring legacy plaintext API key storage in ~/.config/hellotracks-cli/config.json. Run \`${toolName()} auth login\` to reconfigure secure auth.\n`);
}

function warnArgvApiKey(): void {
  if (argvApiKeyWarningShown || !process.stderr.isTTY) {
    return;
  }
  argvApiKeyWarningShown = true;
  process.stderr.write(`Warning: passing --api-key on the command line is deprecated because it can leak in shell history and process lists. Use HELLOTRACKS_API_KEY_FILE, --api-key-stdin, or \`${toolName()} auth login\`.\n`);
}

function normalizeProfile(profile: ProfileRecord | undefined): ProfileRecord {
  return profile?.apiUrl ? { apiUrl: profile.apiUrl } : {};
}

async function readApiKeyFile(path: string): Promise<string | undefined> {
  const raw = await fs.readFile(path, "utf8");
  const value = raw.trim();
  return value || undefined;
}

async function readApiKeyFromStdin(): Promise<string | undefined> {
  if (!stdinApiKeyPromise) {
    stdinApiKeyPromise = (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      const value = Buffer.concat(chunks).toString("utf8").trim();
      if (!value) {
        throw new Error("No API key was provided on stdin.");
      }
      return value;
    })();
  }
  return stdinApiKeyPromise;
}

export async function loadConfig(): Promise<ConfigFile> {
  try {
    const raw = await fs.readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as {
      currentProfile?: string;
      profiles?: Record<string, ProfileRecord & { apiKeyFallback?: string }>;
    };
    if (Object.values(parsed.profiles ?? {}).some((profile) => Boolean(profile.apiKeyFallback))) {
      warnLegacyFallback();
    }
    return {
      currentProfile: parsed.currentProfile || DEFAULT_PROFILE,
      profiles: Object.fromEntries(
        Object.entries({
          ...EMPTY_CONFIG.profiles,
          ...parsed.profiles
        }).map(([key, value]) => [key, normalizeProfile(value)])
      )
    };
  } catch {
    return structuredClone(EMPTY_CONFIG);
  }
}

export async function saveConfig(config: ConfigFile): Promise<void> {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    await fs.chmod(configDir(), 0o700).catch(() => {});
  }
  await fs.writeFile(configPath(), `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") {
    await fs.chmod(configPath(), 0o600).catch(() => {});
  }
}

export async function resolveProfile(context: CommandContext): Promise<{ config: ConfigFile; profileName: string; profile: ProfileRecord; apiKey: string | undefined; apiUrl: string; }> {
  const config = await loadConfig();
  const profileName = context.profileExplicit ? context.profile : config.currentProfile || DEFAULT_PROFILE;
  if (context.confirmProfile && context.confirmProfile !== profileName) {
    throw new Error(`Profile confirmation failed: expected "${context.confirmProfile}" but active profile is "${profileName}".`);
  }
  const profile = config.profiles[profileName] ?? { apiUrl: DEFAULT_API_URL };
  const apiUrl = context.apiUrl || process.env.HELLOTRACKS_API_URL || profile.apiUrl || DEFAULT_API_URL;
  if (context.apiKey) {
    warnArgvApiKey();
  }
  const envKey = context.apiKey || process.env.HELLOTRACKS_API_KEY;
  const fileKeyPath = process.env.HELLOTRACKS_API_KEY_FILE?.trim();
  const apiKeyFromStdin = context.apiKeyStdin ? await readApiKeyFromStdin() : undefined;
  const apiKeyFromFile = !envKey && !apiKeyFromStdin && fileKeyPath ? await readApiKeyFile(fileKeyPath) : undefined;
  const keychainKey = envKey || apiKeyFromStdin || apiKeyFromFile ? undefined : await readKeychain(profileName);
  const apiKey = envKey || apiKeyFromStdin || apiKeyFromFile || keychainKey;
  return { config, profileName, profile, apiKey, apiUrl };
}

export async function persistProfile(profileName: string, apiUrl: string, apiKey: string): Promise<CredentialStorage | "external"> {
  const config = await loadConfig();
  config.currentProfile = profileName;
  config.profiles[profileName] = {
    ...(config.profiles[profileName] ?? {}),
    apiUrl
  };
  const credentialStorage = await writeKeychain(profileName, apiKey);
  await saveConfig(config);
  return credentialStorage ?? "external";
}

export async function clearProfile(profileName: string): Promise<void> {
  const config = await loadConfig();
  await deleteKeychain(profileName);
  await saveConfig(config);
}

export async function listProfiles(): Promise<{ currentProfile: string; profiles: Array<{ name: string; apiUrl: string | undefined; authenticated: boolean }> }> {
  const config = await loadConfig();
  const profiles = await Promise.all(Object.entries(config.profiles).map(async ([name, profile]) => ({
    name,
    apiUrl: profile.apiUrl,
    authenticated: Boolean(await readKeychain(name))
  })));
  return {
    currentProfile: config.currentProfile,
    profiles
  };
}

export async function saveProfile(profileName: string, apiUrl?: string): Promise<{ name: string; apiUrl: string | undefined }> {
  const config = await loadConfig();
  config.profiles[profileName] = {
    ...(config.profiles[profileName] ?? {}),
    ...(apiUrl ? { apiUrl } : {})
  };
  await saveConfig(config);
  return { name: profileName, apiUrl: config.profiles[profileName]?.apiUrl };
}

export async function useProfile(profileName: string): Promise<{ currentProfile: string; apiUrl: string | undefined }> {
  const config = await loadConfig();
  config.currentProfile = profileName;
  config.profiles[profileName] = config.profiles[profileName] ?? {};
  await saveConfig(config);
  return { currentProfile: profileName, apiUrl: config.profiles[profileName]?.apiUrl };
}
