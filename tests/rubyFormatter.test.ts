import { describe, it, expect } from "vitest";
import { formatRubyCode } from "../src/formatter/rubyFormatter.js";
import { DEFAULT_FORMATTER_CONFIG } from "../src/formatter/index.js";

function cloneConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_FORMATTER_CONFIG));
}

describe("formatRubyCode", () => {
  it("re-indents nested blocks and preserves comments", () => {
    const config = cloneConfig();
    config.indentation.size = 2;
    const input = `
if user
puts "root"
if user.admin?
puts "admin"
end
else
# comment branch
puts "guest"
end
`.trim();

    const formatted = formatRubyCode(input, config);
    expect(formatted).toBe(
      [
        "if user",
        '  puts "root"',
        "  if user.admin?",
        '    puts "admin"',
        "  end",
        "else",
        "  # comment branch",
        '  puts "guest"',
        "end",
      ].join("\n"),
    );
  });

  it("wraps long helper arguments beyond configured width", () => {
    const config = cloneConfig();
    config.indentation.size = 2;
    config.indentation.continuation = 4;
    config.ruby.lineWidth = 40;
    const input = `link_to(helper_label(user), user_path(user), class: "btn btn-primary", data: { turbo: false })`;
    const formatted = formatRubyCode(input, config);
    expect(formatted).toBe(
      [
        "link_to(",
        "    helper_label(user),",
        "    user_path(user),",
        '    class: "btn btn-primary",',
        "    data: { turbo: false })",
      ].join("\n"),
    );
  });

  it("leaves short expressions untouched", () => {
    const config = cloneConfig();
    const input = `if foo then bar end`;
    expect(formatRubyCode(input, config)).toBe("if foo then bar end");
  });

  it("preserves heredocs and content without re-wrapping", () => {
    const config = cloneConfig();
    const input = `
if template
body = <<~MARKDOWN
  # Heading
  Some content
MARKDOWN
end
`.trim();
    const formatted = formatRubyCode(input, config);
    expect(formatted).toBe(
      [
        "if template",
        "  body = <<~MARKDOWN",
        "  # Heading",
        "  Some content",
        "  MARKDOWN",
        "end",
      ].join("\n"),
    );
  });
});
