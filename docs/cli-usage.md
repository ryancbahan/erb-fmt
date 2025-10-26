# CLI Usage & Integration Guide

## Quick Start
```bash
npx erb-formatter --format app/views/dashboard.html.erb
```
Without a configuration file the formatter uses the defaults defined in `DEFAULT_FORMATTER_CONFIG`. Use `--write` to overwrite files in place, and `--segments` or `--tree` for debugging output when tracking indentation or placeholder behaviour.

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
erb-formatter --config "indentation.size=4,html.attributeWrapping='auto'" template.erb
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
erb-formatter --config-file examples/config/erbfmt.json --write examples/dashboard-unformatted.erb
```
Multiple `--config-file` flags are merged in the order provided, and any `--config` inline overrides apply last.

## package.json Scripts
Add a script to run the formatter over your project:
```json
{
  "scripts": {
    "format:erb": "erb-formatter --config-file config/erbfmt.json --write"
  }
}
```
This lets you run `npm run format:erb app/views/**/*.erb`. You can also wire it into lint-staged or other pre-commit tooling by invoking `erb-formatter --write --config-file ... --` and passing file names from git.

## Editor Integration
- **VS Code:** configure a task running `erb-formatter --write ${file}` (or use `--format` and capture stdout) and hook it up via “Format Document”, or use an extension that runs custom formatters.
- **Neovim/Null-LS:** point the formatter command at `erb-formatter --format` and pass the buffer on stdin/out (or use `--write` via a temporary file).
- **JetBrains:** create a File Watcher that runs `erb-formatter --write $FilePath$`.

Because the CLI prints to stdout when `--format` is set, piping output back into the editor is straightforward. Use `--segments` during integration to verify indentation levels or diagnose configuration mismatches.
