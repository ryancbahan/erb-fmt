import type { RubyRegion } from "../parser.js";

export function renderRubyRegion(region: RubyRegion): string {
  const open = region.delimiters.open;
  const close = region.delimiters.close;
  const normalizedCode = normalizeRubyInlineWhitespace(region.code ?? "");
  if (!normalizedCode) {
    return `${open}${close}`;
  }
  return `${open} ${normalizedCode} ${close}`;
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
