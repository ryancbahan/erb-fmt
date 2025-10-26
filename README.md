# ERB Formatter

High-fidelity formatter for Ruby on Rails ERB templates. It pairs Tree-sitter
parsing for HTML and embedded Ruby to normalise indentation, whitespace, and
attribute layout while preserving placeholder content byte-for-byte.

## Getting Started

```sh
npm install --save-dev erb-formatter

# format a template once
npx erbfmt app/views/dashboard/index.html.erb

# format an entire view directory (recursive) in place
npx erbfmt --write app/views/**/*.erb
# print formatted output plus debug segments for a glob
npx erbfmt --format --segments app/views/shared/**/*.erb
```

- The CLI accepts multiple files or globs (e.g. `app/views/**/*.erb`) and
  recursively walks directories to format every matching template. Use `--` to
  terminate option parsing if a glob starts with a dash (for example,
  `erbfmt --write -- ./-legacy/**/*.erb`).
- Pass `--config path/to/config.json` or `--config-file` to supply overrides. See
  `docs/cli-usage.md` for flag details.
- Configuration options mirror `FormatterConfig` (indentation, HTML wrapping,
  whitespace behaviour). Sample files live under `examples/config/`.

### Formatting Multiple Files
- Format a curated set of templates:  
  `npx erbfmt --write layout.erb partials/header.erb partials/footer.erb`
- Run a dry run that prints formatted output for an entire folder:  
  `npx erbfmt --format app/views/admin/**/*.erb`
- Combine recursive formatting with inline configuration overrides:  
  `npx erbfmt --write --config "indentation.size=4" app/components/**/*.erb`

## Development Workflow

```sh
npm install
npm run lint          # static analysis via oxlint
npm run format:check  # ensure files match oxfmt output
npm run build         # type-check & emit dist/
npm test              # unit + snapshot + property tests
npm run lint:fix      # auto-fix supported oxlint issues
npm run format        # rewrite files using oxfmt
npm run smoke:install # package-manager smoke tests (requires network)
npm run perf          # benchmark against large fixtures
```

Additional guides:
- `docs/snapshot-testing.md` – golden snapshot suite overview.
- `docs/smoke-testing.md` – cross-package-manager installation checks.
- `docs/property-testing.md` – property-style placeholder invariants.
- `docs/formatter-roadmap.md` – architecture and future milestones.
- `docs/contributing.md` – contributor workflow and review expectations.

## Known Limitations & Future Work

- **Placeholder HTML parse failures:** if the generated placeholder document
  triggers Tree-sitter HTML errors, the formatter falls back to returning the
  original source and emits an error diagnostic. Malformed HTML or unsupported
  grammars therefore remain unformatted (`src/formatter/htmlDocument.ts`).
- **Ruby formatting scope:** Ruby regions currently receive only inline
  whitespace normalisation. Complex Ruby blocks (multi-line expressions, guard
  clauses, stylistic rewrites) stay as-authored. Full Ruby reformatting can be
  explored later (`src/formatter/rubyWhitespace.ts`).
- **Sensitive blocks preserved verbatim:** content inside `<pre>`, `<code>`,
  `<textarea>`, `<script>`, and `<style>` is emitted without structural changes.
  Embedded JS/CSS is not reformatted (`src/formatter/htmlDocument.ts`).
- **Attribute wrapping heuristics:** line-width calculations operate on
  placeholder text. After reinserting Ruby, very long helpers may still exceed
  the configured width (`src/formatter/htmlDocument.ts`).
- **Configuration discovery:** the CLI requires explicit `--config` or
  `--config-file` flags; there is no automatic lookup of project config files
  yet (`src/cli.ts`).

We track additional enhancements and roadmap items in `docs/formatter-roadmap.md`.
