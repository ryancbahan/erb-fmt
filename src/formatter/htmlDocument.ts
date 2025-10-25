import Parser from "tree-sitter";
import type { SyntaxNode, Tree } from "tree-sitter";
import { getHtmlParser } from "../parser.js";
import type { PlaceholderDocument, PlaceholderEntry } from "./placeholders.js";
import { PLACEHOLDER_PREFIX, PLACEHOLDER_SUFFIX } from "./placeholders.js";

const INLINE_ELEMENTS = new Set([
  "a",
  "abbr",
  "acronym",
  "b",
  "bdo",
  "big",
  "br",
  "button",
  "cite",
  "code",
  "dfn",
  "em",
  "i",
  "img",
  "input",
  "kbd",
  "label",
  "mark",
  "q",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "textarea",
  "time",
  "var",
]);

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const WHITESPACE_SENSITIVE_ELEMENTS = new Set([
  "pre",
  "code",
  "textarea",
  "script",
  "style",
]);

export interface HtmlPlaceholderInfo {
  entry: PlaceholderEntry;
  node: SyntaxNode;
  startIndex: number;
  endIndex: number;
  elementDepth: number;
  inAttribute: boolean;
  insideSensitive: boolean;
  parentElementName: string;
}

export interface HtmlDiagnostic {
  message: string;
  severity: "info" | "warning" | "error";
  entry?: PlaceholderEntry;
}

export interface HtmlDocumentAnalysis {
  tree: Tree;
  placeholders: HtmlPlaceholderInfo[];
  diagnostics: HtmlDiagnostic[];
}

export interface HtmlPrintResult {
  html: string;
  placeholderPrintInfo: PlaceholderPrintInfo[];
}

export interface PlaceholderPrintInfo {
  entry: PlaceholderEntry;
  indentationLevel: number;
  inline: boolean;
  inAttribute: boolean;
  sensitive: boolean;
}

export function analyzePlaceholderDocument(document: PlaceholderDocument): HtmlDocumentAnalysis {
  const parser = getHtmlParser();
  const tree = parser.parse(document.html);

  const diagnostics: HtmlDiagnostic[] = [];
  if (tree.rootNode.hasError) {
    diagnostics.push({
      message: "HTML parse reported syntax errors in placeholder document",
      severity: "error",
    });
  }

  const placeholders: HtmlPlaceholderInfo[] = [];
  let searchIndex = 0;

  document.placeholders.forEach((entry) => {
    const matchIndex = document.html.indexOf(entry.placeholder, searchIndex);
    if (matchIndex === -1) {
      diagnostics.push({
        message: `Placeholder token not found: ${entry.placeholder}`,
        severity: "error",
        entry,
      });
      return;
    }
    const startIndex = matchIndex;
    const endIndex = matchIndex + entry.placeholder.length;
    searchIndex = endIndex;

    const node = tree.rootNode.descendantForIndex(startIndex, endIndex) ?? tree.rootNode;
    const { elementDepth, inAttribute, insideSensitive } = computeContext(node);

    const parentElementName = findParentElementName(node);

    placeholders.push({
      entry,
      node,
      startIndex,
      endIndex,
      elementDepth,
      inAttribute,
      insideSensitive,
      parentElementName,
    });
  });

  return {
    tree,
    placeholders,
    diagnostics,
  };
}

export type AttributeWrappingMode = "preserve" | "auto" | "force-multi-line";

export function renderHtmlDocument(
  analysis: HtmlDocumentAnalysis,
  documentHtml: string,
  indentSize: number,
  indentStyle: "space" | "tab",
  collapseWhitespace: "preserve" | "conservative" | "aggressive",
  lineWidth: number | null,
  attributeWrapping: AttributeWrappingMode,
): HtmlPrintResult {
  const indentUnit = indentStyle === "tab" ? "\t" : " ".repeat(indentSize);
  const placeholderInfoByToken = new Map<string, HtmlPlaceholderInfo>();
  analysis.placeholders.forEach((info) => {
    placeholderInfoByToken.set(info.entry.placeholder, info);
  });

  const placeholderPrintInfo: PlaceholderPrintInfo[] = [];

  function printNode(node: SyntaxNode, depth: number, parentInline: boolean, sensitiveContext: boolean): string {
    switch (node.type) {
      case "element":
        return printElement(node, depth, parentInline, sensitiveContext);
      case "self_closing_tag":
      case "erroneous_end_tag":
      case "script_element":
      case "style_element":
      case "doctype":
      case "comment":
        return `${indent(depth)}${node.text.trim()}\n`;
      case "text":
        return printTextNode(node, depth, parentInline, sensitiveContext);
      default:
        if (node.namedChildCount === 0) {
          const text = node.text.trim();
          return text ? `${indent(depth)}${text}\n` : "";
        }
        let acc = "";
        for (let i = 0; i < node.namedChildCount; i += 1) {
          const child = node.namedChild(i);
          if (child) acc += printNode(child, depth, parentInline, sensitiveContext);
        }
        return acc;
    }
  }

  function printElement(node: SyntaxNode, depth: number, parentInline: boolean, parentSensitive: boolean): string {
    const startTag = node.namedChild(0);
    if (!startTag) return "";
    const tagName = extractTagName(startTag);
    const inline = INLINE_ELEMENTS.has(tagName);
    const voidElement = VOID_ELEMENTS.has(tagName);
    const sensitive = parentSensitive || (tagName ? WHITESPACE_SENSITIVE_ELEMENTS.has(tagName) : false);

    const attributes = collectAttributes(startTag, depth, tagName);

    if (sensitive) {
      const endTag = findEndTag(node);
      const innerStart = startTag.endIndex;
      const innerEnd = endTag ? endTag.startIndex : startTag.endIndex;
      registerPlaceholdersInSlice(innerStart, innerEnd, depth + 1, inline, true);

      const rawInnerContent = documentHtml.slice(innerStart, innerEnd);
      let innerContent = rawInnerContent;
      const closingIndent = indent(depth);
      if (closingIndent.length > 0 && innerContent.endsWith(`\n${closingIndent}`)) {
        innerContent = innerContent.slice(0, -closingIndent.length);
      }

      let result = `${indent(depth)}<${tagName}${attributes}>`;
      if (innerContent) {
        if (!innerContent.startsWith("\n")) {
          result += "\n";
        }
        result += innerContent;
        if (!innerContent.endsWith("\n")) {
          result += "\n";
        }
      } else {
        result += "\n";
      }
      result += `${indent(depth)}</${tagName}>\n`;
      return result;
    }
    const openTag = `${indent(depth)}<${tagName}${attributes}>`;

    const children: SyntaxNode[] = [];
    for (let i = 1; i < node.namedChildCount; i += 1) {
      const child = node.namedChild(i);
      if (!child || child.type === "end_tag") continue;
      children.push(child);
    }

    if (voidElement) {
      return `${openTag}\n`;
    }

    if (children.length === 0) {
      return `${openTag}</${tagName}>\n`;
    }

    if (!sensitive && children.length === 1 && children[0].type === "text") {
      const inlineContent = printTextNode(children[0], depth + 1, true, sensitive).trim();
      return `${indent(depth)}<${tagName}${attributes}>${inlineContent}</${tagName}>\n`;
    }

    let result = `${openTag}${inline ? "" : "\n"}`;
    children.forEach((child) => {
      result += printNode(child, depth + 1, inline, sensitive);
    });
    if (!inline) {
      result += indent(depth);
    }
    result += `</${tagName}>\n`;
    return result;
  }

  function collectAttributes(startTag: SyntaxNode, depth: number, tagName: string): string {
    const attributeNodes: SyntaxNode[] = [];
    for (let i = 0; i < startTag.namedChildCount; i += 1) {
      const child = startTag.namedChild(i);
      if (child?.type === "attribute") {
        attributeNodes.push(child);
      }
    }

    if (attributeNodes.length === 0) {
      return "";
    }

    const originalAttributesText = captureOriginalAttributes(startTag, attributeNodes);

    const formattedAttributes = attributeNodes.map((node) => formatAttribute(node));
    const hasFailedFormatting = formattedAttributes.some((attr) => attr.length === 0);
    const inlineSuffix = ` ${formattedAttributes.join(" ")}`;
    const baseLength = indent(depth).length + 1 + tagName.length + inlineSuffix.length + 1;
    const originalHadLineBreak = /\r?\n/.test(originalAttributesText);

    if (hasFailedFormatting) {
      registerAttributePlaceholders(originalAttributesText);
      return originalAttributesText;
    }

    if (attributeWrapping === "preserve") {
      if (originalHadLineBreak) {
        const attrIndent = indent(depth + 1);
        const multilineLines = formattedAttributes.map((attr) => `${attrIndent}${attr}`).join("\n");
        const preserved = `\n${multilineLines}\n${indent(depth)}`;
        registerAttributePlaceholders(preserved);
        return preserved;
      }
      registerAttributePlaceholders(inlineSuffix);
      return inlineSuffix;
    }

    const shouldForceMultiline =
      attributeWrapping === "force-multi-line" ||
      (attributeWrapping === "auto" &&
        ((originalHadLineBreak && formattedAttributes.length > 0) ||
          (lineWidth !== null && baseLength > lineWidth)));

    if (!shouldForceMultiline) {
      registerAttributePlaceholders(inlineSuffix);
      return inlineSuffix;
    }

    const attrIndent = indent(depth + 1);
    const multilineLines = formattedAttributes.map((attr) => `${attrIndent}${attr}`).join("\n");
    const wrapped = `\n${multilineLines}\n${indent(depth)}`;
    registerAttributePlaceholders(wrapped);
    return wrapped;
  }

  function formatAttribute(node: SyntaxNode): string {
    const raw = documentHtml.slice(node.startIndex, node.endIndex).trim();
    if (!raw) return "";

    const assignmentIndex = findAttributeAssignmentIndex(raw);
    if (assignmentIndex === -1) {
      return raw.replace(/\s+/g, " ");
    }

    const name = raw.slice(0, assignmentIndex).trim();
    let value = raw.slice(assignmentIndex + 1).trim();
    if (!name) return raw.replace(/\s+/g, " ");
    if (!value) {
      return name;
    }

    value = normalizeAttributeValue(value);
    return `${name}=${value}`;
  }

  function findAttributeAssignmentIndex(text: string): number {
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (char === "=") {
        return i;
      }
    }
    return -1;
  }

  function normalizeAttributeValue(value: string): string {
    if (!value) return value;
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' || first === "'") && last === first) {
      const inner = value.slice(1, -1);
      const normalizedInner = normalizeAttributeValueContent(inner);
      return `${first}${normalizedInner}${first}`;
    }
    return normalizeAttributeValueContent(value);
  }

  function normalizeAttributeValueContent(content: string): string {
    const trimmed = content.trim();
    if (!trimmed) return "";
    return trimmed.replace(/\s+/g, " ");
  }

  function captureOriginalAttributes(startTag: SyntaxNode, nodes: SyntaxNode[]): string {
    if (nodes.length === 0) return "";
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const tagNameNode = startTag.namedChild(0);
    const prefixStart = tagNameNode ? tagNameNode.endIndex : startTag.startIndex;
    const prefix = documentHtml.slice(prefixStart, first.startIndex);
    const attributesSlice = documentHtml.slice(first.startIndex, last.endIndex);
    return `${prefix}${attributesSlice}`;
  }

  function printTextNode(node: SyntaxNode, depth: number, parentInline: boolean, sensitive: boolean): string {
    let text = documentHtml.slice(node.startIndex, node.endIndex);

    const placeholderRegex = new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, "g");
    text = text.replace(placeholderRegex, (_, id: string) => {
      const placeholder = `${PLACEHOLDER_PREFIX}${id}${PLACEHOLDER_SUFFIX}`;
      const info = placeholderInfoByToken.get(placeholder);
      if (info) {
        placeholderPrintInfo.push({
          entry: info.entry,
          indentationLevel: depth,
          inline: parentInline,
          inAttribute: false,
          sensitive: sensitive || info.insideSensitive,
        });
      }
      return placeholder;
    });

    if (sensitive) {
      return text;
    }

    if (!text.trim()) return "";

    if (collapseWhitespace !== "preserve") {
      if (parentInline) {
        text = text.replace(/\s+/g, " ").trim();
      } else {
        text = text
          .replace(/[ \t]+/g, " ")
          .replace(/ ?\n ?/g, "\n")
          .replace(/\n{2,}/g, "\n");
        text = text.trim();
      }
    }

    if (!text) return "";
    if (parentInline) {
      return text;
    }
    return `${indent(depth)}${text}\n`;
  }

  function indent(level: number): string {
    return indentUnit.repeat(level);
  }

  function registerAttributePlaceholders(text: string) {
    const regex = new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, "g");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const id = match[1];
      const placeholder = `${PLACEHOLDER_PREFIX}${id}${PLACEHOLDER_SUFFIX}`;
      const info = placeholderInfoByToken.get(placeholder);
      if (info) {
        placeholderPrintInfo.push({
          entry: info.entry,
          indentationLevel: 0,
          inline: true,
          inAttribute: true,
          sensitive: false,
        });
      }
    }
  }

  function registerPlaceholdersInSlice(
    startIndex: number,
    endIndex: number,
    depth: number,
    inline: boolean,
    sensitive: boolean,
  ) {
    const slice = documentHtml.slice(startIndex, endIndex);
    const regex = new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, "g");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(slice)) !== null) {
      const placeholder = `${PLACEHOLDER_PREFIX}${match[1]}${PLACEHOLDER_SUFFIX}`;
      const info = placeholderInfoByToken.get(placeholder);
      if (info) {
        placeholderPrintInfo.push({
          entry: info.entry,
          indentationLevel: depth,
          inline,
          inAttribute: false,
          sensitive: true,
        });
      }
    }
  }

  const root = analysis.tree.rootNode;
  let html = "";
  for (let i = 0; i < root.namedChildCount; i += 1) {
    const child = root.namedChild(i);
    if (child) {
      html += printNode(child, 0, false, false);
    }
  }
  return {
    html,
    placeholderPrintInfo,
  };
}

function extractTagName(startTag: SyntaxNode): string {
  const tagNameNode = startTag.namedChildCount > 0 ? startTag.namedChild(0) : null;
  if (!tagNameNode) return "";
  if (tagNameNode.type === "tag_name") {
    return tagNameNode.text;
  }
  for (let i = 0; i < startTag.namedChildCount; i += 1) {
    const child = startTag.namedChild(i);
    if (child?.type === "tag_name") return child.text;
  }
  return "";
}

function computeContext(node: SyntaxNode) {
  let elementDepth = 0;
  let inAttribute = false;
  let insideSensitive = false;

  let current: SyntaxNode | null = node;
  while (current) {
    if (current.type === "element") {
      elementDepth += 1;
      const startTag = current.namedChild(0);
      if (startTag) {
        const tagName = extractTagName(startTag);
        if (tagName && WHITESPACE_SENSITIVE_ELEMENTS.has(tagName)) {
          insideSensitive = true;
        }
      }
    }
    if (current.type === "attribute_value" || current.type === "attribute") {
      inAttribute = true;
    }
    current = current.parent;
  }

  return { elementDepth, inAttribute, insideSensitive };
}

function findParentElementName(node: SyntaxNode): string {
  let current: SyntaxNode | null = node;
  while (current) {
    if (current.type === "element") {
      const startTag = current.namedChild(0);
      if (startTag) {
        return extractTagName(startTag) || "";
      }
    }
    current = current.parent;
  }
  return "";
}

function findEndTag(node: SyntaxNode): SyntaxNode | null {
  for (let i = node.namedChildCount - 1; i >= 0; i -= 1) {
    const child = node.namedChild(i);
    if (child?.type === "end_tag") {
      return child;
    }
  }
  return null;
}
