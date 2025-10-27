# ERB FMT

Fast and configurable code formatter for embedded Ruby templates.

## Getting Started

```sh
npm install --save-dev erb-fmt

# format a template once
npx erb-fmt app/views/dashboard/index.html.erb

# format an entire view directory (recursive) in place
npx erb-fmt --write app/views/**/*.erb
# print formatted output plus debug segments for a glob
npx erb-fmt --format --segments app/views/shared/**/*.erb
```

- The CLI accepts multiple files or globs (e.g. `app/views/**/*.erb`) and
  recursively walks directories to format every matching template. Use `--` to
  terminate option parsing if a glob starts with a dash (for example,
  `erbfmt --write -- ./-legacy/**/*.erb`).
- Pass `--config path/to/config.json` or `--config-file` to supply overrides. See
  `docs/cli-usage.md` for flag details.
- Configuration options mirror `FormatterConfig` (indentation, HTML wrapping,
  whitespace behaviour). Sample files live under `examples/config/`.

### Requirements
- Node.js **18** or newer (the CLI is distributed as ESM and relies on
  Tree-sitter native bindings).
- No Ruby runtime is required to run the formatter, but the heuristics are
  tuned against modern Rails templates (Ruby 2.7+ syntax); keep your ERB files
  compatible with the Ruby version your app targets.

### Formatting Multiple Files
- Format a curated set of templates:  
  `npx erb-fmt --write layout.erb partials/header.erb partials/footer.erb`
- Run a dry run that prints formatted output for an entire folder:  
  `npx erb-fmt --format app/views/admin/**/*.erb`
- Combine recursive formatting with inline configuration overrides:  
  `npx erb-fmt --write --config "indentation.size=4" app/components/**/*.erb`

### Configuration Example
You can supply a JSON file with `--config-file` (multiple files may be merged in
order). The snippet below shows every available option:

```json
{
  "indentation": {
    "size": 2,
    "style": "space",
    "continuation": 2
  },
  "newline": "lf",
  "whitespace": {
    "trimTrailingWhitespace": true,
    "ensureFinalNewline": true
  },
  "html": {
    "collapseWhitespace": "conservative",
    "lineWidth": 100,
    "attributeWrapping": "auto"
  },
  "ruby": {
    "format": "heuristic",
    "lineWidth": 100
  }
}
```

Inline overrides apply last, e.g.:

```sh
erb-fmt --config-file config/erb.json --config "indentation.size=4,ruby.format='none'" app/views/**/*.erb
```

See `docs/config-reference.md` for a detailed description of each field.

## Known Limitations & Future Work

- **Placeholder HTML parse failures:** if the generated placeholder document
  triggers Tree-sitter HTML errors, the formatter falls back to returning the
  original source and emits an error diagnostic. Malformed HTML or unsupported
  grammars therefore remain unformatted.
- **Ruby formatting scope:** Ruby regions currently receive only inline
  whitespace normalisation. Complex Ruby blocks (multi-line expressions, guard
  clauses, stylistic rewrites) stay as-authored. 
- **Sensitive blocks preserved verbatim:** content inside `<pre>`, `<code>`,
  `<textarea>`, `<script>`, and `<style>` is emitted without structural changes.
  Embedded JS/CSS is not reformatted.
- **Attribute wrapping heuristics:** line-width calculations operate on
  placeholder text. After reinserting Ruby, very long helpers may still exceed
  the configured width.
- **Configuration discovery:** the CLI requires explicit `--config` or
  `--config-file` flags; there is no automatic lookup of project config files
  yet.
