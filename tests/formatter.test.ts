import fs from "fs";
import { describe, it, expect } from "vitest";
import type { FormatSegment } from "../src/formatter/index.js";
import { formatERB, DEFAULT_FORMATTER_CONFIG } from "../src/formatter/index.js";
import type { ERBRegion, RubyRegion } from "../src/parser.js";
import { parseERB } from "../src/parser.js";

describe("formatERB", () => {
  const source = fs.readFileSync("examples/sample.erb", "utf8");
  const parsed = parseERB(source);

  it("formats sample template into structured output", () => {
    const result = formatERB(parsed);
    expect(result.output).toBe(
      `<% if @user %>\n  <h1>Welcome, <%= @user.name %>!</h1>\n  <p>Your email is <%= @user.email %>.</p>\n<% else %>\n  <p>Please log in.</p>\n<% end %>\n`,
    );
    expect(result.segments.some((segment) => segment.kind === "html")).toBe(
      true,
    );
    expect(result.segments.some((segment) => segment.kind === "ruby")).toBe(
      true,
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.config).toEqual(DEFAULT_FORMATTER_CONFIG);
    expect(result.debug?.placeholderHtml).toContain("__ERB_PLACEHOLDER_0__");
  });

  it("merges custom configuration without mutating defaults", () => {
    const custom = formatERB(parsed, {
      indentation: { size: 4 },
      whitespace: { trimTrailingWhitespace: false },
    });

    expect(custom.config.indentation.size).toBe(4);
    expect(custom.config.indentation.style).toBe(
      DEFAULT_FORMATTER_CONFIG.indentation.style,
    );
    expect(custom.config.whitespace.trimTrailingWhitespace).toBe(false);
    expect(DEFAULT_FORMATTER_CONFIG.indentation.size).toBe(2);
    expect(DEFAULT_FORMATTER_CONFIG.whitespace.trimTrailingWhitespace).toBe(
      true,
    );
  });

  it("normalizes trailing whitespace and final newline across regions", () => {
    let unformatted = fs.readFileSync(
      "examples/sample-unformatted.erb",
      "utf8",
    );
    if (unformatted.endsWith("\n")) {
      unformatted = unformatted.slice(0, -1);
    }
    const expected = `<% if @user %>\n  <h1>Welcome, <%= @user.name %>!</h1>\n  <p>Your email is <%= @user.email %>.</p>\n<% else %>\n  <p>Please log in.</p>\n<% end %>\n`;

    const parsedUnformatted = parseERB(unformatted);
    const result = formatERB(parsedUnformatted);

    expect(result.output).toBe(expected);
    expect(result.output.endsWith("\n")).toBe(true);
    expect(result.output).not.toMatch(/[ \t]+$/m);
    expect(result.segments.some((segment) => segment.kind === "html")).toBe(
      true,
    );
    expect(result.segments.some((segment) => segment.kind === "ruby")).toBe(
      true,
    );
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
        code: segment.region!.code.trim(),
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

    expect(result.output).toBe(
      `<% if condition %>\n  <span>Body</span>\n<% end  # comment %>\n`,
    );

    const logicSegments = result.segments.filter(isLogicSegment);
    expect(
      logicSegments.map((segment) => ({
        code: segment.region!.code,
        level: segment.indentationLevel,
      })),
    ).toEqual([
      { code: "if condition", level: 0 },
      { code: "end # comment", level: 0 },
    ]);
  });

  it("collapses redundant HTML whitespace without touching semantic gaps", () => {
    const source = fs.readFileSync(
      "examples/dashboard-unformatted.erb",
      "utf8",
    );
    const result = formatERB(parseERB(source));

    expect(result.output).toMatchInlineSnapshot(`
      "<div class="dashboard" data-owner="<%= @owner&.name %>" data-project-count="<%= @projects.size %>" data-theme="<%= @theme||'default' %>">
        <% @projects.each do |project| %>
          <div class="project-card" id="project-<%= project.id %>" data-state="<%= project.state %>" data-tags="<%= project.tags.join(',') %>" data-featured="<%= project.featured? %>">
            <header class="card-header" data-empty="<%= project.tasks.empty? %>">
              <h2 title="<%= project.name %>">
                <span class="icon <%= project.icon_class %>"></span>
                <%= project.name.upcase %>
              </h2>
              <div class="metadata" data-owner="<%= project.owner&.name || 'Unassigned' %>" data-due="<%= project.due_at&.iso8601 %>" data-budget="<%= number_to_currency(project.budget) %>" data-flags="<%= project.flags.join('|') %>">
                <span class="owner"><%= project.owner&.name || 'Unassigned' %></span>
                <span class="due" data-kind="date"><%= project.due_at ? l(project.due_at, format: :long) : 'No deadline' %></span>
                <span
                  class="budget"
                  data-currency="USD"
                ><%= number_to_currency(project.budget||0) %></span>
              </div>
            </header>
            <section class="card-body">
              <ul class="task-list" data-count="<%= project.tasks.size %>" data-has-overdue="<%= project.tasks.any?(&:overdue?) %>" data-random="<%= SecureRandom.hex(2) %>">
                <% project.tasks.each_with_index do |task, index| %>
                  <li class="task <%= task.completed? ? 'done' : 'pending' %>" data-index="<%= index %>" data-id="<%= task.id %>" data-tags="<%= task.tags.join(';') %>">
                    <span class="title" data-priority="<%= task.priority %>"><%= task.title.strip %></span>
                    <span class="assignee" data-role="<%= task.assignee&.role %>"><%= task.assignee&.name || 'Unassigned' %></span>
                    <div class="flags" data-flags="<%= task.flags.join('|') %>">
                      <% task.flags.each do |flag| %>
                        <span class="flag flag-<%= flag.parameterize %>" data-flag="<%= flag %>"><%= flag.humanize %></span>
                      <% end %>
                    </div>
                    <% if task.notes.present? %>
                      <details class="notes" data-length="<%= task.notes.length %>" data-trimmed="<%= (task.notes.strip == task.notes).to_s %>">
                        <summary>Notes</summary>
                        <pre class="note-body" data-source="<%= task.note_source %>">
      <%= task.notes %>
                  </pre>
                </details>
                              <% else %>
                      <span class="notes-placeholder">No additional notes</span>
                    <% end %>
                  </li>
                <% end %>
                <li class="task summary" data-summary="true" data-id="summary-<%= project.id %>" data-total-duration="<%= project.tasks.sum(&:duration) %>" data-completed="<%= project.tasks.count(&:completed?) %>">
                  <span>Total time logged:</span>
                  <strong><%= project.tasks.sum(&:duration).then { |minutes| "#{minutes / 60}h #{minutes % 60}m" } %></strong>
                  <span class="completed" data-completed="<%= project.tasks.count(&:completed?) %>">Completed: <%= project.tasks.count(&:completed?) %></span>
                </li>
                <li class="task metrics" data-summary="secondary" data-id="metrics-<%= project.id %>">
                  <span class="velocity">Velocity: <%= project.velocity || 'N/A' %></span>
                  <span class="health" data-health="<%= project.health %>">Health: <%= project.health %></span>
                  <span class="risk" data-risk="<%= project.risk %>">Risk: <%= project.risk %></span>
                </li>
              </ul>
            </section>
            <footer class="card-footer" data-created="<%= project.created_at.iso8601 %>" data-updated="<%= project.updated_at.iso8601 %>" data-links="view,edit,archive">
              <a class="btn btn-sm" href="<%= project_path(project) %>" data-action="view" data-hotkey="v">View Project</a>
              <a class="btn btn-sm" href="<%= edit_project_path(project) %>" data-action="edit" data-enabled="<%= can?(:update, project) %>">Edit</a>
              <button class="btn btn-sm" data-action="archive" data-confirm="Are you sure you want to archive <%= project.name %>?" data-enabled="<%= can?(:archive, project) %>">Archive</button>
            </footer>
          </div>
        <% end %>
      </div>
      "
    `);

    expect(result.debug?.placeholderHtml).toContain("__ERB_PLACEHOLDER_0__");
    expect(result.output).not.toMatch(/>[ \t]{2,}</); // adjacent tags separated by multiple spaces
  });

  it("preserves strict locals comment directives", () => {
    const snippet = `<%# locals: foo:, bar:, baz: %>\n<%= foo %>\n`;
    const result = formatERB(parseERB(snippet));

    expect(result.output.startsWith("<%# locals: foo:, bar:, baz: %>")).toBe(
      true,
    );
    expect(result.output).toContain("<%= foo %>");
  });

  it("indents multi-line inline ruby expressions relative to HTML containers", () => {
    const source = fs.readFileSync("examples/multiline-ruby.erb", "utf8");
    const result = formatERB(parseERB(source));

    expect(result.output).toBe(`<div class="field">
  <%=
    DeveloperDashboard::Tags::TextField.new(
      object_name,
      method_name,
      template,
      {
        label:,
        hide_label:,
        show_character_count:,
        name:,
        id:,
        **input_attributes
      }
    ).render
  %>
</div>
`);
  });

  it("preserves whitespace-sensitive content", () => {
    const snippet = `<pre>
  line 1
  <% if condition %>
    yield
  <% end %>
</pre>`;
    const result = formatERB(parseERB(snippet));

    expect(result.output).toBe(`<pre>
  line 1
  <% if condition %>
    yield
  <% end %>
</pre>
`);
  });

  it("wraps attributes according to width settings", () => {
    const snippet = `<div id="foo" class="alpha beta gamma delta epsilon zeta eta theta iota">Content</div>`;
    const result = formatERB(parseERB(snippet), {
      html: {
        attributeWrapping: "auto",
        lineWidth: 40,
      },
    });

    expect(result.output).toMatchInlineSnapshot(`
      "<div
        id="foo"
        class="alpha beta gamma delta epsilon zeta eta theta iota"
      >Content</div>
      "
    `);
  });

  it("wraps complex attribute values while preserving JSON and ERB", () => {
    const snippet = `<div data-json='{"items":[{"name":"Foo"},{"name":"Bar"}]}' data-attr="<%= { foo: 'bar', baz: value }.to_json %>" class='one   two three'>Text</div>`;
    const result = formatERB(parseERB(snippet), {
      html: {
        attributeWrapping: "auto",
        lineWidth: 60,
      },
    });

    expect(result.output).toBe(`<div
  data-json='{"items":[{"name":"Foo"},{"name":"Bar"}]}'
  data-attr="<%= { foo: 'bar', baz: value }.to_json %>"
  class='one two three'
>Text</div>
`);
  });

  it("forces multi-line layout when configured explicitly", () => {
    const snippet = `<span id="item" data-description='{"content":"${"a".repeat(120)}"}' data-extra="<%= helper.generate(id: item.id, flags: params[:flags]) %>">Item</span>`;
    const result = formatERB(parseERB(snippet), {
      html: {
        attributeWrapping: "force-multi-line",
        lineWidth: 40,
      },
    });

    expect(result.output).toBe(`<span
  id="item"
  data-description='{"content":"${"a".repeat(120)}"}'
  data-extra="<%= helper.generate(id: item.id, flags: params[:flags]) %>"
>Item</span>
`);
  });

  it("gracefully formats markup with missing closing tags", () => {
    const snippet = `<div><span class="label">Hi<% if condition %></div>`;
    const result = formatERB(parseERB(snippet));

    expect(result.output).toBe(`<div>
  <span class="label">Hi<% if condition %></span>
</div>
`);
    expect(result.diagnostics).toEqual([]);
  });

  it("preserves original markup when HTML parsing fails", () => {
    const snippet = `<div data-json="{ \\"items\\": [ { \\"name\\": \\"Foo\\" } ] }">Text</div>`;
    const result = formatERB(parseERB(snippet));

    expect(result.output).toBe(`${snippet}\n`);
    expect(result.diagnostics).toEqual([
      {
        index: -1,
        severity: "error",
        message: "HTML parse reported syntax errors in placeholder document",
      },
    ]);
  });

  it("normalizes spacing inside ruby directives", () => {
    const snippet = `<div>
<%   if  condition   %>
  <span><%=   user.name   %></span>
<%    end   %>
</div>`;
    const result = formatERB(parseERB(snippet));

    expect(result.output).toBe(`<div>
  <% if condition %>
    <span><%= user.name %></span>
  <% end %>
</div>
`);
  });

  it("cleans up mixed indentation in HTML content", () => {
    const snippet = `<ul>
\t<li class="item">Item 1</li>
  \t<li class="item">Item 2<% if flag %>!<% end %></li>
</ul>`;
    const result = formatERB(parseERB(snippet));

    expect(result.output).toBe(`<ul>
  <li class="item">Item 1</li>
  <li class="item">Item 2<% if flag %>!<% end %></li>
</ul>
`);
  });

  it("is idempotent for example fixtures", () => {
    const fixtures = [
      "examples/sample.erb",
      "examples/sample-unformatted.erb",
      "examples/dashboard-unformatted.erb",
    ];

    fixtures.forEach((fixturePath) => {
      const source = fs.readFileSync(fixturePath, "utf8");
      const firstPass = formatERB(parseERB(source)).output;
      const secondPass = formatERB(parseERB(firstPass)).output;
      expect(secondPass).toBe(firstPass);
    });
  });
});

function isLogicSegment(
  segment: FormatSegment,
): segment is FormatSegment & { region: RubyRegion } {
  return (
    segment.kind === "ruby" &&
    !!segment.region &&
    segment.region.type === "ruby" &&
    segment.region.flavor === "logic"
  );
}
