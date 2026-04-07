#!/usr/bin/env node

// Layer 2: Tool blocking — PreToolUse (Edit|Write)
// Blocks code editing in Phases 0-4.
// Exceptions: specs/, .versus/, .qwen/, package.json, tsconfig.json, README

import { StateEngine } from "../state/engine";

interface HookInput {
  tool_name: string;
  tool_input: {
    file_path?: string;
    command?: string;
    content?: string;
  };
}

function isAllowedPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const allowed = [
    "/specs/",
    "/.versus/",
    "/.qwen/",
    "/package.json",
    "/tsconfig",
    "/readme",
    "/.gitignore",
    "/.mcp.json",
    "/.env",
  ];
  return allowed.some((p) => normalized.includes(p));
}

function deny(reason: string): void {
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(JSON.stringify(output) + "\n");
  process.exit(0);
}

function allow(): void {
  process.exit(0);
}

function main() {
  const workspacePath = process.env.QWEN_PROJECT_DIR || process.cwd();
  const engine = new StateEngine(workspacePath);
  const state = engine.getPhaseState();

  // No project initialized — allow everything
  if (!state) {
    allow();
    return;
  }

  // Phase 5+ allows editing
  if (state.currentPhase >= 5) {
    allow();
    return;
  }

  // Phase 0-4: read input to check the file
  let input = "";
  process.stdin.setEncoding("utf-8");

  const timeoutId = setTimeout(() => {
    process.stdin.destroy();
    allow();
  }, 5000);

  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    clearTimeout(timeoutId);
    try {
      const hookInput: HookInput = JSON.parse(input);
      const filePath = hookInput.tool_input?.file_path || "";

      if (isAllowedPath(filePath)) {
        allow();
      } else {
        deny(
          `[Versus] Blocked: Phase ${state.currentPhase} does not allow code editing. ` +
          `File: ${filePath}. ` +
          `Complete Phases 0→4 before implementing. ` +
          `Use get_exit_criteria() to see what is missing.`
        );
      }
    } catch {
      // If unable to parse input, allow (fail-open)
      allow();
    }
  });
}

main();
