#!/usr/bin/env node

// Layer 5: Truncation detection — PostToolUse (Grep|Bash)
// Detects when tool output was truncated (>50K chars → 2KB preview).
// Injects a warning so the agent reads the full file or narrows scope.

interface HookInput {
  tool_name: string;
  tool_input: {
    pattern?: string;
  };
  tool_response: string | Record<string, unknown>;
}

function warn(msg: string): void {
  const output = { additionalContext: msg };
  process.stdout.write(JSON.stringify(output) + "\n");
  process.exit(0);
}

function pass(): void {
  process.exit(0);
}

function main() {
  let input = "";
  process.stdin.setEncoding("utf-8");

  const timeoutId = setTimeout(() => {
    process.stdin.destroy();
    pass();
  }, 5000);

  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    clearTimeout(timeoutId);

    try {
      const hookInput: HookInput = JSON.parse(input);

      const response = typeof hookInput.tool_response === "string"
        ? hookInput.tool_response
        : JSON.stringify(hookInput.tool_response || "");

      // Check for the persisted-output truncation marker
      if (response.includes("Output too large")) {
        warn(
          "[Versus] WARNING: Tool output was truncated to a 2KB preview. " +
          "The full output was saved to disk. Read the full file at the given path " +
          "before acting on these results, or re-run with narrower scope " +
          "(single directory, stricter pattern)."
        );
        return;
      }

      // Heuristic: very few grep results for a broad pattern
      if (hookInput.tool_name === "Grep") {
        const resultCount = response.split("\n").filter((l) => l.trim()).length;
        const pattern = hookInput.tool_input?.pattern || "";

        if (resultCount < 5 && pattern) {
          warn(
            `[Versus] Low result count (${resultCount}) for pattern '${pattern}'. ` +
            "If this seems too few, results may have been truncated. " +
            "Consider re-running with narrower directory scope."
          );
          return;
        }
      }

      pass();
    } catch {
      pass();
    }
  });
}

main();
