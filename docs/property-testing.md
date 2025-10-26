# Property-Style Testing

To catch subtle regressions in placeholder handling we rely on a lightweight
property-style test (`tests/propertyPlaceholders.test.ts`). Rather than asserting
against a single fixture, the test generates hundreds of pseudo-random ERB
templates composed of HTML fragments and Ruby directives. Each template is
formatted with a rotating set of configuration permutations and then reparsed.

For every run the test verifies:
- the number and ordering of placeholder tokens is preserved;
- the HTML scaffold (minus placeholders) is unchanged up to insignificant
  indentation;
- each placeholder token is unique and maps back to the corresponding ruby
  region.

Run the property test in isolation with:

```sh
npm run test -- --run tests/propertyPlaceholders.test.ts
```

The generator is deterministic so failures are reproducible, and any future
formatter changes that modify placeholder placement will surface immediately.
