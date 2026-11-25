#!/usr/bin/env node

// Layer 3: Loop detection — PreToolUse (Bash)
// Blocks a test run only when the previous LOOP_FAILURE_THRESHOLD runs failed
// with no diagnosis recorded between them. Counting happens in test-outcome.ts
// (PostToolUse), which is the only place the result of a run is visible.
//
// Safeguard S6: "STOP if debugging by trial-and-error instead of naming a cause"

import { StateEngine, LOOP_FAILURE_THRESHOLD } from "../state/engine";
import { isTestCommand, loadExtraTestPatterns } from "./shell-parse";

interface HookInput {
  tool_name: string;
  tool_input: {
    command?: string;
  };
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

  // Cheap check first: nothing accumulated, nothing to block.
  if (!engine.isLoopBlocked()) {
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

      if (!isTestCommand(command, loadExtraTestPatterns(workspacePath))) {
        allow();
        return;
      }

      const counter = engine.getLoopCounter();

      deny(
        `[Versus] Safeguard S6 activated: ${counter.count} consecutive FAILED runs of "${counter.pattern}" ` +
        `with no diagnosis recorded between them (threshold: ${LOOP_FAILURE_THRESHOLD}).\n` +
        `This is the signature of blind debugging — changing things and re-running in the hope one sticks.\n\n` +
        `To continue, name the cause. Call:\n` +
        `  record_decision(phase=${state.currentPhase}, category='diagnosis', content='<root cause of the failure and the fix it implies>')\n` +
        `That clears the counter immediately and the next run goes through.\n\n` +
        `If you cannot name a cause, that IS the finding — S6 applies:\n` +
        `1. Does this bug have a known solution? (Tier 2 — find a reference implementation)\n` +
        `2. Check specs/technical/ and specs/examples/\n` +
        `3. If not found, reconsider the approach and record that as the diagnosis.\n\n` +
        `Note: a PASSING run never counts toward this — verification is never blocked.`
      );
    } catch {
      allow();
    }
  });
}

main();
