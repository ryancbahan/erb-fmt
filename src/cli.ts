#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import type {
  FormatSegment,
  FormatterResult,
  FormatterConfigInput,
} from "./formatter/index.js";
import { formatERB } from "./formatter/index.js";
import type { ERBRegion, ParsedERB, RubyRegion } from "./parser.js";
import { parseERB } from "./parser.js";
import { printTree } from "./utils/printTree.js";

interface CliOptions {
  showTree: boolean;
  showFormatted: boolean;
  showSegments: boolean;
  write: boolean;
  targets: string[];
  config: FormatterConfigInput | undefined;
}

async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const options = parseCliArguments(argv);

  if (!options) {
    printUsage();
    return 0;
  }

  const { files: targetFiles, missing } = resolveTargetFiles(options.targets);

  if (missing.length > 0) {
    missing.forEach((pattern) => {
      console.warn(`warning: no matches found for "${pattern}"`);
    });
  }

  if (targetFiles.length === 0) {
    console.error(
      "error: no input files matched the provided paths or globs (expected *.erb)",
    );
    return 2;
  }

  const shouldPrintFormattedOutput =
    options.showFormatted || (!options.write && targetFiles.length === 1);

  let exitCode = 0;

  targetFiles.forEach((filePath) => {
    const displayPath = formatDisplayPath(filePath);
    let source: string;
    try {
      source = fs.readFileSync(filePath, "utf8");
    } catch (error) {
      console.error(
        `error: failed to read ${displayPath}: ${(error as Error).message}`,
      );
      exitCode = Math.max(exitCode, 2);
      return;
    }

    const parsed = parseERB(source);
    let formatterResult: FormatterResult;
    try {
      formatterResult = formatERB(parsed, options.config);
    } catch (error) {
      console.error(
        `error: failed to format ${displayPath}: ${(error as Error).message}`,
      );
      exitCode = Math.max(exitCode, 3);
      return;
    }

    const hasErrorDiagnostics = formatterResult.diagnostics.some(
      (diag) => diag.severity === "error",
    );

    printRegions(
      parsed.regions,
      targetFiles.length > 1 ? displayPath : undefined,
    );

    if (options.showSegments) {
      printSegments(
        formatterResult.segments,
        targetFiles.length > 1 ? displayPath : undefined,
      );
    }

    if (formatterResult.diagnostics.length > 0) {
      printDiagnostics(
        formatterResult.diagnostics,
        targetFiles.length > 1 ? displayPath : undefined,
      );
    }

    if (hasErrorDiagnostics) {
      exitCode = exitCode === 0 ? 1 : exitCode;
    }

    if (shouldPrintFormattedOutput) {
      printFormattedOutput(
        formatterResult.output,
        targetFiles.length > 1 ? displayPath : undefined,
      );
    }

    if (options.write && !hasErrorDiagnostics) {
      if (formatterResult.output !== source) {
        fs.writeFileSync(filePath, formatterResult.output, "utf8");
        if (!shouldPrintFormattedOutput) {
          console.log(`Formatted ${displayPath}`);
        }
      } else if (!shouldPrintFormattedOutput) {
        console.log(`Already formatted ${displayPath}`);
      }
    }

    if (options.showTree) {
      const heading =
        targetFiles.length > 1
          ? `\n=== Syntax Tree (${displayPath}) ===`
          : "\n=== Syntax Tree ===";
      console.log(heading);
      console.log(printTree(parsed.tree, source));
    }
  });

  return exitCode;
}

function parseCliArguments(argv: string[]): CliOptions | null {
  let showTree = false;
  let showFormatted = false;
  let showSegments = false;
  const configFragments: string[] = [];
  const configFiles: string[] = [];
  const targets: string[] = [];
  let requestedHelp = false;
  let write = false;
  let passthroughTargets = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (passthroughTargets) {
      targets.push(arg);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      requestedHelp = true;
      continue;
    }
    if (arg === "--write" || arg === "-w") {
      write = true;
      continue;
    }
    if (arg === "--tree") {
      showTree = true;
      continue;
    }
    if (arg === "--format") {
      showFormatted = true;
      continue;
    }
    if (arg === "--segments") {
      showSegments = true;
      continue;
    }
    if (arg === "--config-file") {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        console.error("error: --config-file requires a path");
        return null;
      }
      configFiles.push(next);
      i += 1;
      continue;
    }
    if (arg.startsWith("--config-file=")) {
      configFiles.push(arg.slice("--config-file=".length));
      continue;
    }
    if (arg === "--config") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        console.error("error: --config requires a value");
        return null;
      }
      configFragments.push(next);
      i += 1;
      continue;
    }
    if (arg.startsWith("--config=")) {
      configFragments.push(arg.slice("--config=".length));
      continue;
    }
    if (arg === "--") {
      passthroughTargets = true;
      continue;
    }
    if (!arg.startsWith("-")) {
      targets.push(arg);
      continue;
    }
    console.error(`error: unrecognized argument ${arg}`);
    return null;
  }

  if (requestedHelp) {
    return null;
  }

  if (targets.length === 0) {
    return null;
  }

  let config: FormatterConfigInput | undefined;

  if (configFiles.length > 0) {
    const fileConfig: FormatterConfigInput = {};
    for (const configPath of configFiles) {
      const resolvedPath = path.resolve(configPath);
      let parsed: unknown;
      try {
        const contents = fs.readFileSync(resolvedPath, "utf8");
        parsed = JSON.parse(contents);
      } catch (error) {
        console.error(
          `error: failed to load config file ${configPath}: ${(error as Error).message}`,
        );
        return null;
      }
      if (typeof parsed !== "object" || parsed === null) {
        console.error(
          `error: config file ${configPath} must contain a JSON object`,
        );
        return null;
      }
      mergeConfigInputs(fileConfig, parsed as FormatterConfigInput);
    }
    config = fileConfig;
  }

  if (configFragments.length > 0) {
    const overrides = parseConfigFragments(configFragments);
    if (config) {
      mergeConfigInputs(config, overrides);
    } else {
      config = overrides;
    }
  }

  return { showTree, showFormatted, showSegments, write, targets, config };
}

function resolveTargetFiles(
  targets: string[],
): {
  files: string[];
  missing: string[];
} {
  const files = new Set<string>();
  const missing: string[] = [];

  targets.forEach((target) => {
    const trimmed = target.trim();
    if (!trimmed) return;

    if (isGlobPattern(trimmed)) {
      const matches = expandGlobPattern(trimmed);
      if (matches.length === 0) {
        missing.push(trimmed);
      } else {
        matches.forEach((match) => files.add(match));
      }
      return;
    }

    const resolved = path.resolve(trimmed);
    const stats = safeStat(resolved);
    if (!stats) {
      missing.push(trimmed);
      return;
    }

    if (stats.isDirectory()) {
      const dirMatches = collectErbFiles(resolved);
      if (dirMatches.length === 0) {
        missing.push(trimmed);
      } else {
        dirMatches.forEach((file) => files.add(file));
      }
      return;
    }

    if (stats.isFile() && isErbFile(resolved)) {
      files.add(resolved);
      return;
    }

    missing.push(trimmed);
  });

  const ordered = Array.from(files).sort((a, b) => a.localeCompare(b));
  return { files: ordered, missing };
}

function isGlobPattern(value: string): boolean {
  return value.includes("*") || value.includes("?") || value.includes("[");
}

function expandGlobPattern(pattern: string): string[] {
  const resolvedPattern = path.resolve(process.cwd(), pattern);
  const relativePattern = path.relative(process.cwd(), resolvedPattern);
  const segments = splitPatternSegments(relativePattern);
  const firstGlobIndex = segments.findIndex(segmentHasGlob);

  if (firstGlobIndex === -1) {
    const candidate = path.resolve(process.cwd(), relativePattern);
    const stats = safeStat(candidate);
    if (stats?.isDirectory()) {
      return collectErbFiles(candidate);
    }
    if (stats?.isFile() && isErbFile(candidate)) {
      return [candidate];
    }
    return [];
  }

  const baseSegments = segments.slice(0, firstGlobIndex);
  const patternSegments = segments.slice(firstGlobIndex);
  const baseDir = path.resolve(process.cwd(), path.join(...baseSegments));

  const baseStats = safeStat(baseDir);
  if (!baseStats || !baseStats.isDirectory()) {
    return [];
  }

  const results = new Set<string>();
  matchSegments(baseDir, patternSegments, 0, results);
  return Array.from(results);
}

function collectErbFiles(directory: string): string[] {
  const results: string[] = [];
  const queue: string[] = [directory];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;
    const entries = safeReadDir(current);
    entries.forEach((entry) => {
      if (entry.name === "." || entry.name === "..") return;
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
      } else if (entry.isFile() && isErbFile(entryPath)) {
        results.push(entryPath);
      }
    });
  }

  return results;
}

function matchSegments(
  currentPath: string,
  segments: string[],
  index: number,
  results: Set<string>,
): void {
  if (index >= segments.length) {
    const stats = safeStat(currentPath);
    if (stats?.isFile() && isErbFile(currentPath)) {
      results.add(currentPath);
    }
    return;
  }

  const segment = segments[index];

  if (segment === "**") {
    matchSegments(currentPath, segments, index + 1, results);
    const stats = safeStat(currentPath);
    if (!stats || !stats.isDirectory()) return;
    const entries = safeReadDir(currentPath);
    entries.forEach((entry) => {
      if (entry.name === "." || entry.name === "..") return;
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        matchSegments(entryPath, segments, index, results);
      } else if (entry.isFile() && index + 1 === segments.length) {
        if (isErbFile(entryPath)) {
          results.add(entryPath);
        }
      }
    });
    return;
  }

  const stats = safeStat(currentPath);
  if (!stats || !stats.isDirectory()) return;

  const matcher = segmentToRegExp(segment);
  const entries = safeReadDir(currentPath);
  entries.forEach((entry) => {
    if (entry.name === "." || entry.name === "..") return;
    if (!matcher.test(entry.name)) return;
    const entryPath = path.join(currentPath, entry.name);
    const entryStats = safeStat(entryPath);
    if (!entryStats) return;
    if (entryStats.isDirectory()) {
      matchSegments(entryPath, segments, index + 1, results);
    } else if (
      entryStats.isFile() &&
      index === segments.length - 1 &&
      isErbFile(entryPath)
    ) {
      results.add(entryPath);
    }
  });
}

function splitPatternSegments(pattern: string): string[] {
  return pattern.split(/[\\/]+/).filter((segment) => segment.length > 0);
}

function segmentHasGlob(segment: string): boolean {
  return (
    segment === "**" ||
    segment.includes("*") ||
    segment.includes("?") ||
    segment.includes("[")
  );
}

function segmentToRegExp(segment: string): RegExp {
  if (segment === "**") {
    return /.*/;
  }
  let pattern = "^";
  for (let i = 0; i < segment.length; i += 1) {
    const char = segment[i];
    if (char === "*") {
      pattern += "[^/\\\\]*";
    } else if (char === "?") {
      pattern += "[^/\\\\]";
    } else {
      pattern += escapeRegExp(char);
    }
  }
  pattern += "$";
  return new RegExp(pattern);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

function safeStat(filePath: string): fs.Stats | null {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function safeReadDir(dirPath: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function isErbFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".erb");
}

function formatDisplayPath(absolutePath: string): string {
  const relative = path.relative(process.cwd(), absolutePath);
  if (!relative || relative.startsWith("..")) {
    return absolutePath;
  }
  return relative;
}

function parseConfigFragments(fragments: string[]): FormatterConfigInput {
  const result: Record<string, unknown> = {};
  fragments.forEach((fragment) => {
    const entries = splitConfigEntries(fragment);
    entries.forEach(({ key, value }) => {
      setNestedConfigValue(result, key, coerceValue(value));
    });
  });
  return result as FormatterConfigInput;
}

function splitConfigEntries(
  fragment: string,
): Array<{ key: string; value: string }> {
  const entries: Array<{ key: string; value: string }> = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  const pushEntry = (raw: string) => {
    if (!raw.trim()) return;
    const eqIndex = raw.indexOf("=");
    if (eqIndex === -1) {
      entries.push({ key: raw.trim(), value: "true" });
      return;
    }
    const key = raw.slice(0, eqIndex).trim();
    const value = raw.slice(eqIndex + 1).trim();
    if (!key) return;
    entries.push({ key, value });
  };

  for (let i = 0; i < fragment.length; i += 1) {
    const char = fragment[i];
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      current += char;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      current += char;
      continue;
    }
    if (char === "," && !inSingle && !inDouble) {
      pushEntry(current);
      current = "";
      continue;
    }
    current += char;
  }

  if (current) {
    pushEntry(current);
  }
  return entries;
}

function coerceValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through to plain string handling
    }
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;

  return trimmed;
}

function setNestedConfigValue(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return;
  let current: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const existing = current[key];
    if (
      typeof existing === "object" &&
      existing !== null &&
      !Array.isArray(existing)
    ) {
      current = existing as Record<string, unknown>;
    } else {
      const next: Record<string, unknown> = {};
      current[key] = next;
      current = next;
    }
  }
  current[parts[parts.length - 1]] = value;
}

function mergeConfigInputs(
  target: FormatterConfigInput,
  source: FormatterConfigInput,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const existing = (target as Record<string, unknown>)[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      mergeConfigInputs(
        existing as FormatterConfigInput,
        value as FormatterConfigInput,
      );
      continue;
    }
    (target as Record<string, unknown>)[key] = value;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function printRegions(regions: ParsedERB["regions"], fileLabel?: string): void {
  const heading = fileLabel
    ? `=== Regions (${fileLabel}) ===`
    : "=== Regions ===";
  console.log(fileLabel ? `\n${heading}` : heading);
  regions.forEach((region, index) => {
    const header = `[${index}] ${region.type.toUpperCase()} ${formatRange(region.range)}`;
    if (region.type === "ruby") {
      printRubyRegion(header, region);
    } else {
      console.log(`${header} ${preview(region.text)}`);
    }
  });
}

function printSegments(segments: FormatSegment[], fileLabel?: string): void {
  const heading = fileLabel
    ? `=== Formatter Segments (${fileLabel}) ===`
    : "=== Formatter Segments ===";
  console.log(`\n${heading}`);
  segments.forEach((segment) => {
    const typeLabel = segment.region
      ? segment.region.type.toUpperCase()
      : segment.kind.toUpperCase();
    const header = `[${segment.index}] ${typeLabel} mode=${segment.mode} indent=${segment.indentationLevel}`;
    const formattedPreview = preview(segment.formatted);
    const originalPreview = segment.region
      ? preview(segment.region.text)
      : null;
    if (!originalPreview || formattedPreview === originalPreview) {
      console.log(`${header} ${formattedPreview}`);
    } else {
      console.log(`${header} formatted=${formattedPreview}`);
      console.log(`    original=${originalPreview}`);
    }
  });
}

function printFormattedOutput(output: string, fileLabel?: string): void {
  const heading = fileLabel
    ? `=== Formatted Output (${fileLabel}) ===`
    : "=== Formatted Output ===";
  console.log(`\n${heading}`);
  process.stdout.write(output);
  if (!output.endsWith("\n")) {
    process.stdout.write("\n");
  }
}

function printDiagnostics(
  diagnostics: FormatterResult["diagnostics"],
  fileLabel?: string,
): void {
  const heading = fileLabel
    ? `=== Formatter Diagnostics (${fileLabel}) ===`
    : "=== Formatter Diagnostics ===";
  console.log(`\n${heading}`);
  diagnostics.forEach((diagnostic) => {
    console.log(
      `[${diagnostic.index}] ${diagnostic.severity.toUpperCase()}: ${diagnostic.message}`,
    );
  });
}

function printRubyRegion(header: string, region: RubyRegion) {
  const { flavor, delimiters, code, codeRange } = region;
  const delimiterSummary = `${JSON.stringify(delimiters.open)}→${JSON.stringify(delimiters.close)}`;
  console.log(
    `${header} flavor=${flavor} delimiters=${delimiterSummary} ${preview(
      code || region.text,
    )}`,
  );
  if (codeRange) {
    console.log(
      `    codeRange=${formatRange(codeRange)} code=${preview(code)}`,
    );
  }
}

function formatRange(range: ERBRegion["range"]): string {
  const start = `${range.startPosition.row}:${range.startPosition.column}`;
  const end = `${range.endPosition.row}:${range.endPosition.column}`;
  return `${start}-${end}`;
}

function preview(text: string, maxLength = 60): string {
  const squashed = text.replace(/\s+/g, " ").trim();
  if (!squashed) return '""';
  if (squashed.length <= maxLength) {
    return `"${squashed}"`;
  }
  return `"${squashed.slice(0, maxLength - 1)}…"`;
}

function printUsage(): void {
  console.log(`ERB Formatter

Usage:
  erbfmt [options] <file|glob ...>

Options:
  --format           Print formatted output.
  --write, -w        Overwrite the source file with formatted output.
  --segments         Print formatter segment breakdown.
  --tree             Print the embedded template syntax tree.
  --config-file      Load formatter configuration from a JSON file.
  --config <expr>    Override configuration values (comma separated key=value pairs).
  --config=...       Same as above.
  --help, -h         Show this help message.

Examples:
  erbfmt --format app/views/users/show.html.erb
  erbfmt --format app/views/shared/header.erb app/views/shared/footer.erb
  erbfmt --write app/views/users/show.html.erb
  erbfmt --write app/views/**/*.erb
  erbfmt --config "indentation.size=4,html.attributeWrapping='auto'" template.erb
  erbfmt --config-file config/erbfmt.json --write dashboard.erb
`);
}

if (isExecutedDirectly(import.meta.url)) {
  runCli()
    .then((code) => {
      if (code !== 0) {
        process.exitCode = code;
      }
    })
    .catch((error) => {
      console.error(
        error instanceof Error ? (error.stack ?? error.message) : error,
      );
      process.exit(1);
    });
}

function isExecutedDirectly(moduleUrl: string): boolean {
  if (!process.argv[1]) return false;
  try {
    return moduleUrl === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

export { runCli, resolveTargetFiles };
