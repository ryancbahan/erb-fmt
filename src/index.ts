import fs from "fs";
import path from "path";
import type { FormatSegment, FormatterResult } from "./formatter/index.js";
import { formatERB } from "./formatter/index.js";
import type { ERBRegion, ParsedERB, RubyRegion } from "./parser.js";
import { parseERB } from "./parser.js";
import { printTree } from "./utils/printTree.js";

const args = process.argv.slice(2);
const showTree = args.includes("--tree");
const showFormatted = args.includes("--format");
const showSegments = args.includes("--segments");
const fileArg = args.find((arg) => !arg.startsWith("-"));

if (!fileArg) {
  console.error("Usage: erbfmt [--tree] [--format] [--segments] <file.erb>");
  process.exit(1);
}

const filePath = path.resolve(fileArg);
const source = fs.readFileSync(filePath, "utf8");
const parsed = parseERB(source);
const formatterResult = formatERB(parsed);

printRegions(parsed.regions);

if (showSegments) {
  printSegments(formatterResult.segments);
}

if (formatterResult.diagnostics.length > 0) {
  printDiagnostics(formatterResult.diagnostics);
}

if (showFormatted) {
  printFormattedOutput(formatterResult.output);
}

if (showTree) {
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
    const header = `[${segment.index}] ${segment.region.type.toUpperCase()} mode=${segment.mode} indent=${segment.indentationLevel}`;
    const formattedPreview = preview(segment.formatted);
    const originalPreview = preview(segment.region.text);
    if (formattedPreview === originalPreview) {
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
