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

export interface HtmlPlaceholderInfo {
  entry: PlaceholderEntry;
  node: SyntaxNode;
  startIndex: number;
  endIndex: number;
  elementDepth: number;
  inAttribute: boolean;
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
    const { elementDepth, inAttribute } = computeContext(node);

    const parentElementName = findParentElementName(node);

    placeholders.push({
      entry,
      node,
      startIndex,
      endIndex,
      elementDepth,
      inAttribute,
      parentElementName,
    });
  });

  return {
    tree,
    placeholders,
    diagnostics,
  };
}

export function renderHtmlDocument(
  analysis: HtmlDocumentAnalysis,
  indentSize: number,
  indentStyle: "space" | "tab",
  collapseWhitespace: "preserve" | "conservative" | "aggressive",
): HtmlPrintResult {
  const indentUnit = indentStyle === "tab" ? "\t" : " ".repeat(indentSize);
  const placeholderByToken = new Map<string, PlaceholderEntry>();
  analysis.placeholders.forEach((info) => {
    placeholderByToken.set(info.entry.placeholder, info.entry);
  });

  const placeholderPrintInfo: PlaceholderPrintInfo[] = [];

  function printNode(node: SyntaxNode, depth: number, parentInline: boolean): string {
    switch (node.type) {
      case "element":
        return printElement(node, depth, parentInline);
      case "self_closing_tag":
      case "erroneous_end_tag":
      case "script_element":
      case "style_element":
      case "doctype":
      case "comment":
        return `${indent(depth)}${node.text.trim()}\n`;
      case "text":
        return printTextNode(node, depth, parentInline);
      default:
        if (node.namedChildCount === 0) {
          const text = node.text.trim();
          return text ? `${indent(depth)}${text}\n` : "";
        }
        let acc = "";
        for (let i = 0; i < node.namedChildCount; i += 1) {
          const child = node.namedChild(i);
          if (child) acc += printNode(child, depth, parentInline);
        }
        return acc;
    }
  }

  function printElement(node: SyntaxNode, depth: number, parentInline: boolean): string {
    const startTag = node.namedChild(0);
    if (!startTag) return "";
    const tagName = extractTagName(startTag);
    const inline = INLINE_ELEMENTS.has(tagName);
    const voidElement = VOID_ELEMENTS.has(tagName);

    const attributes = collectAttributes(startTag);
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

    if (children.length === 1 && children[0].type === "text") {
      const inlineContent = printTextNode(children[0], depth + 1, true).trim();
      return `${indent(depth)}<${tagName}${attributes}>${inlineContent}</${tagName}>\n`;
    }

    let result = `${openTag}${inline ? "" : "\n"}`;
    children.forEach((child) => {
      result += printNode(child, depth + 1, inline);
    });
    if (!inline) {
      result += indent(depth);
    }
    result += `</${tagName}>\n`;
    return result;
  }

  function collectAttributes(startTag: SyntaxNode): string {
    const attributes: string[] = [];
    for (let i = 0; i < startTag.namedChildCount; i += 1) {
      const child = startTag.namedChild(i);
      if (!child) continue;
      if (child.type === "attribute") {
        const text = child.text.trim();
        registerAttributePlaceholders(text);
        attributes.push(text.replace(/\s+/g, " "));
      }
    }
    return attributes.length ? ` ${attributes.join(" ")}` : "";
  }

  function printTextNode(node: SyntaxNode, depth: number, parentInline: boolean): string {
    let text = node.text;
    if (!text.trim()) return "";

    const placeholderRegex = new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, "g");
    text = text.replace(placeholderRegex, (_, id: string) => {
      const placeholder = `${PLACEHOLDER_PREFIX}${id}${PLACEHOLDER_SUFFIX}`;
      const entry = placeholderByToken.get(placeholder);
      if (entry) {
          placeholderPrintInfo.push({
            entry,
            indentationLevel: depth,
            inline: parentInline,
            inAttribute: false,
          });
      }
      return placeholder;
    });

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
      const entry = placeholderByToken.get(placeholder);
      if (entry) {
        placeholderPrintInfo.push({
          entry,
          indentationLevel: 0,
          inline: true,
          inAttribute: true,
        });
      }
    }
  }

  const root = analysis.tree.rootNode;
  return {
    html: Array.from({ length: root.namedChildCount }, (_, idx) => {
      const child = root.namedChild(idx);
      return child ? printNode(child, 0, false) : "";
    }).join(""),
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

  let current: SyntaxNode | null = node;
  while (current) {
    if (current.type === "element") {
      elementDepth += 1;
    }
    if (current.type === "attribute_value" || current.type === "attribute") {
      inAttribute = true;
    }
    current = current.parent;
  }

  return { elementDepth, inAttribute };
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
