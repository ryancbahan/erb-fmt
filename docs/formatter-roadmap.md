# ERB Formatter – Structural HTML/Ruby Pipeline Roadmap

## Guiding Principles
- **Single-source AST:** Always operate on one canonical parse per language (HTML or Ruby). No duplicated heuristics or divergent logic paths.
- **Lossless placeholders:** Treat ERB regions as first-class citizens. Preserve their text byte-for-byte while allowing the HTML formatter to reason about structure.
- **Configuration-first:** Every formatting decision (indentation, wrapping, whitespace collapsing) must flow through `FormatterConfig` so behaviour is explicit and extensible.
- **Idempotence & stability:** Running the formatter twice must never change output. Emit deterministic spacing, attribute ordering, and placeholder reinsertion.
- **Whitespace sensitivity awareness:** Respect HTML semantic rules (e.g. `<pre>`, `<code>`, inline tags), and tolerate mixed inline ERB without inventing or removing meaningful spaces.
- **Composable validation:** Surface segment metadata—indent levels, modes, diagnostics—so future CLI or editor integrations can build on reliable signals.
- **Performance-minded:** Minimise reparsing and copying. Batch transformations and reuse trees where possible to keep formatting snappy in editors.

## Milestone Goals
1. **Placeholder pipeline:** Replace each ERB region with a unique sentinel (tag/comment/text-safe) that captures its location and desired indentation anchor.
2. **Full-document HTML parse:** Parse the placeholder document once with tree-sitter HTML to obtain a complete DOM-style tree.
3. **HTML structural emitter:** Walk the parsed tree to reprint tags, attributes, text, and placeholders with indentation + whitespace rules governed by `FormatterConfig.html`.
4. **Ruby reinsertion:** Reformat Ruby segments using the AST-based indentation depth derived from the HTML walk, then swap them back into the emitted HTML.
5. **Segment reconstruction:** Produce updated `FormatSegment`s with accurate indentation levels, modes (`html-structured`, `ruby-structured`, etc.), and diagnostics for future tooling.
6. **Robust test matrix:** Cover complex templates—nested blocks, inline tags, whitespace-sensitive elements, attribute-heavy tags, interleaved ERB—to guarantee stability.
7. **Developer tooling:** Update CLI flags/visualisations to showcase structured output (`--tree`, `--segments`, diff previews) and document configuration knobs.

## Implementation Plan

### Phase 1 – Placeholder Infrastructure
- **Design placeholder syntax** that is valid inside HTML text, attributes, and raw contexts (e.g. `<!--@erb-#1-->`, `<erb-placeholder data-id="1"/>`).
- **Build `PlaceholderRegistry`:**
  - Assign incremental IDs per region.
  - Store original text, region metadata, and intended indentation baseline.
  - Offer APIs to render placeholder strings and recover originals during reinsertion.
- **Generate placeholder document:**
  - Walk existing `ParsedERB.regions`.
  - Emit HTML text verbatim for HTML regions and placeholder tokens for Ruby regions.
  - Preserve newline boundaries to keep tree-sitter offsets meaningful.
- **Tests:** Verify round-trip conversions (source → placeholder → restore) maintain byte-for-byte ERB content.

### Phase 2 – Unified HTML Parsing
- **Parse placeholder HTML once** with tree-sitter HTML.
- **Validate tree health:** assert `document` nodes cover the entire file; collect diagnostics for unexpected parse errors.
- **Augment region map:** associate each placeholder with the HTML node+position where it lives; compute structural depth (nesting level) to feed indentation logic.
- **Tests:** ensure complex templates (attributes containing ERB, inline placeholders, comment contexts) still parse and resolve to expected positions.

### Phase 3 – Structured HTML Emitter
- **Emitter design:**
  - Depth-aware printer that handles start tags, attributes, text, comments, self-closing tags, and placeholders.
  - Configurable block vs inline rules; ability to preserve whitespace-sensitive nodes (`pre`, `textarea`, `script`, etc.).
- **Whitespace strategy:**
  - Replace current regex collapsing with grammar-driven spacing decisions.
  - Respect `FormatterConfig.html.collapseWhitespace`, line width hints, and future options (attribute wrapping, inline vs block heuristics).
- **Placeholder handling:** when encountering a placeholder node/text, emit a marker in the output stream and record its final indentation level and column for reinsertion.
- **Tests:** golden snapshots comparing unformatted → formatted HTML (no ERB) to confirm printer behaviour independently.

### Phase 4 – Ruby Reintegration
- **Indentation metadata:** combine HTML depth and existing Ruby AST analysis to compute the final indent for each ERB region.
- **Reinsert ERB text:** replace placeholder markers in the emitted HTML with the formatted Ruby segments, applying indentation and newline adjustments precisely once.
- **Segment reconstruction:** rebuild `FormatSegment`s capturing mode, indentationLevel, and references back to their source ranges for CLI/debug output.
- **Tests:** complex ERB fixtures ensuring placeholders drop back into place without spacing regressions; idempotence checks (format twice).

### Phase 5 – Tooling & Documentation
- **CLI polish:** update `--segments`, `--format`, `--tree` output to reflect new modes and structural info; optionally add `--diff` to show before/after.
- **Configuration docs:** detail new `FormatterConfig.html` capabilities (block/inline policies, attribute wrapping, whitespace handling).
- **Developer notes:** document placeholder scheme, emitter architecture, and extension guidelines (e.g. plugging in CSS/JS formatters for `<style>`/`<script>` blocks).
- **Regression suite:** expand `vitest` coverage with mixed-language templates, whitespace-sensitive cases, and edge scenarios (empty ERB, comments, HTML comments, script tags).

### Success Criteria
- Formatter produces consistent, Prettier-grade indentation and spacing across HTML/Ruby boundaries.
- Running the formatter twice yields identical output (idempotence).
- Configuration toggles (indent size, whitespace modes, newline preferences) reflect immediately in output.
- Diagnostic metadata stays accurate for CLI/editor integrations.

With this roadmap in place, we can implement the placeholder pipeline first, verify the unified parse, and then layer in the structured emitter and reinsertion. Each phase ships value while keeping the overall architecture coherent and extensible.
