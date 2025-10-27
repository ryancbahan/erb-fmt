# Migration Plan: Move `erb-fmt` to `web-tree-sitter`

This document describes the incremental steps required to replace the native `tree-sitter` bindings with the WebAssembly-based `web-tree-sitter` runtime. Each action should be executed and validated before continuing to the next, so we can maintain high confidence and code quality throughout the migration.

---

## 1. Preparation

1. **Document intent**  
   - Capture the motivation (cross-platform support, removing native build friction) in the changelog or an issue so the historical record is clear.
2. **Verify tooling**  
   - Ensure the local environment has the Tree-sitter CLI (`tree-sitter`) installed at ≥0.23.0.  
   - Confirm `npm run build`, `npm test`, and `npm run smoke:install` pass on the current main branch.
3. **Create a tracking branch**  
   - `git checkout -b feat/web-tree-sitter`.

---

## 2. Introduce `web-tree-sitter` dependency

1. Add the package with an explicit version range (e.g., `npm install web-tree-sitter@^0.21.0`).
2. Update `package-lock.json` accordingly.
3. Run `npm run build` to confirm no regressions.
4. Commit: “chore: add web-tree-sitter dependency”.

---

## 3. Compile grammars to WebAssembly

1. **Set up build output structure**  
   - Decide on a destination (e.g., `dist/grammars/`) for generated `.wasm` files.
2. **Generate WASM grammars**  
   - For each grammar (`tree-sitter-embedded-template`, `tree-sitter-html`, `tree-sitter-ruby`):  
     ```
     tree-sitter build-wasm node_modules/tree-sitter-embedded-template
     mv tree-sitter.wasm src/grammars/embedded-template.wasm
     ```
     Repeat for HTML and Ruby with meaningful filenames. Adjust paths as needed.
3. **Automate generation**  
   - Add a npm script (e.g., `"build:grammars": "node scripts/build-grammars.mjs"`) that uses the Tree-sitter CLI to emit the wasm files into `dist/grammars/`.
   - Ensure the script runs as part of `npm run build` before TypeScript compilation.
4. **TypeScript support**  
   - Add ambient type declarations or module definitions if needed so TS understands `.wasm` imports or file handling.
5. **Verify artifacts**  
   - After running `npm run build`, confirm the wasm files exist in `dist/grammars/`.
6. Commit: “build: generate wasm grammars for web-tree-sitter”.

---

## 4. Update parser initialization

1. **Refactor `parser.ts`**  
   - Replace direct `import Parser from "tree-sitter"` with `import Parser from "web-tree-sitter"`.
   - Ensure `await Parser.init()` is called exactly once during CLI startup. A good place is an async factory (e.g., `initializeParsers()` within `parseERB` module).
   - Load each compiled language via `await Parser.Language.load(new URL("./grammars/embedded-template.wasm", import.meta.url))`.
   - Cache the loaded `Parser.Language` instances to avoid repeated I/O.
2. **Adjust module exports**  
   - Ensure functions like `parseERB`, `getHtmlParser`, `getRubyParser` return parsers configured with the wasm languages.
3. **Update TypeScript definitions**  
   - Reflect the async initialization flow. Methods that previously instantiated parsers synchronously may need to become async or rely on an initialization promise.
4. **Adapt CLI bootstrap**  
   - In `cli.ts`, ensure the CLI waits for parser initialization before processing files. If the CLI remains synchronous, introduce an explicit `await initParserRuntime()` early in `runCli`.
5. Commit: “refactor: switch formatter parsers to web-tree-sitter”.

---

## 5. Package configuration adjustments

1. **Include wasm files in published output**  
   - Ensure `package.json` `files` array includes the grammar directory (e.g., `"dist/grammars"`).
   - If using `exports`, expose the grammar assets as needed (or rely on relative paths from `dist/parser.js`).
2. **Ensure build artifacts reference runtime paths correctly**  
   - For ESM, prefer `new URL("./grammars/xxx.wasm", import.meta.url)` so the runtime can resolve files regardless of install location.
3. **Update `tsconfig.json`**  
   - If bundling `.wasm` via TypeScript, configure `"resolveJsonModule": true` or custom declarations as needed.
4. Commit: “build: publish wasm grammar assets”.

---

## 6. Testing and validation

1. **Unit tests**  
   - Update parser-related tests to accommodate async initialization.
   - Add regression tests that call `parseERB` without prior initialization to ensure the new lazy bootstrap works.
2. **CLI smoke tests**  
   - Run `npm run smoke:install` (or add a dedicated script) to verify `npx erb-fmt --help` works on macOS, Linux, and Windows (use CI runners if available).
3. **Performance check**  
   - Compare formatting throughput before and after the migration. Document any notable changes.
4. **Documentation**  
   - Update README and CLI docs to mention the wasm-based runtime, removing instructions about native build prerequisites.
5. Commit: “test: update coverage for web-tree-sitter runtime”.

---

## 7. Release preparation

1. Bump version in `package.json` (likely a minor release due to the runtime change).
2. Update `CHANGELOG.md` with migration notes, including any Node version requirements and potential performance considerations.
3. Run the full verification suite:
   - `npm run lint`
   - `npm run test`
   - `npm run build`
   - `npm run smoke:install`
4. Generate a tarball with `npm pack` and inspect contents to confirm wasm assets and updated code are present.
5. Tag and publish the release (`npm publish`), then validate with `npx erb-fmt@<new-version> --help` on a clean environment.

---

## 8. Post-release monitoring

1. Watch npm download metrics, GitHub issues, and any crash reporting for regressions.
2. Gather feedback on performance; if needed, explore caching strategies or lazy loading to mitigate wasm initialization overhead.
3. Plan follow-up work:
   - Remove legacy native installer documentation.
   - Evaluate whether to drop the native dependency entirely from devDependencies.

---

Following this sequence keeps each change isolated and easily reviewable while moving the project toward an installation experience that no longer depends on native build tooling. Execute each section one commit at a time, verify locally, and merge through CI to maintain “world class” code quality.*** End Patch
