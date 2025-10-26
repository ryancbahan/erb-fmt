import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import { runCli, resolveTargetFiles } from "../src/cli.js";
import { parseERB } from "../src/parser.js";
import { formatERB } from "../src/formatter/index.js";

const TMP_PREFIX = "erb-cli-test-";

describe("CLI target resolution", () => {
  it("expands directories, globs, and tracks missing patterns", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));
    const nestedDir = path.join(tempDir, "nested");
    fs.mkdirSync(nestedDir);

    const fileA = path.join(tempDir, "one.erb");
    const fileB = path.join(nestedDir, "two.erb");
    const fileC = path.join(nestedDir, "skip.txt");

    fs.writeFileSync(fileA, "<div>One</div>");
    fs.writeFileSync(fileB, "<div>Two</div>");
    fs.writeFileSync(fileC, "ignored");

    const { files, missing } = resolveTargetFiles([
      tempDir,
      path.join(tempDir, "*.erb"),
      "missing/**/*.erb",
    ]);

    expect(files).toContain(fileA);
    expect(files).toContain(fileB);
    expect(files).not.toContain(fileC);
    expect(missing).toContain("missing/**/*.erb");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("runCli", () => {
  const originalExitCode = process.exitCode;
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  afterEach(() => {
    process.exitCode = originalExitCode;
    logSpy.mockClear();
    warnSpy.mockClear();
    errorSpy.mockClear();
  });

  afterAll(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("formats multiple files when --write is provided", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));
    const fileA = path.join(tempDir, "a.erb");
    const fileB = path.join(tempDir, "b.erb");

    const unformattedA = `<div>
<% if foo %>
<span>Hi</span>
<% end %></div>`;
    const unformattedB = `<section><% if bar %>
<p>Hi</p>
<% else %>
<p>Bye</p>
<% end %></section>`;

    fs.writeFileSync(fileA, unformattedA);
    fs.writeFileSync(fileB, unformattedB);

    const expectedA = formatERB(parseERB(unformattedA)).output;
    const expectedB = formatERB(parseERB(unformattedB)).output;

    const exitCode = await runCli(["--write", tempDir]);

    expect(exitCode).toBe(0);
    expect(fs.readFileSync(fileA, "utf8")).toBe(expectedA);
    expect(fs.readFileSync(fileB, "utf8")).toBe(expectedB);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns usage when no targets are supplied", async () => {
    const exitCode = await runCli([]);
    expect(exitCode).toBe(0);
    expect(logSpy).toHaveBeenCalled();
  });
});
