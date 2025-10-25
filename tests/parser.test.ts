import fs from "fs";
import { describe, expect, it } from "vitest";
import type { ERBRegion } from "../src/parser.js";
import { parseERB } from "../src/parser.js";

describe("ERB parser", () => {
  it("extracts ruby and html regions with boundaries", () => {
    const source = fs.readFileSync("examples/sample.erb", "utf8");
    const parsed = parseERB(source);

    expect(parsed.tree.rootNode.hasError).toBe(false);

    const serialized = parsed.regions.map(serializeRegion);
    expect(serialized).toMatchInlineSnapshot(`
      [
        {
          "code": "if @user",
          "codeRange": {
            "end": {
              "column": 12,
              "index": 12,
              "row": 0,
            },
            "start": {
              "column": 2,
              "index": 2,
              "row": 0,
            },
          },
          "delimiters": {
            "close": "%>",
            "open": "<%",
          },
          "flavor": "logic",
          "hasRubyError": true,
          "range": {
            "end": {
              "column": 14,
              "index": 14,
              "row": 0,
            },
            "start": {
              "column": 0,
              "index": 0,
              "row": 0,
            },
          },
          "type": "ruby",
        },
        {
          "hasHtmlError": true,
          "range": {
            "end": {
              "column": 15,
              "index": 30,
              "row": 1,
            },
            "start": {
              "column": 14,
              "index": 14,
              "row": 0,
            },
          },
          "text": "<h1>Welcome,",
          "type": "html",
        },
        {
          "code": "@user.name",
          "codeRange": {
            "end": {
              "column": 30,
              "index": 45,
              "row": 1,
            },
            "start": {
              "column": 18,
              "index": 33,
              "row": 1,
            },
          },
          "delimiters": {
            "close": "%>",
            "open": "<%=",
          },
          "flavor": "output",
          "hasRubyError": false,
          "range": {
            "end": {
              "column": 32,
              "index": 47,
              "row": 1,
            },
            "start": {
              "column": 15,
              "index": 30,
              "row": 1,
            },
          },
          "type": "ruby",
        },
        {
          "hasHtmlError": true,
          "range": {
            "end": {
              "column": 19,
              "index": 73,
              "row": 2,
            },
            "start": {
              "column": 32,
              "index": 47,
              "row": 1,
            },
          },
          "text": "!</h1> <p>Your email is",
          "type": "html",
        },
        {
          "code": "@user.email",
          "codeRange": {
            "end": {
              "column": 35,
              "index": 89,
              "row": 2,
            },
            "start": {
              "column": 22,
              "index": 76,
              "row": 2,
            },
          },
          "delimiters": {
            "close": "%>",
            "open": "<%=",
          },
          "flavor": "output",
          "hasRubyError": false,
          "range": {
            "end": {
              "column": 37,
              "index": 91,
              "row": 2,
            },
            "start": {
              "column": 19,
              "index": 73,
              "row": 2,
            },
          },
          "type": "ruby",
        },
        {
          "hasHtmlError": true,
          "range": {
            "end": {
              "column": 0,
              "index": 97,
              "row": 3,
            },
            "start": {
              "column": 37,
              "index": 91,
              "row": 2,
            },
          },
          "text": ".</p>",
          "type": "html",
        },
        {
          "code": "else",
          "codeRange": {
            "end": {
              "column": 8,
              "index": 105,
              "row": 3,
            },
            "start": {
              "column": 2,
              "index": 99,
              "row": 3,
            },
          },
          "delimiters": {
            "close": "%>",
            "open": "<%",
          },
          "flavor": "logic",
          "hasRubyError": false,
          "range": {
            "end": {
              "column": 10,
              "index": 107,
              "row": 3,
            },
            "start": {
              "column": 0,
              "index": 97,
              "row": 3,
            },
          },
          "type": "ruby",
        },
        {
          "hasHtmlError": false,
          "range": {
            "end": {
              "column": 0,
              "index": 132,
              "row": 5,
            },
            "start": {
              "column": 10,
              "index": 107,
              "row": 3,
            },
          },
          "text": "<p>Please log in.</p>",
          "type": "html",
        },
        {
          "code": "end",
          "codeRange": {
            "end": {
              "column": 7,
              "index": 139,
              "row": 5,
            },
            "start": {
              "column": 2,
              "index": 134,
              "row": 5,
            },
          },
          "delimiters": {
            "close": "%>",
            "open": "<%",
          },
          "flavor": "logic",
          "hasRubyError": false,
          "range": {
            "end": {
              "column": 9,
              "index": 141,
              "row": 5,
            },
            "start": {
              "column": 0,
              "index": 132,
              "row": 5,
            },
          },
          "type": "ruby",
        },
        {
          "hasHtmlError": false,
          "range": {
            "end": {
              "column": 0,
              "index": 142,
              "row": 6,
            },
            "start": {
              "column": 9,
              "index": 141,
              "row": 5,
            },
          },
          "text": "",
          "type": "html",
        },
      ]
    `);
  });
});

function serializeRegion(region: ERBRegion) {
  if (region.type === "html") {
    return {
      type: "html",
      text: squash(region.text),
      range: summariseRange(region.range),
      hasHtmlError: region.tree.rootNode.hasError,
    };
  }
  if (region.type === "ruby") {
    return {
      type: "ruby",
      flavor: region.flavor,
      range: summariseRange(region.range),
      codeRange: region.codeRange ? summariseRange(region.codeRange) : null,
      code: squash(region.code),
      delimiters: region.delimiters,
      hasRubyError: region.tree?.rootNode.hasError ?? null,
    };
  }
  return {
    type: "unknown",
    nodeType: region.nodeType,
    text: squash(region.text),
    range: summariseRange(region.range),
  };
}

function summariseRange(range: ERBRegion["range"]) {
  return {
    start: {
      index: range.startIndex,
      row: range.startPosition.row,
      column: range.startPosition.column,
    },
    end: {
      index: range.endIndex,
      row: range.endPosition.row,
      column: range.endPosition.column,
    },
  };
}

function squash(text: string) {
  const squashed = text.replace(/\s+/g, " ").trim();
  return squashed;
}
