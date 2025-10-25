import fs from "fs";
import { describe, expect, it } from "vitest";
import { parseERB } from "../src/parser.js";
import { buildPlaceholderDocument, restoreFromPlaceholders } from "../src/formatter/placeholders.js";
import { analyzePlaceholderDocument } from "../src/formatter/htmlDocument.js";

describe("placeholder document", () => {
  it("replaces ruby regions with unique placeholders and restores the original text", () => {
    const source = fs.readFileSync("examples/dashboard-unformatted.erb", "utf8");
    const parsed = parseERB(source);

    const placeholderDocument = buildPlaceholderDocument(parsed.regions);

    const rubyCount = parsed.regions.filter((region) => region.type === "ruby").length;
    expect(placeholderDocument.placeholders).toHaveLength(rubyCount);
    placeholderDocument.placeholders.forEach((entry, index) => {
      expect(entry.id).toBe(index);
      expect(entry.regionIndex).toBeGreaterThanOrEqual(0);
      expect(entry.placeholder).toBe(`__ERB_PLACEHOLDER_${index}__`);
      expect(entry.placeholder).not.toContain("<%=");
    });

    expect(placeholderDocument.html).not.toContain("<%");
    expect(placeholderDocument.html).toContain("__ERB_PLACEHOLDER_");

    const reconstructed = restoreFromPlaceholders(
      placeholderDocument.html,
      placeholderDocument.placeholders,
    );

    const joined = parsed.regions.map((region) => region.text).join("");
    expect(reconstructed).toBe(joined);
    expect(reconstructed).toBe(source);

    const analysis = analyzePlaceholderDocument(placeholderDocument);
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.placeholders).toHaveLength(rubyCount);
    analysis.placeholders.forEach((info, index) => {
      expect(info.entry.id).toBe(index);
      expect(info.elementDepth).toBeGreaterThanOrEqual(0);
      expect(info.startIndex).toBeGreaterThanOrEqual(0);
      expect(info.node).toBeTruthy();
    });
  });

  it("handles templates without ruby regions", () => {
    const htmlOnly = `<div class="card">\n  <h2>Title</h2>\n</div>`;
    const parsed = parseERB(htmlOnly);
    const placeholderDocument = buildPlaceholderDocument(parsed.regions);

    expect(placeholderDocument.placeholders).toHaveLength(0);
    expect(placeholderDocument.html).toBe(htmlOnly);
    expect(restoreFromPlaceholders(placeholderDocument.html, placeholderDocument.placeholders)).toBe(htmlOnly);
  });
  it("preserves placeholders in attribute contexts", () => {
    const source = '<div class="prefix <%= @status %> suffix">content</div>';
    const parsed = parseERB(source);
    const placeholderDocument = buildPlaceholderDocument(parsed.regions);

    expect(placeholderDocument.placeholders).toHaveLength(1);
    expect(placeholderDocument.html).toContain('class="prefix __ERB_PLACEHOLDER_0__ suffix"');
    const restored = restoreFromPlaceholders(
      placeholderDocument.html,
      placeholderDocument.placeholders,
    );
    expect(restored).toBe(source);

    const analysis = analyzePlaceholderDocument(placeholderDocument);
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.placeholders).toHaveLength(1);
    expect(analysis.placeholders[0].inAttribute).toBe(true);
  });
});
