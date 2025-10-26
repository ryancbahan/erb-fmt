# Snapshot Test Suite

The formatter ships with a golden snapshot suite that exercises full ERB templates drawn from
dashboards, mailers, and shared partials. These fixtures help us guard against regressions in
formatting behaviour across a matrix of configuration permutations.

## Running the suite

The tests live in `tests/snapshotFixtures.test.ts` and read their inputs from
`tests/fixtures/snapshots/`. Run them with:

```sh
npm run test -- --run tests/snapshotFixtures.test.ts
```

This executes each fixture against four configuration profiles:

- `default` – baseline formatter settings
- `wide-auto-wrap` – wide HTML `lineWidth` with adaptive attribute wrapping
- `force-multi-line` – forces attributes onto multiple lines with a medium width cap
- `preserve-trailing` – disables trimming trailing whitespace to ensure we retain semantics

Each run asserts we emit no diagnostics, the formatted output matches the stored snapshot, and
the formatter is idempotent under the same configuration.

## Updating golden files

When you intentionally change formatting behaviour, regenerate the snapshots with:

```sh
UPDATE_SNAPSHOTS=1 npm run test -- --run tests/snapshotFixtures.test.ts
```

This rewrites the files inside each fixture’s `expected/` directory. Review the git diff to
confirm the new output is correct before committing.
