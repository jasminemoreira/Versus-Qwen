#!/usr/bin/env node

// Layer 1: Context injection — UserPromptSubmit
// Injects methodology state before EVERY user message.

import { StateEngine, LOOP_FAILURE_THRESHOLD } from "../state/engine";
import { getCompleteGuidance } from "../rules/full-guidance";
import { getPhaseDefinition } from "../rules/phases";

function main() {
  const workspacePath = process.env.QWEN_PROJECT_DIR || process.cwd();
  const engine = new StateEngine(workspacePath);
  const state = engine.getPhaseState();

  if (!state) {
    // No project, no injection
    process.exit(0);
  }

  const phase = state.currentPhase;
  const phaseName = getPhaseDefinition(phase)?.name ?? "Unknown";

  const lines: string[] = [
    `[Versus] Phase ${phase} — ${phaseName} | Iteration ${state.currentIteration}`,
  ];

  // Detect "ready to advance" — all exit criteria met but phase not advanced
  if (phase < 7) {
    const phaseCriteria = engine.getExitCriteriaWithDefs(phase);
    const allMet = phaseCriteria.length > 0 && phaseCriteria.every((c) => c.met);
    if (allMet) {
      lines.push(`⚠️ READY TO ADVANCE — Phase ${phase} exit criteria are ALL met. Your VERY NEXT tool call MUST be advance_phase() followed by get_phase_guidance(). Do NOT write summary text. Do NOT wait for user input. Continue work into Phase ${phase + 1} in the same turn.`);
    }
  }

  if (state.phase0Score !== null) {
    lines.push(`Score Phase 0: ${state.phase0Score}/100`);
  }

  // Full decision history (all phases, grouped)
  if (state.decisions.length > 0) {
    const byPhase: Record<number, typeof state.decisions> = {};
    for (const d of state.decisions) {
      if (!byPhase[d.phase]) byPhase[d.phase] = [];
      byPhase[d.phase].push(d);
    }
    lines.push("Decision history (all phases):");
    for (const p of Object.keys(byPhase).map(Number).sort((a, b) => a - b)) {
      for (const d of byPhase[p]) {
        lines.push(`  [P${d.phase}/${d.category}] ${d.content}`);
      }
    }
  }

  // Project spec (stack, patterns, constraints, out-of-scope)
  const spec = state.projectSpec;
  if (spec) {
    if (spec.stack.length > 0) lines.push(`Approved stack: ${spec.stack.join(", ")}`);
    if (spec.outOfScope.length > 0) lines.push(`Out of scope: ${spec.outOfScope.join(", ")}`);
    if (spec.patterns.length > 0) lines.push(`Patterns: ${spec.patterns.join(", ")}`);
    if (spec.constraints.length > 0) lines.push(`Constraints: ${spec.constraints.join(", ")}`);
  }

  // P2: warn if ACTIVATED LENSES decision is missing (Step 1 not yet executed)
  if (phase === 2) {
    const hasLensDecision = state.decisions.some((d) => d.content.includes("ACTIVATED LENSES"));
    if (!hasLensDecision) {
      lines.push("⚠ P2 STEP 1 MISSING: No lens activation decision found. Call record_decision(category='architecture', content='ACTIVATED LENSES: [list]. NOT ACTIVATED: [lens — reason]') BEFORE applying any lens.");
    }
  }

  // Code restriction in Phases 0-4
  if (phase < 5) {
    lines.push("RESTRICTION: Phases 0-4 — DO NOT implement code. Use the MCP tools to manage the methodology.");
  }

  // Complete methodology guidance (all phases + cross-cutting rules + antipatterns).
  // Replaced compact-guidance to eliminate precision loss from summarization.
  // Token cost is mitigated by prompt caching since this content is static.
  lines.push(getCompleteGuidance());

  // Loop counter warning (S6 — counts FAILED runs with no diagnosis between them)
  const loop = engine.getLoopCounter();
  if (loop.count >= LOOP_FAILURE_THRESHOLD - 1) {
    const blocked = loop.count >= LOOP_FAILURE_THRESHOLD;
    lines.push(
      `⚠ S6: "${loop.pattern}" failed ${loop.count}x in a row with no diagnosis recorded ` +
      `(threshold: ${LOOP_FAILURE_THRESHOLD}).` +
      (blocked
        ? ` Test runs are BLOCKED. Name the cause: record_decision(category='diagnosis', content='...') — that clears it.`
        : ` Record the root cause with record_decision(category='diagnosis') before the next run.`)
    );
  }

  process.stdout.write(lines.join("\n") + "\n");
  process.exit(0);
}

main();
