#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import fs from "node:fs";
import path from "node:path";
import { parseERB } from "../dist/parser.js";
import { formatERB } from "../dist/formatter/index.js";

const iterations = Number.parseInt(process.env.PERF_ITERATIONS ?? "10", 10);
const fixturePath = path.resolve("benchmarks/large-template.erb");
const source = fs.readFileSync(fixturePath, "utf8");

const placeholderCount = (() => {
  const parsed = parseERB(source);
  return parsed.regions.filter((region) => region.type === "ruby").length;
})();

const start = performance.now();
let output = "";

for (let i = 0; i < iterations; i += 1) {
  const parsed = parseERB(source);
  const result = formatERB(parsed);
  output = result.output;
}

const totalMs = performance.now() - start;
const avgMs = totalMs / iterations;

const report = {
  fixture: path.relative(process.cwd(), fixturePath),
  iterations,
  placeholderCount,
  totalMs: Number(totalMs.toFixed(2)),
  avgMs: Number(avgMs.toFixed(2)),
  targetMs: 200,
};

console.log(JSON.stringify(report, null, 2));

if (avgMs > 200) {
  console.warn(
    `warning: average formatting time ${avgMs.toFixed(2)}ms exceeds target budget (200ms)`,
  );
  process.exitCode = 1;
}
