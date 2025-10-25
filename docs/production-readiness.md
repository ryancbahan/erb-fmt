# Production Readiness Checklist

This formatter is close to publication, but several polish and battle‑testing tasks remain before it can be shipped as a stable package. Use the checklist below to track the outstanding work.

## Formatter Behaviour
- [x] Finalise whitespace handling for sensitive tags (`<pre>`, `<code>`, `<textarea>`, `<script>`, `<style>`), ensuring tags retain trailing newlines and nested ERB segments inherit the correct indentation.
- [x] Eliminate stray indentation in mixed inline/block content (e.g. the `<details>` snapshot drift); confirm idempotence by running the formatter twice over every test fixture.
- [x] Normalise inline Ruby spacing: collapse redundant spaces around ERB directives and within inline logic/output segments without altering semantics.
- [ ] Stress-test complex attribute scenarios: ERB inside quoted values, boolean attributes, data attributes with JSON blobs, and ensure wrapping logic respects `lineWidth` for both inline and forced multi-line modes.
- [ ] Add fixtures for corner cases: HTML comments wrapping ERB, unclosed tags recovered by Tree-sitter, mixed indentation files, and confirm we do not introduce semantic whitespace changes.
- [ ] Capture performance baselines on large templates (hundreds of placeholders) and set target latency budgets for editor use (<200 ms typical file).

## Configuration & CLI Experience
- [ ] Document the `--config` flag syntax, include examples for toggling `html.attributeWrapping`, `html.lineWidth`, and whitespace policies, and surface an informative `--help`.
- [ ] Emit actionable diagnostics when Tree-sitter reports syntax errors or placeholders cannot be mapped; ensure non-zero exit codes for fatal issues while still printing partial output when safe.
- [ ] Provide sample configuration files and show how to invoke the formatter via `npx`, package.json scripts, and editor integrations.

## Packaging & Distribution
- [ ] Produce an ESM build that does not depend on `tsx` at runtime; expose a compiled CLI entry in `bin` with the appropriate shebang.
- [ ] Publish type declarations with the distributed bundle so downstream tooling can drive the API programmatically.
- [ ] Verify package metadata: licence, keywords, repository links, engines, and semantic versioning policy. Add a CHANGELOG that records breaking vs. non-breaking formatter behaviour changes.
- [ ] Smoke-test installation via `npm`, `pnpm`, and `yarn` in clean projects to ensure no optional dependencies or native bindings break consumers.

## Quality Gates
- [ ] Expand the test suite with golden snapshots spanning real-world ERB templates (admin dashboards, partials, mailers). Include a matrix of configuration permutations to guard against regressions.
- [ ] Add property-style tests to enforce invariants (e.g. formatting then parsing with Tree-sitter preserves placeholder positions).
- [ ] Run continuous integration on macOS, Linux, and Windows; fail the build when formatting output diverges from committed snapshots.
- [ ] Integrate linting/formatting for the codebase itself (TypeScript, docs) and define contribution guidelines so external collaborators understand the review bar.
- [ ] Record known limitations and future work in the README so early adopters understand the formatter’s guarantees and unsupported scenarios.

Completing the above items will position the formatter as a reliable, public-ready tool that developers can trust in automated pipelines and editor workflows.
