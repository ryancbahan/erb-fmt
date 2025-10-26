import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import { parseERB } from "../src/parser.js";
import { formatERB } from "../src/formatter/index.js";

type SnapshotConfig = {
  name: string;
  config?: Parameters<typeof formatERB>[1];
};

const shouldUpdateSnapshots =
  process.env.UPDATE_SNAPSHOTS === "1" ||
  process.env.UPDATE_SNAPSHOTS === "true";

const __filename = fileURLToPath(import.meta.url);
const TEST_DIR = path.dirname(__filename);
const FIXTURES_ROOT = path.join(TEST_DIR, "fixtures", "snapshots");

const SNAPSHOT_CONFIGS: SnapshotConfig[] = [
  { name: "default" },
  {
    name: "wide-auto-wrap",
    config: {
      html: {
        lineWidth: 120,
        attributeWrapping: "auto",
      },
    },
  },
  {
    name: "force-multi-line",
    config: {
      html: {
        attributeWrapping: "force-multi-line",
        lineWidth: 80,
      },
    },
  },
  {
    name: "preserve-trailing",
    config: {
      whitespace: {
        trimTrailingWhitespace: false,
      },
    },
  },
];

function loadFixtures() {
  if (!fs.existsSync(FIXTURES_ROOT)) {
    throw new Error(
      `Snapshot fixtures directory is missing at ${FIXTURES_ROOT}`,
    );
  }

  return fs
    .readdirSync(FIXTURES_ROOT)
    .map((entry) => ({
      name: entry,
      fullPath: path.join(FIXTURES_ROOT, entry),
    }))
    .filter((item) => fs.statSync(item.fullPath).isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
}

describe("golden snapshot fixtures", () => {
  const fixtures = loadFixtures();

  fixtures.forEach(({ name, fullPath }) => {
    describe(name, () => {
      const inputPath = path.join(fullPath, "input.erb");
      if (!fs.existsSync(inputPath)) {
        throw new Error(`Missing input.erb for fixture "${name}"`);
      }
      const source = fs.readFileSync(inputPath, "utf8");

      SNAPSHOT_CONFIGS.forEach((snapshotConfig) => {
        const label = snapshotConfig.name;

        it(`matches snapshot for ${label}`, () => {
          const parsed = parseERB(source);
          const result = formatERB(parsed, snapshotConfig.config);

          expect(result.diagnostics).toEqual([]);

          const formatted = result.output;

          // Quick idempotence check for the formatted output under the same config.
          const secondPass = formatERB(
            parseERB(formatted),
            snapshotConfig.config,
          );
          expect(secondPass.output).toBe(formatted);

          const expectedDir = path.join(fullPath, "expected");
          const expectedPath = path.join(expectedDir, `${label}.erb`);

          if (shouldUpdateSnapshots) {
            fs.mkdirSync(expectedDir, { recursive: true });
            fs.writeFileSync(expectedPath, formatted, "utf8");
            return;
          }

          if (!fs.existsSync(expectedPath)) {
            throw new Error(
              `Missing snapshot for fixture "${name}" (config: ${label}). Run UPDATE_SNAPSHOTS=1 npm test to generate.`,
            );
          }

          const expected = fs.readFileSync(expectedPath, "utf8");
          expect(formatted).toBe(expected);
        });
      });
    });
  });
});
