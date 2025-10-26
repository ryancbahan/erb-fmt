# Smoke Testing Package Managers

The formatter depends on native Tree-sitter bindings, so we run end-to-end installation
smoke tests before publishing a new version. The automation lives in
`scripts/smoke-install.mjs` and can be invoked with:

```sh
npm run smoke:install
```

The script will:
- build the project (`npm run build`);
- create a release tarball (`npm pack`);
- spin up isolated projects for each detected package manager (`npm`, `pnpm`, and `yarn`);
- install the tarball, import the module, and execute `erbfmt --help`.

By default the script exercises every manager that is available on the current `PATH`. You
can scope it to a specific manager (for example, only `npm`) with:

```sh
npm run smoke:install -- --manager npm
```

Additional flags:
- `--keep-temp` retains the generated temporary projects inside the OS temp directory for
  further inspection.

> Note: The smoke test requires outbound network access so the package managers can fetch
> runtime dependencies (Tree-sitter grammars). In restricted environments the script will
> skip the affected manager and report the reason in the summary.
