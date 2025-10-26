#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const PLATFORM_MAP = {
  win32: {
    x64: "@oxlint/win32-x64/oxlint.exe",
    arm64: "@oxlint/win32-arm64/oxlint.exe",
  },
  darwin: {
    x64: "@oxlint/darwin-x64/oxlint",
    arm64: "@oxlint/darwin-arm64/oxlint",
  },
  linux: {
    x64: {
      musl: "@oxlint/linux-x64-musl/oxlint",
      gnu: "@oxlint/linux-x64-gnu/oxlint",
    },
    arm64: {
      musl: "@oxlint/linux-arm64-musl/oxlint",
      gnu: "@oxlint/linux-arm64-gnu/oxlint",
    },
  },
};

function isMusl() {
  if (process.platform !== "linux") {
    return false;
  }
  const fromFs = isMuslFromFilesystem();
  if (fromFs !== null) return fromFs;
  const fromReport = isMuslFromReport();
  if (fromReport !== null) return fromReport;
  return isMuslFromChildProcess();
}

function isMuslFromFilesystem() {
  try {
    return readFileSync("/usr/bin/ldd", "utf8").includes("musl");
  } catch {
    return null;
  }
}

function isMuslFromReport() {
  const report =
    typeof process.report?.getReport === "function"
      ? process.report.getReport()
      : null;
  if (!report) return null;
  if (report.header?.glibcVersionRuntime) return false;
  if (Array.isArray(report.sharedObjects)) {
    return report.sharedObjects.some(
      (item) => item.includes("libc.musl-") || item.includes("ld-musl-"),
    );
  }
  return null;
}

function isMuslFromChildProcess() {
  try {
    const output = spawnSync("ldd", ["--version"], { encoding: "utf8" });
    if (output.error || typeof output.stdout !== "string") return false;
    return output.stdout.includes("musl");
  } catch {
    return false;
  }
}

function resolveBinary() {
  const platformEntry = PLATFORM_MAP[process.platform];
  if (!platformEntry) return null;

  if (process.platform === "linux") {
    const archEntry = platformEntry[process.arch];
    if (!archEntry) return null;
    const flavor = isMusl() ? "musl" : "gnu";
    const packageName = archEntry[flavor];
    if (!packageName) return null;
    try {
      return require.resolve(packageName);
    } catch {
      return null;
    }
  }

  const packageName = platformEntry[process.arch];
  if (!packageName) return null;
  try {
    return require.resolve(packageName);
  } catch {
    return null;
  }
}

const binary = resolveBinary();

if (!binary) {
  console.error(
    `oxlint: unsupported platform (${process.platform}-${process.arch})`,
  );
  process.exit(1);
}

const env = {
  ...process.env,
  JS_RUNTIME_VERSION: process.version,
  JS_RUNTIME_NAME: process.release?.name ?? "node",
};

const packageManager = process.env.npm_config_user_agent?.split(" ")[0];
if (packageManager) {
  env.NODE_PACKAGE_MANAGER = packageManager;
}

const result = spawnSync(binary, process.argv.slice(2), {
  stdio: "inherit",
  env,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 0);
