#!/usr/bin/env node

const debug = createDebugLogger();

process.on("uncaughtException", handleStartupError);
process.on("unhandledRejection", (reason) => handleStartupError(reason));

void main().catch(handleStartupError);

async function main(): Promise<void> {
  debug("booting CLI");
  const { runCli } = await import("./cli.js");
  debug("cli module loaded");
  const code = await runCli();
  debug("runCli resolved", code);
  if (code !== 0) {
    process.exitCode = code;
  }
}

let didHandleError = false;

function handleStartupError(error: unknown): void {
  if (didHandleError) {
    return;
  }
  didHandleError = true;
  debug("startup error", error instanceof Error ? error.stack ?? error.message : error);

  if (isLanguageLoadError(error)) {
    console.error("erb-fmt failed to start: unable to initialize the Tree-sitter grammars.");
    console.error(
      "This usually means the WebAssembly grammar files are missing or unreadable. " +
        "Run `npm run build` (or reinstall the package) and try again.",
    );
    if (error instanceof Error) {
      console.error("");
      console.error(error.stack ?? error.message);
    }
  } else if (error instanceof Error) {
    console.error(error.stack ?? error.message);
  } else {
    console.error(String(error));
  }
  process.exit(1);
}

function createDebugLogger(): (message: string, detail?: unknown) => void {
  if (!process.env.ERB_FMT_DEBUG) {
    return () => {};
  }
  return (message: string, detail?: unknown) => {
    const pieces = [`[erb-fmt] ${message}`];
    if (detail !== undefined) {
      pieces.push(
        typeof detail === "string"
          ? detail
          : (() => {
              try {
                return JSON.stringify(detail, null, 2);
              } catch {
                return String(detail);
              }
            })(),
      );
    }
    process.stderr.write(`${pieces.join(" ")}\n`);
  };
}

function isLanguageLoadError(error: unknown): error is { message?: string; code?: string } {
  if (!error || !(error instanceof Error)) {
    return false;
  }
  const message = error.message ?? "";
  const code = (error as { code?: string }).code;
  return (
    code === "ENOENT" ||
    message.includes("WebAssembly grammar") ||
    (code === "ERR_MODULE_NOT_FOUND" && message.includes(".wasm")) ||
    message.includes("WebAssembly.instantiate")
  );
}
