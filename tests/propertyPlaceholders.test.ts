import { describe, it, expect } from "vitest";
import { parseERB } from "../src/parser.js";
import { formatERB } from "../src/formatter/index.js";
import {
  buildPlaceholderDocument,
  PLACEHOLDER_PREFIX,
  PLACEHOLDER_SUFFIX,
} from "../src/formatter/placeholders.js";

type FormatterConfigInput = Parameters<typeof formatERB>[1];

const HTML_FRAGMENTS = [
  "<div>",
  "</div>",
  '<span class="label">',
  "</span>",
  "<section>",
  "</section>",
  "<ul>",
  "<li>",
  "</li>",
  "<p>Text</p>",
  "<!-- comment -->",
  "\n",
  " ",
  "  ",
  '<article data-kind="card">',
  "</article>",
];

const RUBY_SEGMENTS = [
  "<% if condition %>",
  "<% elsif other_condition %>",
  "<% else %>",
  "<% end %>",
  "<% @items.each do |item| %>",
  "<% @items.each_with_index do |item, index| %>",
  "<%= render partial: 'items/item', locals: { item: item } %>",
  "<%= number_to_currency(total) %>",
  "<%= item.name %>",
  "<%# comment %>",
  "<%= (@value || 0).to_s %>",
  "<% cache ['dashboard', current_user.cache_key] do %>",
  "<% end %>",
];

const CONFIG_VARIANTS: FormatterConfigInput[] = [
  undefined,
  { indentation: { size: 2 } },
  { indentation: { size: 4, style: "space" } },
  { html: { attributeWrapping: "auto", lineWidth: 60 } },
  { html: { attributeWrapping: "force-multi-line", lineWidth: 48 } },
  { html: { collapseWhitespace: "aggressive" } },
  { whitespace: { trimTrailingWhitespace: false } },
  { newline: "crlf" },
];

const RUNS = 250;

describe("formatter placeholder invariants", () => {
  it("preserves placeholder ordering after formatting and reparsing", () => {
    let validated = 0;

    for (let i = 0; i < RUNS; i += 1) {
      const rng = createRng(0x1234abcd ^ (i * 0x9e3779b1));
      const segmentCount = 3 + Math.floor(rng() * 10);
      const segments: string[] = [];

      for (let s = 0; s < segmentCount; s += 1) {
        const chooseRuby = rng() < 0.4;
        if (chooseRuby) {
          segments.push(pick(rng, RUBY_SEGMENTS));
        } else {
          segments.push(pick(rng, HTML_FRAGMENTS));
        }
      }

      const source = segments.join("");
      const parsed = parseERB(source);
      const config = pick(rng, CONFIG_VARIANTS);
      const result = formatERB(parsed, config);

      if (result.diagnostics.some((diag) => diag.severity === "error")) {
        continue;
      }

      const placeholderCount = result.debug?.placeholderCount ?? 0;
      const formatted = result.output;
      const reparsed = parseERB(formatted);
      const placeholderDoc = buildPlaceholderDocument(reparsed.regions);
      const rubyRegions = reparsed.regions.filter(
        (region) => region.type === "ruby",
      );

      expect(rubyRegions.length).toBe(placeholderCount);
      expect(placeholderDoc.placeholders.length).toBe(placeholderCount);
      const debugRawHtml = result.debug?.placeholderHtml ?? formatted;
      const placeholderPattern = new RegExp(
        `${PLACEHOLDER_PREFIX}\\d+${PLACEHOLDER_SUFFIX}`,
        "g",
      );

      const docTokens = Array.from(
        placeholderDoc.html.matchAll(placeholderPattern),
        (match) => match[0],
      );
      const debugTokens = Array.from(
        debugRawHtml.matchAll(placeholderPattern),
        (match) => match[0],
      );
      expect(docTokens).toEqual(debugTokens);

      const docScaffold = normalizeScaffolding(
        placeholderDoc.html.replace(placeholderPattern, ""),
      );
      const debugScaffold = normalizeScaffolding(
        debugRawHtml.replace(placeholderPattern, ""),
      );
      expect(docScaffold).toBe(debugScaffold);

      placeholderDoc.placeholders.forEach((entry, index) => {
        expect(entry.id).toBe(index);
        expect(entry.regionIndex).toBeGreaterThanOrEqual(index);

        const pattern = escapeForRegex(entry.placeholder);
        const occurrences =
          placeholderDoc.html.match(new RegExp(pattern, "g"))?.length ?? 0;
        expect(occurrences).toBe(1);
      });

      for (let idx = 1; idx < placeholderDoc.placeholders.length; idx += 1) {
        const previous = placeholderDoc.placeholders[idx - 1];
        const current = placeholderDoc.placeholders[idx];
        expect(current.regionIndex).toBeGreaterThanOrEqual(
          previous.regionIndex,
        );
      }

      validated += 1;
    }

    expect(validated).toBeGreaterThan(0);
  });
});

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  const index = Math.floor(rng() * items.length);
  return items[index];
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeScaffolding(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}
