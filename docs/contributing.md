# Contributing Guidelines

Thanks for improving the ERB formatter! Please follow the steps below when
proposing changes:

## Development Setup

1. Install dependencies:
   ```sh
   npm install
   ```
2. Run the static analysis and formatting checks before opening a PR:
   ```sh
   npm run lint
   npm run format:check
   npm test
   ```

## Commit Expectations

- Ensure `npm test` succeeds (unit, snapshot, and property suites).
- When formatter behaviour changes, regenerate golden files with
  `UPDATE_SNAPSHOTS=1 npm test -- --run tests/snapshotFixtures.test.ts`.
- Keep the changelog (`CHANGELOG.md`) up to date for notable changes.
- Document user-facing changes in the README or relevant docs.
