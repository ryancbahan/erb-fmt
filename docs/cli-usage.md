# CLI Usage & Integration Guide

## Quick Start
```bash
npx erb-fmt --format app/views/dashboard.html.erb
npx erb-fmt --write app/views/**/*.erb
```
Without a configuration file the formatter uses the defaults defined in `DEFAULT_FORMATTER_CONFIG`. Use `--write` to overwrite files in place, and `--segments` or `--tree` for debugging output when tracking indentation or placeholder behaviour.

## Multiple Files & Globs
- Pass one or more file paths to format several templates in sequence:  
  `erb-fmt --format layout.erb partials/header.erb`.
- Provide glob patterns or directories and the formatter will walk them
  recursively, processing every `.erb` file it finds:  
  `erb-fmt --write app/views/**/*.erb`.
- Use `--` to terminate option parsing if your glob begins with a dash, e.g.
  `erb-fmt --write -- ./-legacy/**/*.erb`.

## CLI Options
- `--format` – print the formatted template to stdout (default when `--write` is not provided).
- `--write` / `-w` – replace the input file with the formatted output.
- `--segments` – emit the formatter segment breakdown for debugging.
- `--tree` – print the embedded template syntax tree.
- `--config-file <path>` – merge a JSON config file into the formatter configuration.
- `--config key=value,...` – apply inline overrides (after config files).
- `--help`, `-h` – show usage information.

## Configuration Options
### Inline overrides
You can pass comma-separated key/value pairs via `--config`:
```bash
erb-fmt --config "indentation.size=4,html.attributeWrapping='auto'" template.erb
```
Keys map directly to the `FormatterConfig` structure; missing branches are created automatically.

### Configuration file
The CLI supports loading JSON files with `--config-file`. The repository ships with an example at `examples/config/erbfmt.json`:
```json
{
  "indentation": { "size": 4, "style": "space" },
  "html": { "attributeWrapping": "auto", "lineWidth": 80 },
  "whitespace": { "trimTrailingWhitespace": true, "ensureFinalNewline": true }
}
```
Invoke the formatter with:
```bash
erb-fmt --config-file examples/config/erb-fmt.json --write examples/dashboard-unformatted.erb
```
Multiple `--config-file` flags are merged in the order provided, and any `--config` inline overrides apply last.

### Ruby formatting
- Ruby regions (`<% ... %>`) are formatted heuristically by default. Set
  `"ruby": { "format": "none" }` in your config to opt out.
- Use `ruby.lineWidth` (falls back to `html.lineWidth`) to control when helper
  arguments are wrapped onto continuation lines.
- Output directives (`<%=`) remain single-line unless you explicitly wrap them
  yourself, so attribute values stay compact.

## package.json Scripts
Add a script to run the formatter over your project:
```json
{
  "scripts": {
    "format:erb": "erb-fmt --config-file config/erb-fmt.json --write"
  }
}
```
This lets you run `npm run format:erb app/views/**/*.erb`. You can also wire it into lint-staged or other pre-commit tooling by invoking `erb-formatter --write --config-file ... --` and passing file names from git.

## Editor Integration
- **VS Code:** configure a task running `erb-fmt --write ${file}` (or use `--format` and capture stdout) and hook it up via “Format Document”, or use an extension that runs custom formatters.
- **Neovim/Null-LS:** point the formatter command at `erb-fmt --format` and pass the buffer on stdin/out (or use `--write` via a temporary file).
- **JetBrains:** create a File Watcher that runs `erb-fmt --write $FilePath$`.

Because the CLI prints to stdout when `--format` is set, piping output back into the editor is straightforward. Use `--segments` during integration to verify indentation levels or diagnose configuration mismatches.
