import type { RubyRegion } from "../parser.js";
import type { FormatterConfig } from "./index.js";

type WrappedLine = {
  text: string;
  extraIndent: number;
};

const BLOCK_START_KEYWORDS = new Set([
  "if",
  "unless",
  "while",
  "until",
  "for",
  "case",
  "class",
  "module",
  "def",
  "begin",
  "loop",
]);

const BLOCK_MIDDLE_KEYWORDS = new Set([
  "elsif",
  "else",
  "when",
  "rescue",
  "ensure",
]);
const BLOCK_END_KEYWORDS = new Set(["end"]);

export function renderRubyRegion(
  region: RubyRegion,
  config: FormatterConfig,
): string {
  const open = region.delimiters.open;
  const close = region.delimiters.close;
  const rawCode = region.code ?? "";

  if (!rawCode.trim()) {
    return `${open}${close}`;
  }

  const formatMode = config.ruby.format ?? "heuristic";
  const isLogicLike = region.flavor === "logic" || region.flavor === "unknown";
  const shouldFormat =
    formatMode !== "none" &&
    isLogicLike &&
    region.tree !== null &&
    rawCode.trim().length > 0;

  const formattedBody = shouldFormat
    ? formatRubyCode(rawCode, config)
    : normalizeRubyInlineWhitespace(rawCode);

  if (!formattedBody.trim()) {
    return `${open}${close}`;
  }

  if (formattedBody.includes("\n")) {
    const body = trimTrailingNewlines(formattedBody);
    return `${open}\n${body}\n${close}`;
  }

  return `${open} ${formattedBody} ${close}`;
}

export function formatRubyCode(code: string, config: FormatterConfig): string {
  const normalized = code.replace(/\r\n/g, "\n");
  const rawLines = normalized.split("\n");
  const indentSize = Math.max(1, config.indentation.size);
  const indentStyle = config.indentation.style;
  const continuationWidth = Math.max(0, config.indentation.continuation);
  const configuredWidth =
    config.ruby.lineWidth ?? config.html.lineWidth ?? Number.POSITIVE_INFINITY;

  let indentLevel = 0;
  const output: string[] = [];

  rawLines.forEach((rawLine) => {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) {
      output.push("");
      return;
    }

    const { body, comment } = splitComment(trimmed);
    const bodyTrimmed = body.trim();

    if (bodyTrimmed.length === 0 && comment) {
      const indentWidth = indentLevel * indentSize;
      const indent = widthToIndent(indentWidth, indentStyle, indentSize);
      output.push(`${indent}${comment}`);
      return;
    }

    const dedentBefore = shouldDedentBefore(bodyTrimmed);
    if (dedentBefore) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    const normalizedBody = normalizeRubyBody(bodyTrimmed);
    const wrappedLines = wrapRubyBody(
      normalizedBody,
      comment,
      indentLevel,
      continuationWidth,
      indentStyle,
      indentSize,
      configuredWidth,
    );

    wrappedLines.forEach((line, index) => {
      const extraIndent = index === 0 ? line.extraIndent : line.extraIndent;
      const indentWidth = indentLevel * indentSize + extraIndent;
      const indent = widthToIndent(indentWidth, indentStyle, indentSize);
      output.push(`${indent}${line.text}`);
    });

    if (shouldIndentAfter(bodyTrimmed)) {
      indentLevel += 1;
    }
  });

  return output.join("\n");
}

function normalizeRubyBody(body: string): string {
  const collapsed = collapseWhitespaceOutsideStrings(body);
  let result = collapsed;

  const keywordsNeedingSpace = [
    "if",
    "elsif",
    "else",
    "unless",
    "while",
    "until",
    "for",
    "case",
    "when",
    "rescue",
    "ensure",
    "do",
  ];

  keywordsNeedingSpace.forEach((keyword) => {
    const pattern = new RegExp(`\\b${keyword}\\s+`, "g");
    result = result.replace(pattern, `${keyword} `);
  });

  result = result.replace(/,\s*/g, ", ");
  return result.trim();
}

function splitComment(line: string): { body: string; comment: string | null } {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (inSingle) {
      if (!escaped && char === "'") {
        inSingle = false;
      }
      escaped = !escaped && char === "\\";
      continue;
    }

    if (inDouble) {
      if (!escaped && char === '"') {
        inDouble = false;
      } else if (!escaped && char === "#" && line[i + 1] === "{") {
        const { endIndex } = extractInterpolationExpression(line, i + 2);
        i = endIndex;
        escaped = false;
        continue;
      }
      escaped = !escaped && char === "\\";
      continue;
    }

    if (char === "'") {
      inSingle = true;
      escaped = false;
      continue;
    }

    if (char === '"') {
      inDouble = true;
      escaped = false;
      continue;
    }

    if (char === "#") {
      const comment = line.slice(i).trim();
      const body = line.slice(0, i).trimEnd();
      return { body, comment };
    }
  }

  return { body: line.trimEnd(), comment: null };
}

function collapseWhitespaceOutsideStrings(text: string): string {
  let result = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let pendingSpace = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inSingle) {
      result += char;
      if (!escaped && char === "'") {
        inSingle = false;
      }
      escaped = !escaped && char === "\\";
      continue;
    }

    if (inDouble) {
      if (!escaped && char === '"') {
        result += char;
        inDouble = false;
        escaped = false;
        continue;
      }
      if (!escaped && char === "#" && text[i + 1] === "{") {
        const { content, endIndex } = extractInterpolationExpression(
          text,
          i + 2,
        );
        result += `#{${content}}`;
        i = endIndex;
        escaped = false;
        continue;
      }
      result += char;
      escaped = !escaped && char === "\\";
      continue;
    }

    if (char === "'") {
      if (pendingSpace) {
        result += " ";
        pendingSpace = false;
      }
      inSingle = true;
      escaped = false;
      result += char;
      continue;
    }

    if (char === '"') {
      if (pendingSpace) {
        result += " ";
        pendingSpace = false;
      }
      inDouble = true;
      escaped = false;
      result += char;
      continue;
    }

    if (char === " " || char === "\t") {
      pendingSpace = true;
      continue;
    }

    if (pendingSpace) {
      result += " ";
      pendingSpace = false;
    }

    result += char;
  }

  return pendingSpace ? `${result} ` : result;
}

function wrapRubyBody(
  body: string,
  comment: string | null,
  indentLevel: number,
  continuationWidth: number,
  indentStyle: FormatterConfig["indentation"]["style"],
  indentSize: number,
  maxWidth: number,
): WrappedLine[] {
  const trimmedBody = body.trim();
  if (!Number.isFinite(maxWidth) || trimmedBody.length <= maxWidth) {
    return [
      {
        text: appendComment(trimmedBody, comment),
        extraIndent: 0,
      },
    ];
  }

  const split = splitArgumentsForWrap(trimmedBody);
  if (!split || split.arguments.length <= 1) {
    return [
      {
        text: appendComment(trimmedBody, comment),
        extraIndent: 0,
      },
    ];
  }

  const lines: WrappedLine[] = [];
  lines.push({ text: split.prefix.trimEnd(), extraIndent: 0 });

  const continuationIndent = Math.max(0, continuationWidth);

  split.arguments.forEach((argument, index) => {
    const isLast = index === split.arguments.length - 1;
    const suffix = isLast ? split.suffix : ",";
    const text = `${argument.trim()}${suffix}`;
    lines.push({
      text: isLast ? appendComment(text, comment) : text,
      extraIndent: continuationIndent,
    });
  });

  if (split.arguments.length === 0 && split.suffix) {
    lines[lines.length - 1].text = appendComment(split.suffix, comment);
  } else if (!comment && split.suffix && split.arguments.length > 0) {
    const last = lines[lines.length - 1];
    if (!last.text.endsWith(split.suffix)) {
      last.text = `${last.text}${split.suffix}`;
    }
  }

  return lines;
}

interface SplitArgumentsResult {
  prefix: string;
  arguments: string[];
  suffix: string;
}

function splitArgumentsForWrap(body: string): SplitArgumentsResult | null {
  const openIndex = body.indexOf("(");
  if (openIndex === -1) return null;

  const closeIndex = findClosingParen(body, openIndex);
  if (closeIndex === -1) return null;

  const prefix = body.slice(0, openIndex + 1);
  const suffix = body.slice(closeIndex);
  const inside = body.slice(openIndex + 1, closeIndex);

  const args = splitArguments(inside);
  if (args.length <= 1) {
    return null;
  }

  return { prefix, arguments: args, suffix };
}

function splitArguments(content: string): string[] {
  const args: string[] = [];
  let current = "";
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];

    if (inSingle) {
      current += char;
      if (!escaped && char === "'") {
        inSingle = false;
      }
      escaped = !escaped && char === "\\";
      continue;
    }

    if (inDouble) {
      if (!escaped && char === '"') {
        current += char;
        inDouble = false;
        escaped = false;
        continue;
      }
      if (!escaped && char === "#" && content[i + 1] === "{") {
        const { content: nested, endIndex } = extractInterpolationExpression(
          content,
          i + 2,
        );
        current += `#{${nested}}`;
        i = endIndex;
        escaped = false;
        continue;
      }
      current += char;
      escaped = !escaped && char === "\\";
      continue;
    }

    if (char === "'") {
      inSingle = true;
      escaped = false;
      current += char;
      continue;
    }

    if (char === '"') {
      inDouble = true;
      escaped = false;
      current += char;
      continue;
    }

    if (char === "\\") {
      escaped = !escaped;
      current += char;
      continue;
    }
    escaped = false;

    if (char === "(") {
      depthParen += 1;
      current += char;
      continue;
    }
    if (char === ")") {
      depthParen = Math.max(0, depthParen - 1);
      current += char;
      continue;
    }
    if (char === "[") {
      depthBracket += 1;
      current += char;
      continue;
    }
    if (char === "]") {
      depthBracket = Math.max(0, depthBracket - 1);
      current += char;
      continue;
    }
    if (char === "{") {
      depthBrace += 1;
      current += char;
      continue;
    }
    if (char === "}") {
      depthBrace = Math.max(0, depthBrace - 1);
      current += char;
      continue;
    }

    if (
      char === "," &&
      depthParen === 0 &&
      depthBracket === 0 &&
      depthBrace === 0
    ) {
      args.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim().length > 0) {
    args.push(current.trim());
  }

  return args;
}

function shouldDedentBefore(line: string): boolean {
  const keyword = leadingKeyword(line);
  if (!keyword) return false;
  if (BLOCK_END_KEYWORDS.has(keyword)) return true;
  if (BLOCK_MIDDLE_KEYWORDS.has(keyword)) return true;
  return false;
}

function shouldIndentAfter(line: string): boolean {
  const keyword = leadingKeyword(line);
  if (keyword) {
    if (BLOCK_START_KEYWORDS.has(keyword)) return true;
    if (BLOCK_MIDDLE_KEYWORDS.has(keyword)) return true;
  }
  if (/\bdo\b/.test(line) && !/\bend\b/.test(line)) {
    return true;
  }
  return false;
}

function leadingKeyword(line: string): string | null {
  const match = line.match(/^([a-z_]+)/);
  return match ? match[1] : null;
}

function appendComment(body: string, comment: string | null): string {
  if (!comment) return body;
  const trimmedBody = body.trimEnd();
  return trimmedBody.length > 0 ? `${trimmedBody}  ${comment}` : comment;
}

function findClosingParen(text: string, openIndex: number): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i];

    if (inSingle) {
      if (!escaped && char === "'") {
        inSingle = false;
      }
      escaped = !escaped && char === "\\";
      continue;
    }

    if (inDouble) {
      if (!escaped && char === '"') {
        inDouble = false;
      } else if (!escaped && char === "#" && text[i + 1] === "{") {
        const { endIndex } = extractInterpolationExpression(text, i + 2);
        i = endIndex;
      }
      escaped = !escaped && char === "\\";
      continue;
    }

    if (char === "'") {
      inSingle = true;
      escaped = false;
      continue;
    }
    if (char === '"') {
      inDouble = true;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = !escaped;
      continue;
    }
    escaped = false;

    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function widthToIndent(
  width: number,
  style: FormatterConfig["indentation"]["style"],
  indentSize: number,
): string {
  if (width <= 0) return "";
  if (style === "tab") {
    const tabs = Math.floor(width / indentSize);
    const spaces = width % indentSize;
    return "\t".repeat(tabs) + " ".repeat(spaces);
  }
  return " ".repeat(width);
}

function trimTrailingNewlines(value: string): string {
  let end = value.length;
  while (end > 0 && (value[end - 1] === "\n" || value[end - 1] === "\r")) {
    end -= 1;
  }
  return value.slice(0, end);
}

function normalizeRubyInlineWhitespace(code: string): string {
  let result = "";
  let pendingSpace = false;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < code.length; i += 1) {
    const char = code[i];

    if (inSingle) {
      result += char;
      if (!escaped && char === "'") {
        inSingle = false;
      }
      escaped = !escaped && char === "\\";
      continue;
    }

    if (inDouble) {
      if (!escaped && char === '"') {
        inDouble = false;
        result += char;
        escaped = false;
        continue;
      }
      if (!escaped && char === "#" && code[i + 1] === "{") {
        const { content, endIndex } = extractInterpolationExpression(
          code,
          i + 2,
        );
        const normalized = normalizeRubyInlineWhitespace(content);
        result += `#{${normalized}}`;
        i = endIndex;
        escaped = false;
        continue;
      }
      result += char;
      escaped = !escaped && char === "\\";
      continue;
    }

    if (char === "'") {
      if (pendingSpace && !result.endsWith("\n")) {
        result += " ";
      }
      pendingSpace = false;
      inSingle = true;
      escaped = false;
      result += char;
      continue;
    }

    if (char === '"') {
      if (pendingSpace && !result.endsWith("\n")) {
        result += " ";
      }
      pendingSpace = false;
      inDouble = true;
      escaped = false;
      result += char;
      continue;
    }

    if (char === " " || char === "\t") {
      pendingSpace = result.length > 0 && !result.endsWith("\n");
      continue;
    }

    if (char === "\n") {
      while (result.endsWith(" ") || result.endsWith("\t")) {
        result = result.slice(0, -1);
      }
      result += "\n";
      pendingSpace = false;
      continue;
    }

    if (pendingSpace && !result.endsWith("\n")) {
      result += " ";
    }
    pendingSpace = false;
    result += char;
  }

  return result.trim();
}

function extractInterpolationExpression(
  code: string,
  startIndex: number,
): { content: string; endIndex: number } {
  let content = "";
  let depth = 1;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = startIndex; i < code.length; i += 1) {
    const char = code[i];

    if (inSingle) {
      content += char;
      if (!escaped && char === "'") {
        inSingle = false;
      }
      escaped = !escaped && char === "\\";
      continue;
    }

    if (inDouble) {
      if (!escaped && char === '"') {
        inDouble = false;
        content += char;
        escaped = false;
        continue;
      }
      if (!escaped && char === "#" && code[i + 1] === "{") {
        const nested = extractInterpolationExpression(code, i + 2);
        content += `#{${nested.content}}`;
        i = nested.endIndex;
        escaped = false;
        continue;
      }
      content += char;
      escaped = !escaped && char === "\\";
      continue;
    }

    if (char === "'") {
      inSingle = true;
      escaped = false;
      content += char;
      continue;
    }

    if (char === '"') {
      inDouble = true;
      escaped = false;
      content += char;
      continue;
    }

    if (char === "{") {
      depth += 1;
      content += char;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return { content, endIndex: i };
      }
      content += char;
      continue;
    }

    content += char;
  }

  return { content, endIndex: code.length - 1 };
}
