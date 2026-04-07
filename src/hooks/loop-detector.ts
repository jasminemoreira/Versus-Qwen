#!/usr/bin/env node

// Layer 3: Loop detection — PreToolUse (Bash)
// Detects repetitive commands (especially tests) and blocks after 3 iterations.
// Safeguard S6: "STOP if spending >2 iterations on the same module"

import { StateEngine } from "../state/engine";

interface HookInput {
  tool_name: string;
  tool_input: {
    command?: string;
  };
}

const TEST_PATTERNS = [
  /\bnpm\s+test\b/i,
  /\bnpx\s+(jest|vitest|mocha)\b/i,
  /\bpytest\b/i,
  /\bpython\s+-m\s+(pytest|unittest)\b/i,
  /\bcargo\s+test\b/i,
  /\bgo\s+test\b/i,
  /\bnpm\s+run\s+test\b/i,
  /\bnode\s+.*test/i,
];

function isTestCommand(cmd: string): boolean {
  return TEST_PATTERNS.some((p) => p.test(cmd));
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

  // No project or outside Phase 5-6 — no detection
  if (!state || state.currentPhase < 5) {
    allow();
    return;
  }

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
      const command = hookInput.tool_input?.command || "";

      // Only monitor test/build commands
      if (!isTestCommand(command)) {
        allow();
        return;
      }

      const result = engine.incrementLoopCounter(command);

      if (result.blocked) {
        deny(
          `[Versus] Safeguard S6 activated: test command executed ${result.count}x. ` +
          `Loop detected. STOP and:\n` +
          `1. Check if the bug has a known solution (Tier 2 — look for a reference implementation)\n` +
          `2. Consult specs/technical/ and specs/examples/\n` +
          `3. If not found, reconsider the approach\n` +
          `4. Use record_decision() to document what you discovered\n` +
          `The counter will be reset when advancing to the next phase.`
        );
      } else {
        allow();
      }
    } catch {
      allow();
    }
  });
}

main();
