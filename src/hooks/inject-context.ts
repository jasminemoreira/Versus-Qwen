#!/usr/bin/env node

// Layer 1: Context injection — UserPromptSubmit
// Injects methodology STATE before every user message.
//
// Until 0.12.0 this injected the complete guidance (~73K) plus every decision of every cycle
// in full. In Qwen Code that DID reach the model (hook stdout is capped at 1 MiB, measured in
// the 0.28.4 CLI), but Qwen appends UserPromptSubmit context to EVERY user message and keeps
// it in the history; only an identical text is de-duplicated, and this one always changes
// (state), so the history grew by ~73K+ per message.
//
// Now: a state block within a budget, with the warnings first. The guidance comes from
// get_phase_guidance(), an MCP result (inlined by Qwen up to 25,000 characters).

import { StateEngine } from "../state/engine";
import { buildInjection } from "./state-block";
import { writeAndExit } from "./hook-output";

export { buildInjection, INJECT_BUDGET } from "./state-block";

function main() {
  const workspacePath = process.env.QWEN_PROJECT_DIR || process.cwd();
  const engine = new StateEngine(workspacePath);
  const text = buildInjection(engine);
  if (text === null) process.exit(0);
  // Plain stdout: Qwen reads it as additionalContext for UserPromptSubmit. Exit only after
  // stdout drains: process.exit() right after write() can truncate a piped write.
  writeAndExit(text);
}

// Only run as a hook process — buildInjection() is imported by the test suite.
if (require.main === module) {
  main();
}
