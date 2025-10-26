#!/usr/bin/env node
import fs from "fs";
import path from "path";
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
  file: string;
  config: FormatterConfigInput | undefined;
}

const args = process.argv.slice(2);
const options = parseCliArguments(args);

if (!options) {
  printUsage();
  process.exit(0);
}

const filePath = path.resolve(options.file);
let source: string;
try {
  source = fs.readFileSync(filePath, "utf8");
} catch (error) {
  console.error(
    `error: failed to read ${options.file}: ${(error as Error).message}`,
  );
  process.exit(2);
}

const parsed = parseERB(source);
let formatterResult: FormatterResult;
try {
  formatterResult = formatERB(parsed, options.config);
} catch (error) {
  console.error(
    `error: failed to format ${options.file}: ${(error as Error).message}`,
  );
  process.exit(3);
}

const hasErrorDiagnostics = formatterResult.diagnostics.some(
  (diag) => diag.severity === "error",
);

printRegions(parsed.regions);

if (options.showSegments) {
  printSegments(formatterResult.segments);
}

if (formatterResult.diagnostics.length > 0) {
  printDiagnostics(formatterResult.diagnostics);
}

if (hasErrorDiagnostics) {
  process.exitCode = 1;
}

if (options.showFormatted || !options.write) {
  printFormattedOutput(formatterResult.output);
}

if (options.write && !hasErrorDiagnostics) {
  if (formatterResult.output !== source) {
    fs.writeFileSync(filePath, formatterResult.output, "utf8");
    if (!options.showFormatted) {
      console.log(`Formatted ${options.file}`);
    }
  } else if (!options.showFormatted) {
    console.log(`Already formatted ${options.file}`);
  }
}

if (options.showTree) {
  console.log("\n=== Syntax Tree ===");
  console.log(printTree(parsed.tree, source));
}

function parseCliArguments(argv: string[]): CliOptions | null {
  let showTree = false;
  let showFormatted = false;
  let showSegments = false;
  const configFragments: string[] = [];
  const configFiles: string[] = [];
  let file: string | undefined;
  let requestedHelp = false;
  let write = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
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
    if (!arg.startsWith("-") && !file) {
      file = arg;
      continue;
    }
    console.error(`error: unrecognized argument ${arg}`);
    return null;
  }

  if (requestedHelp) {
    return null;
  }

  if (!file) {
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

  return { showTree, showFormatted, showSegments, write, file, config };
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

function printRegions(regions: ParsedERB["regions"]) {
  console.log("=== Regions ===");
  regions.forEach((region, index) => {
    const header = `[${index}] ${region.type.toUpperCase()} ${formatRange(region.range)}`;
    if (region.type === "ruby") {
      printRubyRegion(header, region);
    } else {
      console.log(`${header} ${preview(region.text)}`);
    }
  });
}

function printSegments(segments: FormatSegment[]) {
  console.log("\n=== Formatter Segments ===");
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

function printFormattedOutput(output: string) {
  console.log("\n=== Formatted Output ===");
  process.stdout.write(output);
  if (!output.endsWith("\n")) {
    process.stdout.write("\n");
  }
}

function printDiagnostics(diagnostics: FormatterResult["diagnostics"]) {
  console.log("\n=== Formatter Diagnostics ===");
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
  erbfmt [options] <file.erb>

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
  erbfmt --write app/views/users/show.html.erb
  erbfmt --config "indentation.size=4,html.attributeWrapping='auto'" template.erb
  erbfmt --config-file config/erbfmt.json --write dashboard.erb
`);
}
