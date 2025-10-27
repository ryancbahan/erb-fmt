#!/usr/bin/env node
/**
 * Smoke-test installation of the packaged formatter with different package managers.
 *
 * The script will:
 *   1. Build the project (npm run build).
 *   2. Create a tarball via `npm pack`.
 *   3. For each available package manager (npm, pnpm, yarn):
 *        - create a clean temporary project,
 *        - install the tarball,
 *        - verify the API can be imported,
 *        - verify the CLI launches with `--help`.
 *
 * The script skips managers that are unavailable or fail due to offline environments,
 * but surfaces other failures as actionable errors.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), "..");
const KEEP_TEMP = process.argv.includes("--keep-temp");

const MANAGER_ORDER = /** @type {const} */ (["npm", "pnpm", "yarn"]);
const CACHE_ROOT = path.join(ROOT_DIR, "tmp", "smoke-cache");

const MANAGER_ENVS = {
  npm: {
    npm_config_cache: path.join(CACHE_ROOT, "npm-cache"),
  },
  pnpm: {
    PNPM_STORE_PATH: path.join(CACHE_ROOT, "pnpm-store"),
    npm_config_cache: path.join(CACHE_ROOT, "pnpm-npm-cache"),
    NODE_OPTIONS: appendNodeOptions(
      process.env.NODE_OPTIONS,
      "--dns-result-order=ipv4first",
    ),
  },
  yarn: {
    YARN_CACHE_FOLDER: path.join(CACHE_ROOT, "yarn-cache"),
  },
};

const INSTALL_CONFIG = {
  npm: {
    installArgs: (tarballPath) => [
      "install",
      tarballPath,
      "--ignore-scripts=false",
      "--no-audit",
      "--no-fund",
    ],
  },
  pnpm: {
    installArgs: (tarballPath) => [
      "add",
      tarballPath,
      "--ignore-scripts=false",
      "--allow-build=tree-sitter",
      "--allow-build=tree-sitter-embedded-template",
      "--allow-build=tree-sitter-html",
      "--allow-build=tree-sitter-ruby",
      "--config.allow-build-scripts=true",
    ],
  },
  yarn: {
    installArgs: (tarballPath) => ["add", tarballPath],
  },
};

async function main() {
  const requestedManagers = parseManagers(process.argv.slice(2));
  const managers = requestedManagers.length ? requestedManagers : MANAGER_ORDER;

  await ensureCacheDirectories();

  const packageJsonPath = path.join(ROOT_DIR, "package.json");
  const packageJsonRaw = await fs.readFile(packageJsonPath, "utf8");
  const packageJson = JSON.parse(packageJsonRaw);
  const packageName = packageJson.name;
  const binEntries = packageJson.bin ? Object.entries(packageJson.bin) : [];
  const preferredBin = binEntries.find(([key]) => key === packageName);
  const binName = preferredBin
    ? preferredBin[0]
    : binEntries.length > 0
      ? binEntries[0][0]
      : packageName;

  console.log("→ Building project (npm run build)…");
  await execRequired("npm", ["run", "build"], {
    cwd: ROOT_DIR,
    env: MANAGER_ENVS.npm,
  });

  console.log("→ Packing release tarball (npm pack)…");
  const tarballPath = await createTarball();
  console.log(`   • Created ${path.basename(tarballPath)}\n`);

  const results = [];
  for (const manager of managers) {
    if (!(manager in INSTALL_CONFIG)) {
      console.warn(`⚠️  Unknown manager "${manager}" – skipping.`);
      continue;
    }
    const result = await smokeManager(
      manager,
      tarballPath,
      packageName,
      binName,
    );
    results.push(result);
    console.log("");
  }

  if (!KEEP_TEMP) {
    await fs.rm(tarballPath, { force: true });
  }

  printSummary(results);

  if (results.some((r) => r.status === "failed")) {
    process.exitCode = 1;
  }
}

/**
 * @param {string[]} argv
 * @returns {string[]}
 */
function parseManagers(argv) {
  const managers = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--manager") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--manager requires a value");
      }
      managers.push(value);
      i += 1;
    }
  }
  return managers;
}

async function createTarball() {
  const packDir = path.join(CACHE_ROOT, "pack");
  await fs.mkdir(packDir, { recursive: true });

  const packArgs = ["pack", "--json", `--pack-destination=${packDir}`];
  const { code, stdout, stderr } = await runCommand("npm", packArgs, {
    cwd: ROOT_DIR,
    silent: true,
    env: MANAGER_ENVS.npm,
  });
  if (code !== 0) {
    throw new Error(`npm pack failed: ${stderr || stdout || "unknown error"}`);
  }
  let entries;
  try {
    entries = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Failed to parse npm pack output: ${error}`);
  }
  if (!Array.isArray(entries) || entries.length === 0 || !entries[0].filename) {
    throw new Error("Unexpected npm pack output");
  }
  return path.join(packDir, entries[0].filename);
}

async function smokeManager(manager, tarballPath, packageName, binName) {
  const label = manager.toUpperCase();
  console.log(`→ ${label}: preparing clean project.`);

  const availability = await checkAvailability(manager);
  if (!availability.available) {
    console.log(`   • Skipped: ${availability.reason}`);
    return { manager, status: "skipped", reason: availability.reason };
  }

  const tempDir = await fs.mkdtemp(
    path.join(tmpdir(), `erb-install-${manager}-`),
  );
  const teardownActions = [];
  if (!KEEP_TEMP) {
    teardownActions.push(() =>
      fs.rm(tempDir, { recursive: true, force: true }),
    );
  } else {
    console.log(`   • Keeping temp project at ${tempDir}`);
  }

  try {
    await initialiseProject(manager, tempDir);
    const installOutcome = await installPackage(manager, tempDir, tarballPath);
    if (installOutcome.status !== "success") {
      return { manager, ...installOutcome };
    }

    const moduleCheck = await verifyModuleImport(tempDir, packageName);
    if (moduleCheck.status !== "success") {
      return { manager, ...moduleCheck };
    }

    const cliCheck = await verifyCli(tempDir, binName);
    if (cliCheck.status !== "success") {
      return { manager, ...cliCheck };
    }

    console.log(`   • ${label} ✅`);
    return { manager, status: "success" };
  } finally {
    await Promise.all(teardownActions.map(async (fn) => fn()));
  }
}

async function initialiseProject(manager, tempDir) {
  console.log(`   • Initialising project (${manager})…`);
  if (manager === "npm" || manager === "yarn") {
    // These managers provide an init command that keeps stdout informative.
    const initArgs = manager === "npm" ? ["init", "-y"] : ["init", "-yp"];
    const result = await runCommand(manager, initArgs, {
      cwd: tempDir,
      silent: false,
      env: MANAGER_ENVS[manager],
    });
    if (result.code !== 0) {
      throw new Error(`${manager} init failed with exit code ${result.code}`);
    }
  } else {
    // pnpm does not need a dedicated init; write a bare package.json instead.
    const pkgJson = {
      name: "erb-smoke-test",
      version: "0.0.0",
      private: true,
      license: "UNLICENSED",
    };
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      `${JSON.stringify(pkgJson, null, 2)}\n`,
      "utf8",
    );
  }
}

async function installPackage(manager, tempDir, tarballPath) {
  console.log(`   • Installing package with ${manager}…`);
  const config = INSTALL_CONFIG[manager];
  const args = config.installArgs(tarballPath);
  if (manager === "pnpm") {
    console.log(`     (command) pnpm ${args.join(" ")}`);
  }
  const { code, stderr, stdout, error } = await runCommand(manager, args, {
    cwd: tempDir,
    silent: false,
    env: MANAGER_ENVS[manager],
  });

  if (error && error.code === "ENOENT") {
    const reason = `${manager} command not found`;
    console.log(`   • Skipped: ${reason}`);
    return { status: "skipped", reason };
  }

  if (code !== 0) {
    const combined = `${stdout}\n${stderr}`.toLowerCase();
    if (combined.includes("enotfound") || combined.includes("network")) {
      const reason = "failed (likely due to missing network access)";
      console.log(`   • Skipped: ${reason}`);
      return { status: "skipped", reason };
    }
    return {
      status: "failed",
      reason: `installation failed with exit code ${code}`,
    };
  }

  return { status: "success" };
}

async function verifyModuleImport(tempDir, packageName) {
  console.log("   • Verifying module import…");
  const snippet = `import('${packageName}')
  .then(() => process.exit(0))
  .catch(() => process.exit(1));`;
  const { code } = await runCommand(
    process.execPath,
    ["--input-type=module", "-e", snippet],
    { cwd: tempDir, silent: true },
  );

  if (code !== 0) {
    return { status: "failed", reason: "module import failed" };
  }
  return { status: "success" };
}

async function verifyCli(tempDir, binName) {
  console.log("   • Verifying CLI entry…");
  const cliExecutable =
    process.platform === "win32" ? `${binName}.cmd` : binName;
  const cliPath = path.join(tempDir, "node_modules", ".bin", cliExecutable);
  try {
    await fs.access(cliPath);
  } catch {
    return { status: "failed", reason: "CLI binary not found after install" };
  }

  const { code } = await runCommand(cliPath, ["--help"], {
    cwd: tempDir,
    silent: true,
  });

  if (code !== 0) {
    return {
      status: "failed",
      reason: "CLI returned non-zero exit code with --help",
    };
  }

  return { status: "success" };
}

async function checkAvailability(command) {
  const { code, error } = await runCommand(command, ["--version"], {
    cwd: ROOT_DIR,
    silent: true,
    env: MANAGER_ENVS[command],
  });

  if (error && error.code === "ENOENT") {
    return { available: false, reason: `${command} not installed on PATH` };
  }

  if (code !== 0) {
    return { available: false, reason: `${command} --version failed` };
  }

  return { available: true };
}

function printSummary(results) {
  console.log("Summary:");
  for (const result of results) {
    const badge =
      result.status === "success"
        ? "✅"
        : result.status === "skipped"
          ? "⚠️"
          : "❌";
    const reason = result.reason ? ` – ${result.reason}` : "";
    console.log(`  ${badge} ${result.manager}: ${result.status}${reason}`);
  }
}

async function execRequired(cmd, args, options) {
  const { code, error } = await runCommand(cmd, args, options);
  if (error) {
    throw error;
  }
  if (code !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed with exit code ${code}`);
  }
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{cwd?: string, env?: Record<string, string>, silent?: boolean}} [options]
 */
function runCommand(cmd, args, options = {}) {
  const { cwd, env, silent = false } = options;
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        const data = chunk.toString();
        stdout += data;
        if (!silent) {
          process.stdout.write(data);
        }
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        const data = chunk.toString();
        stderr += data;
        if (!silent) {
          process.stderr.write(data);
        }
      });
    }

    child.on("error", (error) => {
      resolve({ code: null, stdout, stderr, error });
    });

    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function ensureCacheDirectories() {
  const dirs = new Set();
  Object.values(MANAGER_ENVS).forEach((env) => {
    Object.values(env).forEach((value) => {
      if (typeof value === "string") {
        dirs.add(value);
      }
    });
  });
  await Promise.all([...dirs].map((dir) => fs.mkdir(dir, { recursive: true })));
}

await main();

function appendNodeOptions(existing, addition) {
  if (!addition) return existing ?? undefined;
  if (!existing) return addition;
  return `${existing} ${addition}`.trim();
}
