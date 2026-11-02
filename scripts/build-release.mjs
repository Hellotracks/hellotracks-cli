#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const cliPackageDir = path.join(rootDir, "packages", "cli");
const corePackageDir = path.join(rootDir, "packages", "core");
const buildRoot = path.join(rootDir, ".build", "release");
const stageRoot = path.join(rootDir, ".build", "release-stage");

const channel = "stable";
const nodeVersion = "22.23.4";
const defaultApiUrl = "https://api.hellotracks.com/v1";
const nodeBaseUrl = `https://nodejs.org/dist/v${nodeVersion}`;
const supportedArtifacts = [
  { platform: "darwin", arch: "arm64", nodePlatform: "darwin", nodeArch: "arm64" },
  { platform: "darwin", arch: "x64", nodePlatform: "darwin", nodeArch: "x64" },
  { platform: "linux", arch: "arm64", nodePlatform: "linux", nodeArch: "arm64" },
  { platform: "linux", arch: "x64", nodePlatform: "linux", nodeArch: "x64" }
];

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    ...options
  });
}

async function copyRecursive(source, target) {
  const stat = await fs.stat(source);
  if (stat.isDirectory()) {
    await fs.mkdir(target, { recursive: true });
    for (const entry of await fs.readdir(source)) {
      await copyRecursive(path.join(source, entry), path.join(target, entry));
    }
    return;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

async function fileSize(file) {
  const stat = await fs.stat(file);
  return stat.size;
}

async function sha256(file) {
  const hash = createHash("sha256");
  hash.update(await fs.readFile(file));
  return hash.digest("hex");
}

function tarEntries(file) {
  return execFileSync("tar", ["-tzf", file], {
    cwd: rootDir,
    encoding: "utf8"
  }).split("\n").filter(Boolean);
}

function assertBundleEntries(entries) {
  for (const entry of entries) {
    const normalized = entry.split("/").slice(1).join("/");
    if (!normalized) {
      continue;
    }
    if (/^demo-scenarios\/.*\.ya?ml$/i.test(normalized)) {
      throw new Error(`Release bundle contains a forbidden scenario file: ${entry}`);
    }
    if (/^src\//.test(normalized) || /^scripts\//.test(normalized) || /^docs\//.test(normalized)) {
      throw new Error(`Release bundle contains a repo-only path: ${entry}`);
    }
    if (/^\.env(\.|$)/.test(normalized) || normalized === "config.json") {
      throw new Error(`Release bundle contains a forbidden config file: ${entry}`);
    }
    if (/^dist\/.*\.test\.(js|d\.ts|js\.map)$/i.test(normalized)) {
      throw new Error(`Release bundle contains a test artifact: ${entry}`);
    }
  }
}

async function prepareStageApp(stageAppDir) {
  await fs.rm(stageAppDir, { recursive: true, force: true });
  await fs.mkdir(stageAppDir, { recursive: true });

  const cliPackageJson = JSON.parse(await fs.readFile(path.join(cliPackageDir, "package.json"), "utf8"));
  const corePackageJson = JSON.parse(await fs.readFile(path.join(corePackageDir, "package.json"), "utf8"));
  const externalDependencies = {
    ...corePackageJson.dependencies,
    ...cliPackageJson.dependencies
  };
  delete externalDependencies["@hellotracks/ht-core"];

  await copyRecursive(path.join(cliPackageDir, "dist"), path.join(stageAppDir, "dist"));
  await fs.writeFile(path.join(stageAppDir, "package.json"), `${JSON.stringify({
    name: cliPackageJson.name,
    version: cliPackageJson.version,
    private: true,
    description: cliPackageJson.description,
    type: cliPackageJson.type,
    dependencies: externalDependencies
  }, null, 2)}\n`, "utf8");
  await fs.copyFile(path.join(rootDir, "README.md"), path.join(stageAppDir, "README.md"));

  run("npm", ["install", "--omit=dev", "--ignore-scripts", "--package-lock=false"], {
    cwd: stageAppDir,
    stdio: "inherit"
  });

  const stagedCoreDir = path.join(stageAppDir, "node_modules", "@hellotracks", "ht-core");
  await fs.mkdir(stagedCoreDir, { recursive: true });
  await copyRecursive(path.join(corePackageDir, "dist"), path.join(stagedCoreDir, "dist"));
  await fs.writeFile(path.join(stagedCoreDir, "package.json"), `${JSON.stringify({
    name: corePackageJson.name,
    version: corePackageJson.version,
    type: corePackageJson.type,
    main: corePackageJson.main,
    types: corePackageJson.types,
    exports: corePackageJson.exports
  }, null, 2)}\n`, "utf8");
}

function launcherScript() {
  return `#!/bin/sh
set -eu

SCRIPT_PATH="$0"
while [ -L "$SCRIPT_PATH" ]; do
  LINK_TARGET="$(readlink "$SCRIPT_PATH")"
  case "$LINK_TARGET" in
    /*) SCRIPT_PATH="$LINK_TARGET" ;;
    *) SCRIPT_PATH="$(dirname "$SCRIPT_PATH")/$LINK_TARGET" ;;
  esac
done

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$SCRIPT_PATH")" && pwd -P)"
APP_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"

export HT_RELEASE_CHANNEL="${channel}"

exec "$APP_ROOT/runtime/node/bin/node" "$APP_ROOT/dist/index.js" "$@"
`;
}

async function writeBundlePackageJson(targetFile, packageJson, version) {
  const payload = {
    name: packageJson.name,
    version,
    private: true,
    description: packageJson.description,
    type: packageJson.type
  };
  await fs.writeFile(targetFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function ensureNodeArchive(downloadDir, platform, arch) {
  const fileName = `node-v${nodeVersion}-${platform}-${arch}.tar.gz`;
  const targetFile = path.join(downloadDir, fileName);
  if (!existsSync(targetFile)) {
    await fs.mkdir(downloadDir, { recursive: true });
    run("curl", ["-fsSL", `${nodeBaseUrl}/${fileName}`, "-o", targetFile], {
      cwd: rootDir,
      stdio: "inherit"
    });
  }
  return targetFile;
}

async function unpackNodeRuntime(downloadFile, targetDir, platform, arch) {
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetDir, { recursive: true });
  run("tar", ["-xzf", downloadFile, "-C", targetDir], {
    cwd: rootDir,
    stdio: "inherit"
  });
  return path.join(targetDir, `node-v${nodeVersion}-${platform}-${arch}`);
}

async function pruneNodeRuntime(runtimeDir) {
  const removable = [
    "CHANGELOG.md",
    "README.md",
    path.join("include"),
    path.join("share"),
    path.join("bin", "npm"),
    path.join("bin", "npx"),
    path.join("bin", "corepack"),
    path.join("lib", "node_modules", "npm"),
    path.join("lib", "node_modules", "corepack")
  ];
  for (const relativePath of removable) {
    await fs.rm(path.join(runtimeDir, relativePath), { recursive: true, force: true });
  }
}

async function buildArtifact({ platform, arch, nodePlatform, nodeArch }, options) {
  const stageAppDir = path.join(stageRoot, "app");
  const releaseDir = options.releaseDir;
  const bundleDir = path.join(releaseDir, `ht-cli-${platform}-${arch}`);
  const nodeArchive = await ensureNodeArchive(path.join(stageRoot, "downloads"), nodePlatform, nodeArch);
  const unpackedNodeDir = await unpackNodeRuntime(nodeArchive, path.join(stageRoot, `node-${platform}-${arch}`), nodePlatform, nodeArch);

  await fs.rm(bundleDir, { recursive: true, force: true });
  await fs.mkdir(path.join(bundleDir, "bin"), { recursive: true });
  await fs.mkdir(path.join(bundleDir, "runtime"), { recursive: true });

  await copyRecursive(path.join(stageAppDir, "dist"), path.join(bundleDir, "dist"));
  await copyRecursive(path.join(stageAppDir, "node_modules"), path.join(bundleDir, "node_modules"));
  await copyRecursive(unpackedNodeDir, path.join(bundleDir, "runtime", "node"));
  await pruneNodeRuntime(path.join(bundleDir, "runtime", "node"));
  await fs.copyFile(path.join(stageAppDir, "README.md"), path.join(bundleDir, "README.md"));
  await writeBundlePackageJson(path.join(bundleDir, "package.json"), options.packageJson, options.version);
  await fs.writeFile(path.join(bundleDir, "bin", "ht"), launcherScript(), "utf8");
  await fs.chmod(path.join(bundleDir, "bin", "ht"), 0o755);

  const tarball = path.join(releaseDir, `ht-cli-${options.version}-${platform}-${arch}.tar.gz`);
  await fs.rm(tarball, { force: true });
  run("tar", ["-czf", tarball, "-C", releaseDir, path.basename(bundleDir)], {
    cwd: rootDir,
    stdio: "inherit"
  });

  const entries = tarEntries(tarball);
  assertBundleEntries(entries);

  await fs.rm(bundleDir, { recursive: true, force: true });

  return {
    platform,
    arch,
    file: path.basename(tarball),
    sizeBytes: await fileSize(tarball),
    sha256: await sha256(tarball)
  };
}

async function main() {
  if (!["darwin", "linux"].includes(os.platform())) {
    throw new Error("The release build currently supports running on macOS or Linux.");
  }

  const packageJson = JSON.parse(await fs.readFile(path.join(cliPackageDir, "package.json"), "utf8"));
  const version = process.env.HT_RELEASE_VERSION?.trim() || packageJson.version;
  const releaseDir = path.join(buildRoot, version);

  await fs.rm(releaseDir, { recursive: true, force: true });
  await fs.mkdir(releaseDir, { recursive: true });
  await fs.mkdir(stageRoot, { recursive: true });

  run("npm", ["run", "build"], {
    cwd: rootDir,
    stdio: "inherit"
  });

  await prepareStageApp(path.join(stageRoot, "app"));

  const artifacts = [];
  for (const artifact of supportedArtifacts) {
    artifacts.push(await buildArtifact(artifact, {
      releaseDir,
      version,
      packageJson
    }));
  }

  await fs.copyFile(path.join(rootDir, "scripts", "install.sh"), path.join(releaseDir, "install.sh"));
  await fs.chmod(path.join(releaseDir, "install.sh"), 0o755);

  const manifest = {
    version,
    channel,
    defaultApiUrl,
    nodeVersion,
    createdAt: new Date().toISOString(),
    artifacts
  };
  await fs.writeFile(path.join(releaseDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  process.stdout.write(`Release artifacts written to ${releaseDir}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
