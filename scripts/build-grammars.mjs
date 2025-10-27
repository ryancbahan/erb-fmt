#!/usr/bin/env node

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist", "grammars");

const grammars = [
  {
    name: "embedded-template",
    package: "tree-sitter-embedded-template",
    wasm: "tree-sitter-embedded_template.wasm",
  },
  {
    name: "html",
    package: "tree-sitter-html",
    wasm: "tree-sitter-html.wasm",
  },
  {
    name: "ruby",
    package: "tree-sitter-ruby",
    wasm: "tree-sitter-ruby.wasm",
  },
];

async function main() {
  await resetDirectory(distDir);

  for (const grammar of grammars) {
    const sourcePath = path.join(
      projectRoot,
      "node_modules",
      grammar.package,
      grammar.wasm,
    );
    const outputPath = path.join(distDir, `${grammar.name}.wasm`);
    await ensureExists(sourcePath);
    await fs.copyFile(sourcePath, outputPath);
    console.log(
      `✅ Copied ${grammar.wasm} → ${path.relative(projectRoot, outputPath)}`,
    );
  }
}

async function resetDirectory(directory) {
  await fs.rm(directory, { recursive: true, force: true });
  await fs.mkdir(directory, { recursive: true });
}

async function ensureExists(filePath) {
  try {
    await fs.access(filePath);
  } catch (error) {
    throw new Error(`Missing expected grammar artifact at ${filePath}`, {
      cause: error,
    });
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  process.exit(1);
});
