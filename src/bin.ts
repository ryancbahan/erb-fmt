#!/usr/bin/env node

void main();

async function main(): Promise<void> {
  try {
    const { runCli } = await import("./cli.js");
    const code = await runCli();
    if (code !== 0) {
      process.exitCode = code;
    }
  } catch (error) {
    handleStartupError(error);
  }
}

function handleStartupError(error: unknown): void {
  if (isTreeSitterLoadError(error)) {
    console.error("erb-fmt failed to start: unable to load the tree-sitter native bindings.");
    console.error(
      "This usually means the install step never built the binaries. Try reinstalling and check your npm install logs.",
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

function isTreeSitterLoadError(error: unknown): error is { message?: string; code?: string } {
  if (!error || !(error instanceof Error)) {
    return false;
  }
  const message = error.message ?? "";
  const code = (error as { code?: string }).code;
  return (
    code === "ERR_DLOPEN_FAILED" ||
    (code === "ERR_MODULE_NOT_FOUND" && message.includes("tree-sitter")) ||
    message.includes("tree-sitter.node") ||
    (message.includes("tree-sitter") && message.includes("dlopen"))
  );
}
