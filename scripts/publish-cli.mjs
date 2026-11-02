#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const buildRoot = path.join(rootDir, ".build", "release");

const defaultBucket = "ht-cli";
const defaultPublicBaseUrl = "https://cli.hellotracks.org";

function usage() {
  return `Usage: npm run publish:cli -- [options]

Uploads the latest npm run build:release output to Cloudflare R2 with Wrangler.

Options:
  --release-dir <path>     Release directory to publish. Defaults to latest .build/release/*.
  --bucket <name>          R2 bucket name. Defaults to ${defaultBucket}.
  --public-base-url <url>  Public install base URL. Defaults to ${defaultPublicBaseUrl}.
  --dry-run                Print the upload plan without writing objects.
  -h, --help               Show this help.

Optional environment:
  HT_CLI_R2_BUCKET         Overrides --bucket default.
  HT_CLI_PUBLIC_BASE_URL   Overrides --public-base-url default.
  HT_CLI_RELEASE_DIR       Overrides latest release directory lookup.
  HT_CLI_PUBLISH_DRY_RUN   Set to 1 to enable dry-run mode.

Real publishes require npx and a logged-in Wrangler session with access to the R2 bucket.
`;
}

function parseArgs(argv) {
  const options = {
    bucket: process.env.HT_CLI_R2_BUCKET?.trim() || defaultBucket,
    publicBaseUrl: process.env.HT_CLI_PUBLIC_BASE_URL?.trim() || defaultPublicBaseUrl,
    releaseDir: process.env.HT_CLI_RELEASE_DIR?.trim() || "",
    dryRun: process.env.HT_CLI_PUBLISH_DRY_RUN === "1"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--bucket") {
      options.bucket = requiredValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--public-base-url") {
      options.publicBaseUrl = requiredValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--release-dir") {
      options.releaseDir = requiredValue(argv, ++index, arg);
      continue;
    }
    throw new Error(`Unknown option: ${arg}\n\n${usage()}`);
  }

  options.publicBaseUrl = options.publicBaseUrl.replace(/\/+$/, "");
  return options;
}

function requiredValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function commandExists(command) {
  try {
    execFileSync("sh", ["-lc", `command -v ${shellQuote(command)}`], {
      stdio: "ignore"
    });
    return true;
  } catch {
    return false;
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function findLatestReleaseDir() {
  if (!existsSync(buildRoot)) {
    throw new Error(`No CLI release build found at ${buildRoot}. Run npm run build:release first.`);
  }

  const entries = await fs.readdir(buildRoot, { withFileTypes: true });
  const releaseDirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const fullPath = path.join(buildRoot, entry.name);
    const stat = await fs.stat(fullPath);
    releaseDirs.push({ fullPath, mtimeMs: stat.mtimeMs });
  }

  releaseDirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const latest = releaseDirs[0]?.fullPath;
  if (!latest) {
    throw new Error(`No CLI release build found at ${buildRoot}. Run npm run build:release first.`);
  }
  return latest;
}

async function validateReleaseDir(releaseDir) {
  const requiredFiles = [
    "install.sh",
    "manifest.json"
  ];
  for (const relativePath of requiredFiles) {
    const file = path.join(releaseDir, relativePath);
    if (!existsSync(file)) {
      throw new Error(`Release directory is missing ${relativePath}: ${releaseDir}`);
    }
  }

  const manifestFile = path.join(releaseDir, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  if (!manifest.version || !Array.isArray(manifest.artifacts)) {
    throw new Error(`Invalid manifest: ${manifestFile}`);
  }
  for (const artifact of manifest.artifacts) {
    if (!artifact.file || !existsSync(path.join(releaseDir, artifact.file))) {
      throw new Error(`Manifest references missing artifact: ${artifact.file}`);
    }
  }
  return manifest;
}

function contentType(file) {
  if (file.endsWith(".json")) {
    return "application/json";
  }
  if (file.endsWith(".sh")) {
    return "text/x-sh";
  }
  if (file.endsWith(".tar.gz")) {
    return "application/gzip";
  }
  return "application/octet-stream";
}

function runWrangler(args, options) {
  process.stderr.write(`$ npx wrangler ${args.map(shellQuote).join(" ")}\n`);
  if (options.dryRun) {
    return;
  }
  execFileSync("npx", ["wrangler", ...args], {
    cwd: rootDir,
    stdio: "inherit"
  });
}

function uploadFile(options, sourceFile, key, cacheControl) {
  runWrangler([
    "r2",
    "object",
    "put",
    `${options.bucket}/${key}`,
    "--file",
    sourceFile,
    "--content-type",
    contentType(key),
    "--cache-control",
    cacheControl,
    "--remote",
    "--force"
  ], options);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  if (!options.dryRun && !commandExists("npx")) {
    throw new Error("Missing npx. Install Node.js/npm before publishing with Wrangler.");
  }

  const releaseDir = path.resolve(options.releaseDir || await findLatestReleaseDir());
  const manifest = await validateReleaseDir(releaseDir);

  process.stderr.write(`Publishing ht-cli ${manifest.version}\n`);
  process.stderr.write(`Release: ${releaseDir}\n`);
  process.stderr.write(`Bucket:  ${options.bucket}\n`);
  process.stderr.write(`Public:  ${options.publicBaseUrl}\n`);
  if (options.dryRun) {
    process.stderr.write("Mode:    dry run\n");
  }

  for (const artifact of manifest.artifacts) {
    uploadFile(
      options,
      path.join(releaseDir, artifact.file),
      artifact.file,
      "public,max-age=31536000,immutable"
    );
  }

  uploadFile(
    options,
    path.join(releaseDir, "install.sh"),
    "install.sh",
    "no-cache"
  );

  // Publish the manifest last so installers never see a new version before
  // the referenced tarballs are available.
  uploadFile(
    options,
    path.join(releaseDir, "manifest.json"),
    "manifest.json",
    "no-cache"
  );

  if (options.dryRun) {
    process.stdout.write(`Dry run complete for ht-cli ${manifest.version} to r2://${options.bucket}\n`);
  } else {
    process.stdout.write(`Published ht-cli ${manifest.version} to r2://${options.bucket}\n`);
  }
  process.stdout.write(`Install with: curl -fsSL ${options.publicBaseUrl}/install.sh | bash\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
