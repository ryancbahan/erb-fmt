# Configuration Reference

The formatter reads its settings from `FormatterConfig`. You can provide a
JSON file via `--config-file` or use inline overrides with `--config`. Below is
an example configuration that enables every option:

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

### JSON Schema Summary

- **indentation.size**: number of spaces per indent (default `2`).
- **indentation.style**: `"space"` or `"tab"`. Tabs still respect
  `indentation.size` when converting to width.
- **indentation.continuation**: additional spaces (or tab width) applied to
  wrapped lines in Ruby expressions (default `2`).
- **newline**: `"lf"`, `"crlf"`, or `"preserve"` for output line endings.
- **whitespace.trimTrailingWhitespace**: strip trailing spaces when true.
- **whitespace.ensureFinalNewline**: ensure exactly one newline at EOF.
- **html.collapseWhitespace**: one of `"preserve"`, `"conservative"`,
  `"aggressive"` controlling text collapse outside sensitive tags.
- **html.lineWidth**: preferred width for wrapping text/attributes (can be
  `null` to disable width-based wrapping).
- **html.attributeWrapping**: `"preserve"`, `"auto"`, or
  `"force-multi-line"`.
- **ruby.format**: `"heuristic"` (default) or `"none"` to skip Ruby
  reformatting.
- **ruby.lineWidth**: width for Ruby helper argument wrapping (falls back to
  `html.lineWidth` when `null`).

You can merge multiple files by passing `--config-file` several times, or
combine files with inline overrides:

```sh
npx erbfmt --config-file config/erb.json --config "indentation.size=4,ruby.format='none'" app/views/**/*.erb
```
