# Performance Baseline

- Fixture: `benchmarks/large-template.erb`
- Placeholder count: 84
- Iterations: 10
- Average formatting time: ~8.1ms on Node.js v22.17 (Mac sandbox)
- Target budget: ≤200ms per format pass for editor usage

Run `npm run perf` (after a build) to recompute metrics. Override the number of iterations with `PERF_ITERATIONS` if you need higher sampling.
