import fs from "fs";
import { describe, expect, it } from "vitest";
import { parseERB } from "../src/parser.js";
import { buildPlaceholderDocument } from "../src/formatter/placeholders.js";
import { analyzePlaceholderDocument, renderHtmlDocument } from "../src/formatter/htmlDocument.js";

describe("html document analysis", () => {
  it("produces structured HTML with placeholder-aware indentation", () => {
    const source = fs.readFileSync("examples/dashboard-unformatted.erb", "utf8");
    const parsed = parseERB(source);
    const placeholderDocument = buildPlaceholderDocument(parsed.regions);
    const analysis = analyzePlaceholderDocument(placeholderDocument);
    const rendered = renderHtmlDocument(analysis, 2, "space", "conservative");

    expect(rendered.html).toMatchInlineSnapshot(`
      "<div class="dashboard">
        __ERB_PLACEHOLDER_0__
        <div class="project">
          <h2>__ERB_PLACEHOLDER_1__</h2>
          <ul>
            __ERB_PLACEHOLDER_2__
            <li class="__ERB_PLACEHOLDER_3__">
              <span>__ERB_PLACEHOLDER_4__</span>
              __ERB_PLACEHOLDER_5__
              <p class="notes">__ERB_PLACEHOLDER_6__</p>
              __ERB_PLACEHOLDER_7__
            </li>
            __ERB_PLACEHOLDER_8__
          </ul>
        </div>
        __ERB_PLACEHOLDER_9__
      </div>
      "
    `);

    expect(rendered.placeholderPrintInfo.length).toBeGreaterThan(0);
    rendered.placeholderPrintInfo.forEach((info) => {
      expect(info.indentationLevel).toBeGreaterThanOrEqual(0);
    });
  });
});
