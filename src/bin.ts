#!/usr/bin/env node
import { runCli } from "./cli.js";

void runCli()
  .then((code) => {
    if (code !== 0) {
      process.exitCode = code;
    }
  })
  .catch((error) => {
    console.error(
      error instanceof Error ? error.stack ?? error.message : error,
    );
    process.exit(1);
  });
