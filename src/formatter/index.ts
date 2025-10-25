import type { Tree, SyntaxNode } from "tree-sitter";
import type { ERBRegion, ParsedERB, RubyRegion } from "../parser.js";
import { buildPlaceholderDocument, PLACEHOLDER_PREFIX, PLACEHOLDER_SUFFIX } from "./placeholders.js";
import {
  analyzePlaceholderDocument,
  renderHtmlDocument,
  type PlaceholderPrintInfo,
} from "./htmlDocument.js";

export interface FormatterConfig {
  indentation: {
    /** Primary indent width applied to Ruby blocks and HTML nesting. */
    size: number;
    /** Whether indentation should prefer tabs over spaces. */
    style: "space" | "tab";
    /** Additional indent applied to continuation lines. */
    continuation: number;
  };
  newline: "lf" | "crlf" | "preserve";
  whitespace: {
    /** Trim trailing whitespace from each line. */
    trimTrailingWhitespace: boolean;
    /** Ensure output ends with a single newline when true. */
    ensureFinalNewline: boolean;
  };
  html: {
    /** Strategy for collapsing redundant whitespace between tags. */
    collapseWhitespace: "preserve" | "conservative" | "aggressive";
    /** Preferred line width for wrapping attributes or text nodes. */
    lineWidth: number | null;
    /** How to handle attribute wrapping when exceeding line width. */
    attributeWrapping: "preserve" | "auto" | "force-multi-line";
  };
  ruby: {
    /** Control how `end` alignment should be normalized. */
    alignBlockEnds: boolean;
    /** Desired newline behavior at the end of the file. */
    finalNewline: "preserve" | "ensure" | "strip";
    /** Preferred shape for inline guard clauses (`if`/`unless`). */
    inlineGuardStyle: "preserve" | "compact" | "expanded";
  };
}

export type FormatterConfigInput = RecursivePartial<FormatterConfig>;

export type SegmentMode = "passthrough" | "html-normalized" | "ruby-normalized" | "unknown";

export type SegmentKind = "html" | "ruby" | "unknown";

export interface FormatSegment {
  /** Position of the segment in output order. */
  index: number;
  /** Category of segment (html fragment, ruby directive, etc.). */
  kind: SegmentKind;
  /** Source region that originated this segment, when applicable. */
  region?: ERBRegion;
  /** Formatted text for the segment. */
  formatted: string;
  /** Logical indentation level for the segment start (if applicable). */
  indentationLevel: number;
  /** Indicates which formatting path produced the segment. */
  mode: SegmentMode;
}

export interface FormatterDiagnostic {
  index: number;
  severity: "info" | "warning" | "error";
  message: string;
}

export interface FormatterResult {
  output: string;
  segments: FormatSegment[];
  diagnostics: FormatterDiagnostic[];
  config: FormatterConfig;
  debug?: FormatterDebugInfo;
}

export interface FormatterDebugInfo {
  placeholderHtml: string;
  placeholderCount: number;
}

export const DEFAULT_FORMATTER_CONFIG: FormatterConfig = {
  indentation: {
    size: 2,
    style: "space",
    continuation: 2,
  },
  newline: "lf",
  whitespace: {
    trimTrailingWhitespace: true,
    ensureFinalNewline: true,
  },
  html: {
    collapseWhitespace: "conservative",
    lineWidth: 100,
    attributeWrapping: "preserve",
  },
  ruby: {
    alignBlockEnds: true,
    finalNewline: "preserve",
    inlineGuardStyle: "preserve",
  },
};

/**
 * Primary entry point for formatting an ERB template. The current implementation
 * preserves the original content while establishing the pipeline that future
 * normalization logic will plug into.
 */
export function formatERB(parsed: ParsedERB, givenConfig?: FormatterConfigInput): FormatterResult {
  const config = mergeConfig(DEFAULT_FORMATTER_CONFIG, givenConfig);

  const placeholderDocument = buildPlaceholderDocument(parsed.regions);
  const htmlAnalysis = analyzePlaceholderDocument(placeholderDocument);
  const htmlPrint = renderHtmlDocument(
    htmlAnalysis,
    config.indentation.size,
    config.indentation.style,
    config.html.collapseWhitespace,
  );

  const { output, segments, rubyDiagnostics } = composeOutput(
    htmlPrint.html,
    htmlPrint.placeholderPrintInfo,
    parsed,
    config,
  );

  const diagnostics: FormatterDiagnostic[] = [];
  htmlAnalysis.diagnostics.forEach((diag) => {
    diagnostics.push({
      index: diag.entry?.regionIndex ?? -1,
      severity: diag.severity,
      message: diag.message,
    });
  });
  diagnostics.push(...rubyDiagnostics);

  return {
    output,
    segments,
    diagnostics,
    config,
    debug: {
      placeholderHtml: htmlPrint.html,
      placeholderCount: placeholderDocument.placeholders.length,
    },
  };
}

type RecursivePartial<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown>
    ? RecursivePartial<T[K]>
    : T[K];
};

function mergeConfig(
  defaults: FormatterConfig,
  override?: FormatterConfigInput,
): FormatterConfig {
  const baseline = deepClone(defaults);
  if (!override) return baseline;
  deepMergeInto(baseline as unknown as Record<string, unknown>, override as Record<string, unknown>);
  return baseline;
}

function normalizeSegmentText(text: string, config: FormatterConfig): string {
  let normalized = text;

  if (config.newline !== "preserve") {
    normalized = normalized.replace(/\r\n/g, "\n");
  }

  if (config.whitespace.trimTrailingWhitespace) {
    normalized = normalized.replace(/[ \t]+(?=\r?\n)/g, "");
  }

  if (config.newline === "crlf") {
    normalized = normalized.replace(/\n/g, "\r\n");
  }

  return normalized;
}

function formatHtmlSegment(
  text: string,
  indentationLevel: number,
  config: FormatterConfig,
): string {
  let normalized = normalizeSegmentText(text, config);

  if (config.html.collapseWhitespace !== "preserve") {
    normalized = collapseWhitespaceOutsideQuotes(normalized);
    normalized = breakAdjacentTags(normalized);
    normalized = collapseBlankLines(normalized, config.html.collapseWhitespace);
  }

  return applyIndentation(normalized, indentationLevel, config, { indentFirstLine: false });
}

function ensureFinalNewline(segments: FormatSegment[], config: FormatterConfig): void {
  if (!config.whitespace.ensureFinalNewline || segments.length === 0) {
    return;
  }

  const eol = resolveLineEnding(segments, config);
  const last = segments[segments.length - 1];
  if (config.whitespace.trimTrailingWhitespace) {
    const trimmedWhitespace = last.formatted.replace(/[ \t]+$/g, "");
    if (trimmedWhitespace !== last.formatted) {
      last.formatted = trimmedWhitespace;
    }
  }
  const trailingMatch = last.formatted.match(/(?:\r?\n)+$/);

  if (trailingMatch) {
    const trailing = trailingMatch[0];
    if (trailing === eol && trailingMatch.index !== undefined && trailingMatch.index + trailing.length === last.formatted.length) {
      return;
    }
    const trimmed = last.formatted.slice(0, -trailing.length);
    const nextText = trimmed + eol;
    if (nextText !== last.formatted) {
      last.formatted = nextText;
    }
  } else {
    last.formatted = last.formatted + eol;
  }
}

function resolveLineEnding(segments: FormatSegment[], config: FormatterConfig): string {
  if (config.newline === "lf") return "\n";
  if (config.newline === "crlf") return "\r\n";

  const hasCRLF = segments.some((segment) => segment.formatted.includes("\r\n"));
  return hasCRLF ? "\r\n" : "\n";
}

function collapseWhitespaceOutsideQuotes(text: string): string {
  let result = "";
  let insideTag = false;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === "<") {
      insideTag = true;
      inSingle = false;
      inDouble = false;
      result += char;
      continue;
    }

    if (char === ">" && (!insideTag || (!inSingle && !inDouble))) {
      insideTag = false;
      result += char;
      continue;
    }

    if (insideTag) {
      if (char === "'" && !inDouble) {
        inSingle = !inSingle;
        result += char;
        continue;
      }
      if (char === '"' && !inSingle) {
        inDouble = !inDouble;
        result += char;
        continue;
      }

      if ((char === " " || char === "\t") && !inSingle && !inDouble) {
        result += " ";
        while (i + 1 < text.length) {
          const next = text[i + 1];
          if (next === " " || next === "\t") {
            i += 1;
            continue;
          }
          break;
        }
        continue;
      }

      result += char;
      continue;
    }

    if (char === " " || char === "\t") {
      // collapse sequences of horizontal whitespace outside tags to a single space
      result += " ";
      while (i + 1 < text.length) {
        const next = text[i + 1];
        if (next === " " || next === "\t") {
          i += 1;
          continue;
        }
        break;
      }
      continue;
    }

    result += char;
  }

  return result;
}

function breakAdjacentTags(text: string): string {
  return text.replace(/>\s*(?=<)/g, ">\n");
}

function collapseBlankLines(
  text: string,
  mode: FormatterConfig["html"]["collapseWhitespace"],
): string {
  if (mode === "aggressive") {
    return text.replace(/\n{2,}/g, "\n");
  }
  return text.replace(/\n{3,}/g, "\n\n");
}

function deepMergeInto(
  target: Record<string, unknown>,
  override: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const targetValue = target[key];
    if (isPlainObject(targetValue) && isPlainObject(value)) {
      deepMergeInto(targetValue, value);
      continue;
    }
    target[key] = deepClone(value);
  }
}

function deepClone<T>(input: T): T {
  if (Array.isArray(input)) {
    return input.map((item) => deepClone(item)) as unknown as T;
  }
  if (isPlainObject(input)) {
    const clone: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      clone[key] = deepClone(value);
    }
    return clone as T;
  }
  return input;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ComposeOutputResult {
  output: string;
  segments: FormatSegment[];
  rubyDiagnostics: FormatterDiagnostic[];
}

function composeOutput(
  htmlWithPlaceholders: string,
  placeholderPrintInfo: PlaceholderPrintInfo[],
  parsed: ParsedERB,
  config: FormatterConfig,
): ComposeOutputResult {
  const placeholderMap = new Map<number, PlaceholderPrintInfo>();
  placeholderPrintInfo.forEach((info) => {
    placeholderMap.set(info.entry.id, info);
  });

  const segments: FormatSegment[] = [];
  const diagnostics: FormatterDiagnostic[] = [];
  const placeholderPattern = new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, "g");
  const indentUnit = config.indentation.style === "tab" ? "\t" : " ".repeat(config.indentation.size);

  let lastIndex = 0;
  let currentRubyIndent = 0;
  let match: RegExpExecArray | null;

  while ((match = placeholderPattern.exec(htmlWithPlaceholders)) !== null) {
    const start = match.index;
    const id = Number.parseInt(match[1], 10);
    const info = placeholderMap.get(id);

    if (start > lastIndex) {
      let htmlText = htmlWithPlaceholders.slice(lastIndex, start);
      if (htmlText) {
        const trailingMatch = htmlText.match(/[ \t]+$/);
        if (trailingMatch) {
          const startIdx = trailingMatch.index ?? 0;
          const preceding = htmlText.slice(0, startIdx);
          if (startIdx === 0 || preceding.endsWith("\n")) {
            htmlText = htmlText.slice(0, startIdx);
          }
        }
        htmlText = adjustHtmlSegment(htmlText, currentRubyIndent, indentUnit);
        segments.push({
          index: segments.length,
          kind: "html",
          formatted: htmlText,
          indentationLevel: 0,
          mode: "html-normalized",
        });
      }
    }

    if (!info) {
      diagnostics.push({
        index: -1,
        severity: "error",
        message: `No placeholder info found for id ${id}`,
      });
      lastIndex = placeholderPattern.lastIndex;
      continue;
    }

    const rubyResult = formatRubyPlaceholderSegment(info, currentRubyIndent, config, indentUnit);
    currentRubyIndent = rubyResult.nextIndent;
    segments.push({
      index: segments.length,
      kind: "ruby",
      region: info.entry.region,
      formatted: rubyResult.formatted,
      indentationLevel: rubyResult.indentationLevel,
      mode: rubyResult.mode,
    });

    lastIndex = placeholderPattern.lastIndex;
  }

  if (lastIndex < htmlWithPlaceholders.length) {
    const tail = htmlWithPlaceholders.slice(lastIndex);
    if (tail) {
      const adjustedTail = adjustHtmlSegment(tail, currentRubyIndent, indentUnit);
      segments.push({
        index: segments.length,
        kind: "html",
        formatted: adjustedTail,
        indentationLevel: 0,
        mode: "html-normalized",
      });
    }
  }

  ensureFinalNewline(segments, config);
  const output = segments.map((segment) => segment.formatted).join("");

  return {
    output,
    segments,
    rubyDiagnostics: diagnostics,
  };
}

interface RubyPlaceholderResult {
  formatted: string;
  indentationLevel: number;
  mode: SegmentMode;
  nextIndent: number;
}

function formatRubyPlaceholderSegment(
  info: PlaceholderPrintInfo,
  currentRubyIndent: number,
  config: FormatterConfig,
  indentUnit: string,
): RubyPlaceholderResult {
  const { region } = info.entry;

  if (info.inline || info.inAttribute) {
    const inlineText = region.text.trim();
    return {
      formatted: inlineText,
      indentationLevel: 0,
      mode: "ruby-normalized",
      nextIndent: currentRubyIndent,
    };
  }

  const normalized = normalizeSegmentText(region.text, config);
  const effects = region.flavor === "logic" ? analyzeRubyIndentation(region) : ZERO_INDENTATION_EFFECT;
  const containerIndentContribution = info.indentationLevel;
  const rubyIndentLevel = clampIndent(currentRubyIndent + effects.before);
  const totalIndentLevel = clampIndent(containerIndentContribution + rubyIndentLevel);

  const formatted = applyIndentation(normalized, totalIndentLevel, config, {
    indentFirstLine: true,
  });

  const nextIndent = region.flavor === "logic"
    ? clampIndent(rubyIndentLevel + effects.after)
    : currentRubyIndent;

  return {
    formatted,
    indentationLevel: totalIndentLevel,
    mode: "ruby-normalized",
    nextIndent,
  };
}

function adjustHtmlSegment(text: string, rubyIndentLevel: number, indentUnit: string): string {
  if (rubyIndentLevel <= 0) {
    return text;
  }
  const indentAddition = indentUnit.repeat(rubyIndentLevel);
  return text.replace(/(\n)([ \t]*)(?=\S)/g, (_, newline, spaces) => {
    return `${newline}${indentAddition}${spaces}`;
  });
}

interface IndentationEffect {
  before: number;
  after: number;
}

const ZERO_INDENTATION_EFFECT: IndentationEffect = { before: 0, after: 0 };

function analyzeRubyIndentation(region: RubyRegion): IndentationEffect {
  const code = region.code.trim();
  if (!code) return ZERO_INDENTATION_EFFECT;

  const node = extractSignificantRubyNode(region.tree);
  const effectFromAst = node ? classifyRubyNode(node) : null;
  if (effectFromAst) {
    return effectFromAst;
  }

  return classifyByKeyword(code);
}

const CONTAINER_NODE_TYPES = new Set([
  "program",
  "ERROR",
  "body_statement",
  "then",
  "else",
  "when",
  "ensure",
  "rescue",
  "block_body",
  "command",
]);

function extractSignificantRubyNode(tree: Tree | null): SyntaxNode | null {
  if (!tree) return null;

  const queue: SyntaxNode[] = [tree.rootNode];

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || node.isMissing) continue;
    if (node.type === "comment") continue;

    if (CONTAINER_NODE_TYPES.has(node.type)) {
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i);
        if (child) queue.unshift(child);
      }
      continue;
    }

    return node;
  }

  return null;
}

function classifyRubyNode(node: SyntaxNode): IndentationEffect | null {
  switch (node.type) {
    case "if":
    case "unless":
    case "while":
    case "until":
    case "for":
    case "case":
    case "begin":
    case "class":
    case "module":
    case "method":
    case "def":
    case "if_statement": // tree-sitter-ruby alias in some versions
      return { before: 0, after: 1 };
    case "if_modifier":
    case "unless_modifier":
    case "while_modifier":
    case "until_modifier":
      return ZERO_INDENTATION_EFFECT;
    case "rescue":
    case "ensure":
    case "else":
    case "when":
      return { before: -1, after: 1 };
    case "do_block":
    case "block":
      return { before: 0, after: 1 };
    case "call": {
      const methodNode = node.childForFieldName("method");
      const methodName = methodNode?.text ?? "";
      if (methodName === "elsif" || methodName === "when" || methodName === "rescue" || methodName === "ensure") {
        return { before: -1, after: 1 };
      }

      const block = node.childForFieldName("block");
      if (block && (block.type === "do_block" || block.type === "block")) {
        return { before: 0, after: 1 };
      }
      return ZERO_INDENTATION_EFFECT;
    }
    default:
      return null;
  }
}

function classifyByKeyword(code: string): IndentationEffect {
  if (/^end\b/.test(code)) {
    return { before: -1, after: 0 };
  }

  if (/^(else|elsif|when|rescue|ensure)\b/.test(code)) {
    return { before: -1, after: 1 };
  }

  if (/^(if|unless|while|until|for|case|class|module|begin|def|method)\b/.test(code)) {
    return { before: 0, after: 1 };
  }

  if (/\bdo\s*(\|[^|]*\|\s*)?$/.test(code)) {
    return { before: 0, after: 1 };
  }

  return ZERO_INDENTATION_EFFECT;
}

function clampIndent(value: number): number {
  return value < 0 ? 0 : value;
}

function applyIndentation(
  text: string,
  level: number,
  config: FormatterConfig,
  options: { indentFirstLine: boolean },
): string {
  if (!text) return text;
  const indentUnit = config.indentation.style === "tab" ? "\t" : " ".repeat(config.indentation.size);
  const indent = indentUnit.repeat(level);

  const newlineRegex = /\r?\n/g;
  let lastIndex = 0;
  let lineIndex = 0;
  let output = "";

  let match: RegExpExecArray | null;
  while ((match = newlineRegex.exec(text)) !== null) {
    const line = text.slice(lastIndex, match.index);
    output += formatLine(line, lineIndex === 0);
    output += match[0];
    lastIndex = match.index + match[0].length;
    lineIndex += 1;
  }

  if (lastIndex < text.length) {
    const line = text.slice(lastIndex);
    output += formatLine(line, lineIndex === 0);
  }

  return output;

  function formatLine(line: string, isFirstLine: boolean): string {
    if (!line) return "";
    const trimmed = line.replace(/^[ \t]*/, "");
    if (!trimmed) return "";
    if (isFirstLine && !options.indentFirstLine) {
      return trimmed;
    }
    return indent + trimmed;
  }
}
