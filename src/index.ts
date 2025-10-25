import fs from "fs";
import path from "path";
import type { FormatSegment, FormatterResult, FormatterConfigInput } from "./formatter/index.js";
import { formatERB } from "./formatter/index.js";
import type { ERBRegion, ParsedERB, RubyRegion } from "./parser.js";
import { parseERB } from "./parser.js";
import { printTree } from "./utils/printTree.js";

const args = process.argv.slice(2);

interface CliOptions {
  showTree: boolean;
  showFormatted: boolean;
  showSegments: boolean;
  file: string;
  config: FormatterConfigInput | undefined;
}

function parseCliArguments(argv: string[]): CliOptions | null {
  let showTree = false;
  let showFormatted = false;
  let showSegments = false;
  const configFragments: string[] = [];
  let file: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
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

  if (!file) {
    return null;
  }

  const config = configFragments.length > 0 ? parseConfigFragments(configFragments) : undefined;

  return { showTree, showFormatted, showSegments, file, config };
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

function splitConfigEntries(fragment: string): Array<{ key: string; value: string }> {
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

  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through to plain string handling
    }
  }

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
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

function setNestedConfigValue(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return;
  let current: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const existing = current[key];
    if (typeof existing === "object" && existing !== null && !Array.isArray(existing)) {
      current = existing as Record<string, unknown>;
    } else {
      const next: Record<string, unknown> = {};
      current[key] = next;
      current = next;
    }
  }
  current[parts[parts.length - 1]] = value;
}

const options = parseCliArguments(args);
if (!options) {
  console.error("Usage: erbfmt [--tree] [--format] [--segments] [--config <expr>] <file.erb>");
  process.exit(1);
}

const filePath = path.resolve(options.file);
const source = fs.readFileSync(filePath, "utf8");
const parsed = parseERB(source);
const formatterResult = formatERB(parsed, options.config);

printRegions(parsed.regions);

if (options.showSegments) {
  printSegments(formatterResult.segments);
}

if (formatterResult.diagnostics.length > 0) {
  printDiagnostics(formatterResult.diagnostics);
}

if (options.showFormatted) {
  printFormattedOutput(formatterResult.output);
}

if (options.showTree) {
  console.log("\n=== Syntax Tree ===");
  console.log(printTree(parsed.tree, source));
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
    const typeLabel = segment.region ? segment.region.type.toUpperCase() : segment.kind.toUpperCase();
    const header = `[${segment.index}] ${typeLabel} mode=${segment.mode} indent=${segment.indentationLevel}`;
    const formattedPreview = preview(segment.formatted);
    const originalPreview = segment.region ? preview(segment.region.text) : null;
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
    console.log(`[${diagnostic.index}] ${diagnostic.severity.toUpperCase()}: ${diagnostic.message}`);
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
    console.log(`    codeRange=${formatRange(codeRange)} code=${preview(code)}`);
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
