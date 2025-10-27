import fs from "fs/promises";
import path from "path";
import { Language as TreeSitterLanguage, Parser } from "web-tree-sitter";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);

interface LanguageSource {
  wasmFile: string;
  packageName: string;
  packageAsset: string;
}

const LANGUAGE_SOURCES = {
  embeddedTemplate: {
    wasmFile: "embedded-template.wasm",
    packageName: "tree-sitter-embedded-template",
    packageAsset: "tree-sitter-embedded_template.wasm",
  },
  html: {
    wasmFile: "html.wasm",
    packageName: "tree-sitter-html",
    packageAsset: "tree-sitter-html.wasm",
  },
  ruby: {
    wasmFile: "ruby.wasm",
    packageName: "tree-sitter-ruby",
    packageAsset: "tree-sitter-ruby.wasm",
  },
} as const;

await Parser.init();

const [EMBEDDED_TEMPLATE_LANGUAGE, HTML_LANGUAGE, RUBY_LANGUAGE] = await Promise.all([
  loadLanguage(LANGUAGE_SOURCES.embeddedTemplate),
  loadLanguage(LANGUAGE_SOURCES.html),
  loadLanguage(LANGUAGE_SOURCES.ruby),
]);

type ParserInstance = InstanceType<typeof Parser>;
type TemplateTree = NonNullable<ReturnType<ParserInstance["parse"]>>;
type SyntaxNode = TemplateTree["rootNode"];

interface Range {
  startIndex: number;
  endIndex: number;
  startPosition: {
    row: number;
    column: number;
  };
  endPosition: {
    row: number;
    column: number;
  };
}

export type RubyDirectiveFlavor = "logic" | "output" | "comment" | "unknown";

export interface RegionBase {
  range: Range;
  text: string;
}

export interface HtmlRegion extends RegionBase {
  type: "html";
  tree: TemplateTree;
}

export interface RubyRegion extends RegionBase {
  type: "ruby";
  flavor: RubyDirectiveFlavor;
  code: string;
  codeRange: Range | null;
  delimiters: {
    open: string;
    close: string;
  };
  tree: TemplateTree | null;
}

export interface UnknownRegion extends RegionBase {
  type: "unknown";
  nodeType: string;
}

export type ERBRegion = HtmlRegion | RubyRegion | UnknownRegion;

export interface ParsedERB {
  tree: TemplateTree;
  regions: ERBRegion[];
}

export function parseERB(source: string): ParsedERB {
  const templateParser = new Parser();
  templateParser.setLanguage(EMBEDDED_TEMPLATE_LANGUAGE);

  const htmlParser = new Parser();
  htmlParser.setLanguage(HTML_LANGUAGE);

  const rubyParser = new Parser();
  rubyParser.setLanguage(RUBY_LANGUAGE);

  const tree = templateParser.parse(source);
  if (!tree) {
    throw new Error("Failed to parse ERB template: parser returned null tree.");
  }
  const root = tree.rootNode;
  const regions: ERBRegion[] = [];

  for (const child of root.namedChildren) {
    if (!child) continue;
    const text = sliceSource(source, child);
    const range = toRange(child);
    switch (child.type) {
      case "content": {
        const htmlTree = htmlParser.parse(text);
        if (!htmlTree) {
          throw new Error("Failed to parse HTML content region.");
        }
        regions.push({
          type: "html",
          text,
          range,
          tree: htmlTree,
        });
        break;
      }
      case "directive":
      case "output_directive":
      case "comment_directive": {
        const codeNode =
          child.namedChildren.find(
            (candidate): candidate is SyntaxNode => Boolean(candidate && candidate.type === "code"),
          ) ?? null;
        const rawCodeText = codeNode ? sliceSource(source, codeNode) : "";
        const code = rawCodeText.trim();
        const rubyTree =
          codeNode && code
            ? rubyParser.parse(ensureTrailingNewline(code))
            : codeNode
              ? rubyParser.parse("")
              : null;
        regions.push({
          type: "ruby",
          flavor: mapDirectiveFlavor(child.type),
          text,
          range,
          code,
          codeRange: codeNode ? toRange(codeNode) : null,
          delimiters: {
            open: child.firstChild?.text ?? "",
            close: child.lastChild?.text ?? "",
          },
          tree: rubyTree,
        });
        break;
      }
      default: {
        regions.push({
          type: "unknown",
          nodeType: child.type,
          text,
          range,
        });
      }
    }
  }

  return { tree, regions };
}

export function getHtmlParser() {
  const parser = new Parser();
  parser.setLanguage(HTML_LANGUAGE);
  return parser;
}

export function getRubyParser() {
  const parser = new Parser();
  parser.setLanguage(RUBY_LANGUAGE);
  return parser;
}

// Work-in-progress idea: compute Ruby block depth by tracking enter/exit keywords.
// Each directive would contribute deltas derived from its Ruby AST:
//   1. Walk `RubyRegion.tree`, identifying nodes that open blocks (`if`, `do`, etc.).
//   2. Emit +1 for block starters and -1 for matching `end` nodes (plus modifiers).
//   3. Accumulate deltas across regions in document order to recover depth at each
//      boundary, effectively mirroring a stack without storing every frame.
// This stub keeps the surface API while we iterate on the analysis logic.
export function computeRubyBlockDepth(_: RubyRegion[]): number {
  // Placeholder implementation; will evolve to return per-region depth metadata.
  return 0;
}

function mapDirectiveFlavor(type: string): RubyDirectiveFlavor {
  switch (type) {
    case "directive":
      return "logic";
    case "output_directive":
      return "output";
    case "comment_directive":
      return "comment";
    default:
      return "unknown";
  }
}

function sliceSource(source: string, node: SyntaxNode): string {
  return source.slice(node.startIndex, node.endIndex);
}

function toRange(node: SyntaxNode): Range {
  return {
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    startPosition: node.startPosition,
    endPosition: node.endPosition,
  };
}

function ensureTrailingNewline(code: string): string {
  if (!code) return code;
  return code.endsWith("\n") ? code : `${code}\n`;
}

async function loadLanguage(source: LanguageSource): Promise<TreeSitterLanguage> {
  const candidates = [
    fileURLToPath(new URL(`./grammars/${source.wasmFile}`, import.meta.url)),
    resolvePackageAsset(source.packageName, source.packageAsset),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return TreeSitterLanguage.load(candidate);
    } catch {
      // try next candidate
    }
  }

  throw new Error(
    `Unable to locate WebAssembly grammar for ${source.packageName}. Checked: ${candidates.join(
      ", ",
    )}`,
  );
}

function resolvePackageAsset(packageName: string, asset: string): string | null {
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    const packageDir = path.dirname(packageJsonPath);
    return path.join(packageDir, asset);
  } catch {
    return null;
  }
}
