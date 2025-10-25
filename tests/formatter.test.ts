import fs from "fs";
import { describe, it, expect } from "vitest";
import type { FormatSegment } from "../src/formatter/index.js";
import { formatERB, DEFAULT_FORMATTER_CONFIG } from "../src/formatter/index.js";
import type { ERBRegion, RubyRegion } from "../src/parser.js";
import { parseERB } from "../src/parser.js";

describe("formatERB", () => {
  const source = fs.readFileSync("examples/sample.erb", "utf8");
  const parsed = parseERB(source);

  it("returns a passthrough output with explicit segments", () => {
    const result = formatERB(parsed);
    expect(result.output).toBe(source);
    expect(result.segments).toHaveLength(parsed.regions.length);
    expect(result.segments.every((segment) => segment.mode === "passthrough")).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.config).toEqual(DEFAULT_FORMATTER_CONFIG);
  });

  it("merges custom configuration without mutating defaults", () => {
    const custom = formatERB(parsed, {
      indentation: { size: 4 },
      whitespace: { trimTrailingWhitespace: false },
    });

    expect(custom.config.indentation.size).toBe(4);
    expect(custom.config.indentation.style).toBe(DEFAULT_FORMATTER_CONFIG.indentation.style);
    expect(custom.config.whitespace.trimTrailingWhitespace).toBe(false);
    expect(DEFAULT_FORMATTER_CONFIG.indentation.size).toBe(2);
    expect(DEFAULT_FORMATTER_CONFIG.whitespace.trimTrailingWhitespace).toBe(true);
  });

  it("normalizes trailing whitespace and final newline across regions", () => {
    let unformatted = fs.readFileSync("examples/sample-unformatted.erb", "utf8");
    if (unformatted.endsWith("\n")) {
      unformatted = unformatted.slice(0, -1);
    }
    const expected = `<% if @user %>
  <h1>Welcome, <%= @user.name %>!</h1>
  <p>Your email is <%= @user.email %>.</p>
<% else %>
  <p>Please log in.</p>
<% end %>
`;

    const parsedUnformatted = parseERB(unformatted);
    const result = formatERB(parsedUnformatted);

    expect(result.output).toBe(expected);
    expect(result.output.endsWith("\n")).toBe(true);
    expect(result.output).not.toMatch(/[ \t]+$/m);
    expect(result.segments.some((segment) => segment.mode === "html-normalized")).toBe(true);
    expect(result.segments.some((segment) => segment.mode === "ruby-normalized")).toBe(true);
  });

  it("computes indentation levels for nested ruby directives", () => {
    const messy = `<% if outer %>
<% if inner %>
<span>Hi</span>
<% elsif other %>
<span>Bye</span>
<% else %>
<span>Maybe</span>
<% end %>
<% end %>`;

    const expected = `<% if outer %>
  <% if inner %>
    <span>Hi</span>
  <% elsif other %>
    <span>Bye</span>
  <% else %>
    <span>Maybe</span>
  <% end %>
<% end %>
`;

    const parsedNested = parseERB(messy);
    const result = formatERB(parsedNested);

    expect(result.output).toBe(expected);

    const logicIndentLevels = result.segments
      .filter(isLogicSegment)
      .map((segment) => ({
        code: segment.region.code.trim(),
        level: segment.indentationLevel,
      }));

    expect(logicIndentLevels).toEqual([
      { code: "if outer", level: 0 },
      { code: "if inner", level: 1 },
      { code: "elsif other", level: 1 },
      { code: "else", level: 1 },
      { code: "end", level: 1 },
      { code: "end", level: 0 },
    ]);
  });

  it("dedents ruby closing directives even with trailing comments", () => {
    const snippet = `<% if condition %>\n<span>Body</span>\n<% end # comment %>\n`;
    const result = formatERB(parseERB(snippet));

    expect(result.output).toBe(`<% if condition %>\n  <span>Body</span>\n<% end # comment %>\n`);

    const logicSegments = result.segments.filter(isLogicSegment);
    expect(logicSegments.map((segment) => ({ code: segment.region.code, level: segment.indentationLevel }))).toEqual([
      { code: "if condition", level: 0 },
      { code: "end # comment", level: 0 },
    ]);
  });

  it("collapses redundant HTML whitespace without touching semantic gaps", () => {
    const source = fs.readFileSync("examples/dashboard-unformatted.erb", "utf8");
    const result = formatERB(parseERB(source));

    expect(result.output).toMatchInlineSnapshot(`
      "<div class="dashboard">
      <% @projects.each do |project| %>
        <div class="project">
        <h2> <%= project.name %></h2>
        <ul>
        <% project.tasks.each do |task| %>
          <li class="<%= task.completed? ? 'done' : 'pending' %>">
          <span> <%= task.title %></span>
          <% if task.notes.present? %>

            <p class="notes"> <%= task.notes %></p>
          <% end %>
          </li>
        <% end %>
        </ul>
        </div>
      <% end %>
      </div>
      "
    `);

    expect(result.output).not.toMatch(/>[ \t]{2,}</); // adjacent tags separated by multiple spaces
  });
});

function isLogicSegment(segment: FormatSegment): segment is FormatSegment & { region: RubyRegion } {
  return segment.region.type === "ruby" && segment.region.flavor === "logic";
}
