# Continuous Integration

The project runs a GitHub Actions workflow (`.github/workflows/ci.yml`) on macOS
for every push and pull request. The job performs the following steps:

1. Install dependencies via `npm install --legacy-peer-deps`.
2. Verify formatting with `npm run format:check`.
3. Lint using `npm run lint`.
4. Execute all tests (`npm test`).
5. Smoke-test the published bundle using `npm run smoke:install -- --manager npm`.

The Linux/Windows portions of the readiness checklist can be revisited once we
have runners with access to the Tree-sitter toolchain.
