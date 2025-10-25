# ERB Formatter – Polish Layer Roadmap

## Remaining Gaps
- **Whitespace-sensitive tags:** Current emitter treats all elements alike. `<pre>`, `<code>`, `<textarea>`, `<script>`, `<style>`, etc. must bypass whitespace collapsing and preserve internal formatting.
- **Inline ERB spacing:** Mixed text like `Hello<%= name %>` should gain configurable spacing when needed (before/after interpolation) without double spaces.
- **Attribute wrapping / line width:** No support yet for breaking long attributes or enforcing line width constraints (`FormatterConfig.html.lineWidth`, `attributeWrapping`).
- **Blank line policies:** Consecutive empty lines are collapsed uniformly; we lack options to preserve or enforce blank lines between blocks.
- **Ruby formatting hook:** Ruby snippets are only re-indented. Optional integration with a Ruby formatter (or configurable pass-through) would improve fidelity.
- **Diagnostics UX:** Only structural parse errors bubble up. Need clearer diagnostics (e.g., placeholders not mapped, whitespace-sensitive tag warnings).
- **Performance tuning:** Placeholder replacements currently rely on sequential string replacement. Optimizing with streaming/buffered reconstruction would avoid repeated slicing for large files.

## Core Principles
1. **Zero semantic drift:** Any polish must never alter the semantics of HTML or ERB (respect whitespace-sensitive contexts, keep attribute ordering).
2. **Config-first defaults:** Expose user toggles for spacing/wrapping decisions; keep current defaults conservative.
3. **Composable phases:** Reuse the unified HTML tree—do not reparse. Additional passes should walk the existing structure.
4. **Idempotence preserved:** Formatting twice must yield identical output regardless of enabled options.
5. **Graceful degradation:** When encountering unknown tags or embedded languages, fall back to preserving user input while still honoring outer indentation.

## Next Steps

### 1. Whitespace-Sensitive Handling
- Maintain a set of whitespace-sensitive tag names (configurable) and skip whitespace collapsing inside them.
- When encountering these nodes during emission, emit text verbatim and flag placeholders so Ruby segments within remain untouched.
- Add tests covering `<pre>`, `<code>`, inline ERB inside them, and multi-line script/style content.

### 2. Inline ERB Spacing Controls
- Add `FormatterConfig.html.interpolationSpacing` (e.g., `"preserve" | "trim" | "pad"`).
- During reflow, detect placeholder boundaries in text nodes and apply spacing according to the chosen mode.
- Verify with fixtures mixing plain text, inline ERB, and attributes.

### 3. Attribute Wrapping & Line Width
- Respect `FormatterConfig.html.lineWidth` and `attributeWrapping` options.
- Implement wrapping strategy in `collectAttributes` / element printing (e.g., break long attribute lists onto multiple lines with continued indentation).
- Add tests for short vs long attribute lists, ensuring idempotence.

### 4. Blank Line Policy
- Introduce `FormatterConfig.whitespace.blankLine` controls (e.g., `"preserve" | "trim" | "max1"`).
- Post-process emitted HTML to enforce chosen policy between block-level siblings.
- Cover scenarios with multiple empty lines, especially around ERB directives.

### 5. Ruby Formatting Hook (Optional)
- Design `FormatterConfig.ruby.formatter` interface (e.g., `"none" | "external"`) with a callback or command runner.
- Allow users to plug in Rubocop/Prettier-Ruby; fall back to current behavior when unset.
- Gate execution to avoid unexpected external calls by default.

### 6. Diagnostics & CLI UX
- Convert structural issues (missing placeholders, parse errors) into actionable diagnostics (path, reason).
- Enhance CLI `--segments` output with indentation visual cues and a warning summary.
- Document new options in README / `docs/formatter-roadmap.md`.

### 7. Performance Review
- Replace repeated `string.replace` loops with buffered reconstruction (e.g., using `StringBuilder`-like arrays joined once).
- Benchmark on large ERB files and ensure formatting stays responsive (<200ms for typical editor-sized documents).

### Deliverables
- Updated formatter core supporting whitespace-sensitive contexts, inline ERB spacing, attribute wrapping, and blank-line policies.
- Config documentation & examples illustrating each new option.
- Extended test suite (fixtures + snapshots) demonstrating polished output for complex templates.
- Optional Ruby formatter integration behind a config flag with safety warnings/logging.
