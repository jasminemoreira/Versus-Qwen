#!/usr/bin/env node

// Layer 3b: Test outcome recorder — PostToolUse (Bash)
// The counting half of safeguard S6. A PreToolUse hook cannot see the result of
// a run, so the old detector counted executions and blocked the final green run
// — the one moment where running tests is most legitimate (S4 requires it).
// This hook counts only FAILED runs; a passing run clears the counter.
//
// Bias is deliberate: only positive evidence of failure counts. When the output
// is ambiguous we record nothing — a false "failed" would push toward a bogus
// block, a missed failure only delays a legitimate one.

import { StateEngine, LOOP_FAILURE_THRESHOLD } from "../state/engine";

interface HookInput {
  tool_name: string;
  tool_input: { command?: string };
  tool_response: string | Record<string, unknown>;
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

// Explicit "nothing failed" statements. Checked FIRST: "0 failed" and
// "failures: 0" contain the word "failed"/"failures" and would otherwise
// trip the failure markers below.
const CLEAN_MARKERS = [
  /\b0\s+(tests?\s+)?fail(ed|ures?|ing)?\b/i,
  /\bfail(ed|ures?)\s*[:=]\s*0\b/i,
  /\ball\s+tests?\s+passed\b/i,
  /\btest\s+result:\s*ok\b/i,          // cargo
  /^ok\s|^PASS\b/im,                    // go test / jest summary line
];

const PASS_MARKERS = [
  /\b\d+\s+(tests?\s+)?pass(ed|ing)\b/i,
  /\btests?:\s+\d+\s+passed/i,
  /\b\d+\s+passed\b/i,
  /=+\s*\d+\s+passed[^=]*=+/i,          // pytest summary
];

const FAIL_MARKERS = [
  /\bexit\s+code:?\s*[1-9]\d*\b/i,
  /\b[1-9]\d*\s+(tests?\s+)?fail(ed|ing|ures?)\b/i,
  /\bfail(ed|ures?)\s*[:=]\s*[1-9]\d*\b/i,
  /\bassertion(error| failed)\b/i,
  /\btest\s+result:\s*FAILED\b/i,
  /^FAIL\b/im,
  /\b(SyntaxError|ReferenceError|TypeError)\b/,
  /\bnpm\s+ERR!/i,
  /✗|✖|×/,
];

type Outcome = "pass" | "fail" | "unknown";

export function detectOutcome(output: string): Outcome {
  const clean = CLEAN_MARKERS.some((p) => p.test(output));

  // A clean marker does not by itself mean success: "0 failed" can sit next to a
  // crash. Only a failure marker that is NOT explained by the clean phrasing counts.
  const failed = FAIL_MARKERS.some((p) => p.test(output));

  if (failed && !clean) return "fail";
  if (failed && clean) {
    // Both present — e.g. "0 failed" plus a stack trace. Trust the hard signals only.
    const hard = /\bexit\s+code:?\s*[1-9]\d*\b/i.test(output) || /^FAIL\b/im.test(output);
    return hard ? "fail" : "pass";
  }
  if (clean || PASS_MARKERS.some((p) => p.test(output))) return "pass";
  return "unknown";
}

function emit(msg?: string): void {
  if (msg) {
    process.stdout.write(JSON.stringify({ additionalContext: msg }) + "\n");
  }
  process.exit(0);
}

function main() {
  const workspacePath = process.env.QWEN_PROJECT_DIR || process.cwd();
  const engine = new StateEngine(workspacePath);
  const state = engine.getPhaseState();

  if (!state || state.currentPhase < 5) {
    emit();
    return;
  }

  let input = "";
  process.stdin.setEncoding("utf-8");

  const timeoutId = setTimeout(() => {
    process.stdin.destroy();
    emit();
  }, 5000);

  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    clearTimeout(timeoutId);
    try {
      const hookInput: HookInput = JSON.parse(input);
      const command = hookInput.tool_input?.command || "";

      if (!isTestCommand(command)) {
        emit();
        return;
      }

      const output = typeof hookInput.tool_response === "string"
        ? hookInput.tool_response
        : JSON.stringify(hookInput.tool_response || "");

      const outcome = detectOutcome(output);

      if (outcome === "unknown") {
        emit();
        return;
      }

      const { count } = engine.recordTestOutcome(command, outcome === "fail");

      if (outcome === "fail" && count >= LOOP_FAILURE_THRESHOLD) {
        emit(
          `[Versus] S6: ${count} consecutive failed runs with no diagnosis recorded. ` +
          `The next test run will be BLOCKED until you name the cause via ` +
          `record_decision(phase=${state.currentPhase}, category='diagnosis', content='...'). ` +
          `If you already know why this failed, record it now and keep going.`
        );
        return;
      }

      if (outcome === "fail" && count === LOOP_FAILURE_THRESHOLD - 1) {
        emit(
          `[Versus] S6: ${count} failed runs in a row with no diagnosis recorded. ` +
          `Record the root cause of this failure with record_decision(category='diagnosis') ` +
          `before the next run, or S6 will block it.`
        );
        return;
      }

      emit();
    } catch {
      emit();
    }
  });
}

// Only run as a hook process — detectOutcome() is imported by the test suite.
if (require.main === module) {
  main();
}
